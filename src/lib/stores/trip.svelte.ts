// The active trip and everything that replaces it wholesale. Despite the name this is
// mostly orchestration: profile switching, share-link landing, cloud pulls, backup
// restore, AI edits. Every whole-document write of `showmeway_user_yaml` outside
// `persist()` goes through `landYaml` — backup, confirm the slot is still active, write,
// reload — and UI only mirrors the returned outcome. A new such write belongs here.

import {
    clearShareHash,
    isShareSupported,
    parseShareLink,
    readShareLinkFromHash,
    type ShareLink,
    ShareLinkError,
} from "$lib/domain/share";
import { buildDayReport } from "$lib/domain/timeline";
import {
    createChecklistItemId,
    type DayItinerary,
    genTripId,
    serializeToYaml,
    type TripData,
    validateYaml,
} from "$lib/domain/trip";
import {
    insertAtClamped,
    yamlFingerprint,
} from "$lib/domain/utils";
import { migrateGdriveSyncState } from "$lib/infra/http/gdrive";
import {
    fetchDefaultYamlText,
    fetchItinerary,
} from "$lib/infra/http/itinerary-loader";
import { resolveShareLink } from "$lib/infra/http/share-link";
import {
    createProfile,
    deleteProfile,
    ensureActiveProfileId,
    isActiveProfile,
    listProfiles,
    type ProfileInfo,
    switchToProfile,
    tripIdFromYaml,
} from "$lib/infra/storage/profiles";
import {
    canonicalYaml,
    importSharedTrip,
    type ShareImportOutcome,
} from "$lib/infra/storage/share-import";
import {
    backupCurrentYaml,
    getYamlBackup,
    saveTripData,
    USER_YAML_KEY,
} from "$lib/infra/storage/yaml-storage";
import { SvelteSet } from "svelte/reactivity";
import {
    gdriveSync,
    type SyncOptions,
} from "./gdrive.svelte";
import { settingsDraft } from "./settings-draft.svelte";
import { shareLinks } from "./share-link.svelte";
import {
    clearToastByKey,
    copyToClipboard,
    shareOrCopyToClipboard,
    showToast,
} from "./toast.svelte";
import { tripOrigins } from "./trip-origin.svelte";
import { weatherStore } from "./weather.svelte";

/** Say the upload happened, on both the clipboard and the share-sheet path — the privacy policy promises the user is told when data leaves the device. */
const UPLOADED_NOTE = "行程已加密上傳，連結一年內有效";

// How long editing has to stay quiet before the publish prompt goes up. A trip page is a
// burst of checklist taps, so asking per edit would only teach the user to dismiss it;
// long enough to collapse the burst, short enough that the answer still feels like it
// belongs to what was just typed.
const PUBLISH_PROMPT_QUIET_MS = 12_000;
// One prompt at a time: a later edit restates the same offer rather than stacking.
const PUBLISH_PROMPT_KEY = "publish-pending";
// The inbound half, kept separate so the two notices replace themselves and not each other.
const CLOUD_UPDATE_PROMPT_KEY = "cloud-update";
const SHARED_UPDATE_PROMPT_KEY = "shared-update";
// Re-reading a received link means downloading and decrypting the whole trip — hop exposes
// no cheap "has this changed" — so it is worth one check per visit, not one per tab switch.
const SHARED_CHECK_TTL_MS = 10 * 60_000;

/** What became of YAML handed to the active slot. */
export type LandOutcome =
    /** Written and reloaded; `yaml` is exactly what storage now holds. */
    | { kind: "landed"; yaml: string; }
    /** Failed validation, so nothing was written. `yaml` is what to put in front of the user to fix. */
    | { kind: "invalid"; yaml: string; error: string; }
    /** Nothing was written — the user declined, the trip switched underneath, or storage refused — and whatever needed saying was toasted. */
    | { kind: "aborted"; };

/** A newer version of a received trip, waiting on the user. What 行程管理's strip renders. */
export interface SharedUpdate {
    profileId: string;
    /** The canonical YAML the link now carries — already validated, ready to land. */
    yaml: string;
    tripName: string;
    /** Whether this device edited its copy since the version it last took from the link. */
    localChanged: boolean;
}

/** What 儲存並解析 did with the editor's text. */
export type EditorSaveOutcome =
    | LandOutcome
    /** A pasted share link landed as a trip of its own or over the copy already here; the editor should now show `yaml`. */
    | { kind: "imported"; yaml: string; }
    /** A pasted share link carried the version this device already holds; switched to it, wrote nothing. */
    | { kind: "unchanged"; };

export class TripStore {
    data = $state<TripData | null>(null);
    isLoading = $state(true);
    loadError = $state<string | null>(null);
    profiles = $state<ProfileInfo[]>([]);
    /** Drives the loading copy: a scanned QR spends this time on the app's first screen. */
    sharedLinkLoading = $state(false);
    /** True while a share link is being built — a hop round trip, so the buttons disable on it. */
    isSharing = $state(false);

    private publishTimer: ReturnType<typeof setTimeout> | null = null;
    /**
     * Slots whose share link is older than the trip in them. In memory on purpose: unlike
     * the Drive side, which compares fingerprints the sync record persists, nothing records
     * what was last sent to hop — so a reload forgets, and the prompt under-offers rather
     * than claiming a staleness it cannot prove.
     */
    private staleShareLinks = new SvelteSet<string>();
    /**
     * The update a received share link is offering, once a background check has fetched and
     * decrypted it. Null whenever there is nothing to decide.
     */
    sharedUpdate = $state<SharedUpdate | null>(null);
    private lastSharedCheckAt = 0;
    /** Set by dismissing the prompt, cleared by the next foreground or explicit save. */
    private publishPromptDeclined = false;

    prepDone = $derived(this.data ? [...this.data.todo, ...this.data.packing].filter(i => i.checked).length : 0);
    prepTotal = $derived(this.data ? this.data.todo.length + this.data.packing.length : 0);

    /**
     * Remove `id` from a `_id`-keyed list, persist, and offer an undo toast that
     * reinserts it — reading the list fresh via `getList` both times.
     */
    private deleteWithUndo<T extends { _id?: string; }>(
        getList: () => T[] | null,
        setList: (next: T[]) => void,
        id: string,
        toastMessage: (removed: T) => string,
    ) {
        const list = getList();
        if (!list) return;
        const index = list.findIndex(i => i._id === id);
        const target = list[index];
        if (!target) return;
        const removed = { ...target };
        setList(list.filter(i => i._id !== id));
        this.persist();
        const profileIdAtDelete = ensureActiveProfileId();
        showToast({
            message: toastMessage(removed),
            actionLabel: "復原",
            onAction: () => {
                if (!isActiveProfile(profileIdAtDelete)) {
                    showToast("行程已切換，無法復原");
                    return;
                }
                const current = getList();
                if (!current) return;
                setList(insertAtClamped(current, index, removed));
                this.persist();
            },
        });
    }

    async load(): Promise<void> {
        settingsDraft.yaml = null;
        this.isLoading = true;
        this.loadError = null;
        try {
            const data = await fetchItinerary();
            this.data = data;
            ensureActiveProfileId();
            this.profiles = listProfiles();
            weatherStore.loadTrip(data.days, data.trip.city);

            migrateGdriveSyncState();
            // A trip stored before ids existed gets its minted id persisted once;
            // an identity that changes every launch is worse than none.
            const storedYaml = localStorage.getItem(USER_YAML_KEY);
            if (storedYaml !== null && tripIdFromYaml(storedYaml) !== data.trip.id) this.persist();
        } catch (err) {
            console.error("Failed to load trip data:", err);
            // Drop the previous trip too: with it still here, the tools tab keeps rendering it and the
            // next `persist()` would write it over whatever slot just failed to load, with no backup taken.
            this.data = null;
            this.loadError = "無法載入或解析行程資料。請開啟設定確認 YAML 語法。";
        } finally {
            this.isLoading = false;
        }
    }

    persist(): boolean {
        if (!this.data) return false;
        try {
            const yaml = serializeToYaml(this.data);
            saveTripData(this.data, yaml);
            this.notePendingPublish(ensureActiveProfileId());
            return true;
        } catch (err) {
            console.error("Failed to persist trip data:", err);
            showToast("儲存失敗，請稍後再試");
            return false;
        }
    }

    async maybeImportSharedItinerary(): Promise<void> {
        const link = readShareLinkFromHash();
        if (!link) return;

        let yaml: string;
        try {
            this.sharedLinkLoading = link.kind === "short";
            yaml = await resolveShareLink(link);
        } catch (err) {
            if (err instanceof ShareLinkError && err.retryable) {
                // The address bar holds the only copy of the decryption key on this
                // device, so a retryable failure must leave the hash alone. Clearing
                // it here would destroy the link the user just scanned.
                showToast(err.message);
                return;
            }
            console.error("Failed to read shared itinerary:", err);
            showToast(err instanceof ShareLinkError ? err.message : "分享連結內容無效，已略過");
            clearShareHash();
            return;
        } finally {
            this.sharedLinkLoading = false;
        }

        try {
            this.landSharedTrip(validateYaml(yaml), link);
        } catch (err) {
            console.error("Failed to import shared itinerary:", err);
            showToast("分享連結內容無效，已略過");
        } finally {
            clearShareHash();
        }
    }

    toggleChecklistItem(list: "todo" | "packing", id: string) {
        if (!this.data) return;
        const item = this.data[list].find(i => i._id === id);
        if (!item) return;
        item.checked = !item.checked;
        this.persist();
    }

    addChecklistItem(list: "todo" | "packing", text: string) {
        if (!this.data) return;
        this.data[list].push({
            _id: createChecklistItemId(list === "todo" ? "todo" : "pack"),
            text,
            checked: false,
        });
        this.persist();
    }

    deleteChecklistItem(list: "todo" | "packing", id: string) {
        this.deleteWithUndo(
            () => this.data?.[list] ?? null,
            next => {
                if (this.data) this.data[list] = next;
            },
            id,
            removed => {
                const text = removed.text ?? "";
                const label = text.length > 10 ? `${text.slice(0, 10)}…` : text;
                return `已刪除「${label}」`;
            },
        );
    }

    setEventStatus(id: string, nextStatus: "done" | "skipped" | undefined) {
        if (!this.data) return;
        for (const day of this.data.days) {
            const event = day.timeline.find(e => e._id === id);
            if (!event) continue;
            if (nextStatus === undefined) delete event.status;
            else event.status = nextStatus;
            this.persist();
            return;
        }
    }

    /**
     * Land the whole-document YAML the AI produced. Assigns `this.data` in place rather than
     * through `load()`, which would unmount the AI tab and lose its conversation. Because the
     * model re-authors the entire file and `normalizeTripData` defaults `todo`/`packing` to
     * `[]`, a section it forgets to echo back validates clean and is wiped — a new top-level
     * section has to be named in `buildSystemInstruction`'s edit rules, not just added to
     * `TripData`. Also the one path that regenerates every `_id` without remounting, so
     * anything keyed by `_id` goes stale in place.
     */
    applyAiEdit(yaml: string): boolean {
        let parsed: TripData;
        try {
            parsed = validateYaml(yaml);
        } catch (err) {
            console.error("Failed to apply AI edit:", err);
            showToast("AI 的修改內容無效，已略過");
            return false;
        }
        if (this.data) parsed.trip.id = this.data.trip.id;
        const previousYaml = localStorage.getItem(USER_YAML_KEY);
        const profileIdAtEdit = ensureActiveProfileId();
        backupCurrentYaml();
        this.data = parsed;
        this.persist();
        weatherStore.loadTrip(parsed.days, parsed.trip.city);
        if (previousYaml) {
            showToast({
                message: "已套用 AI 修改的行程",
                actionLabel: "復原",
                onAction: () => {
                    if (!isActiveProfile(profileIdAtEdit)) {
                        showToast("行程已切換，無法復原");
                        return;
                    }
                    let restored: TripData;
                    try {
                        restored = validateYaml(previousYaml);
                    } catch (err) {
                        console.error("Failed to undo AI edit:", err);
                        showToast("復原失敗，可到行程管理還原備份");
                        return;
                    }
                    backupCurrentYaml();
                    this.data = restored;
                    this.persist();
                    weatherStore.loadTrip(restored.days, restored.trip.city);
                    showToast("已復原為套用前的行程");
                },
            });
        } else {
            showToast("已套用 AI 修改的行程");
        }
        return true;
    }

    async shareCurrentTrip() {
        if (!this.data || this.isSharing) return;
        if (!isShareSupported()) {
            showToast("此瀏覽器不支援連結壓縮，無法產生分享連結");
            return;
        }
        this.isSharing = true;
        try {
            const yaml = serializeToYaml(this.data);
            // Keyed by profile slot, like the Drive binding: a second tap must update the
            // link this trip already has rather than mint one the printed QR does not know.
            const profileId = ensureActiveProfileId();
            const outcome = await shareLinks.publish(profileId, yaml);
            if (outcome.kind === "unreachable") {
                showToast("目前無法更新分享連結，請檢查網路後再試一次（原本的連結仍然有效）");
                return;
            }
            // Onto the Drive file's metadata, so this trip's other devices update the same
            // link instead of minting a second one. Never for the inline fallback, which
            // mints no record and would therefore clear a link another device does hold.
            // Metadata only: the key and editToken must never ride along to a recipient.
            if (outcome.kind !== "inline") void gdriveSync.pushShareLink(profileId);
            this.staleShareLinks.delete(profileId);
            const copyMsg = outcome.kind === "inline"
                ? "分享連結已複製！網址較長，可用短網址服務縮短"
                : outcome.kind === "updated"
                ? `分享連結已更新並複製！${UPLOADED_NOTE}，原本的連結與 QR code 會顯示新版本`
                : outcome.kind === "recreated"
                ? `原本的分享連結已失效，已建立新連結並複製！${UPLOADED_NOTE}`
                : `分享連結已複製！${UPLOADED_NOTE}，可直接做成 QR code，之後再按一次就會更新同一條連結`;
            await shareOrCopyToClipboard({ url: outcome.url }, outcome.url, copyMsg, outcome.kind === "inline" ? undefined : UPLOADED_NOTE);
        } catch (err) {
            console.error("Failed to build share link:", err);
            showToast("無法產生分享連結，請稍後再試");
        } finally {
            this.isSharing = false;
        }
    }

    /** Delete the ciphertext behind this trip's share link so it stops resolving, then forget it. */
    async revokeShareLink() {
        if (this.isSharing) return;
        this.isSharing = true;
        try {
            const profileId = ensureActiveProfileId();
            const outcome = await shareLinks.revoke(profileId);
            // Clears the Drive properties too, so the other devices stop offering a link
            // hop has already dropped.
            if (outcome === "revoked") void gdriveSync.pushShareLink(profileId);
            showToast(outcome === "revoked" ? "已撤銷分享連結，原本的連結與 QR code 不再有效" : "目前無法連上短連結服務，請檢查網路後再試一次");
        } finally {
            this.isSharing = false;
        }
    }

    /**
     * Note that the active trip changed and, once editing has been quiet for
     * PUBLISH_PROMPT_QUIET_MS, ask whether to send it where it is already published. Cheap
     * to call from every write path — the prompt decides for itself whether this trip is
     * published anywhere at all.
     *
     * This is what replaced the automatic-upload setting: the same debounced round trip,
     * with the decision handed back to the user instead of taken on their behalf.
     */
    private notePendingPublish(profileId: string, { explicit = false } = {}) {
        // A deliberate save is fresh intent, so it outranks a dismissal that was about the
        // edits before it.
        if (explicit) this.publishPromptDeclined = false;
        if (shareLinks.forTrip(profileId)) this.staleShareLinks.add(profileId);
        if (this.publishTimer !== null) clearTimeout(this.publishTimer);
        this.publishTimer = setTimeout(() => {
            this.publishTimer = null;
            this.promptToPublish();
        }, PUBLISH_PROMPT_QUIET_MS);
    }

    /**
     * The bytes this device actually holds for the active trip, which is what every sync
     * record's `localHash` was taken from and therefore the only string these comparisons
     * may use. Not interchangeable with `serializeToYaml(this.data)`: a cloud pull stores
     * the downloaded bytes verbatim, and re-serializing those strips the derived fields, so
     * a freshly pulled trip would read as edited the moment it landed.
     */
    private storedYaml(): string | null {
        try {
            return localStorage.getItem(USER_YAML_KEY);
        } catch {
            return null;
        }
    }

    private cancelPublishPrompt() {
        if (this.publishTimer !== null) clearTimeout(this.publishTimer);
        this.publishTimer = null;
        clearToastByKey(PUBLISH_PROMPT_KEY);
    }

    /** Both standing offers at once, for a sync that answers whichever one was up. */
    private clearSyncPrompts() {
        this.cancelPublishPrompt();
        clearToastByKey(CLOUD_UPDATE_PROMPT_KEY);
    }

    /**
     * 背景檢查. Ask both places the active trip can have moved — its Drive file and, for a
     * trip received from someone else, the share link it came from — and say what each
     * found. Nothing is transferred and nothing is decided: the tap on the notice is what
     * acts, and the Drive half re-decides against a live read rather than this snapshot.
     *
     * `openTripManagement` is how a divergence reaches the only screen that can settle it;
     * this store has no navigation of its own, the way the install prompt does not either.
     */
    async checkForUpdates(openTripManagement: () => void): Promise<void> {
        await gdriveSync.refreshFiles();
        this.promptCloudUpdate(openTripManagement);
        await this.checkSharedTripForUpdates(openTripManagement);
    }

    /**
     * Offer what the last listing already knows: a newer cloud copy to take, or a
     * divergence to settle. Costs no request, which is what makes it safe on every
     * foreground.
     */
    private promptCloudUpdate(openTripManagement: () => void) {
        const yaml = this.storedYaml();
        if (!this.data || !yaml) return;
        const profileId = ensureActiveProfileId();
        const status = gdriveSync.remoteStatusFor(profileId, yaml);
        if (!status) return;
        // What the cloud holds outranks a standing offer to upload: answering this may
        // replace the very edits that offer was about.
        this.cancelPublishPrompt();
        showToast(
            status === "pull"
                ? {
                    message: "雲端有這趟行程的新版本",
                    actionLabel: "下載",
                    onAction: () => void this.downloadCloudUpdate(profileId),
                    kind: "download",
                    persist: true,
                    dedupeKey: CLOUD_UPDATE_PROMPT_KEY,
                }
                : {
                    message: "雲端與本機都有修改，請選擇要保留哪一份",
                    actionLabel: "處理",
                    onAction: openTripManagement,
                    persist: true,
                    dedupeKey: CLOUD_UPDATE_PROMPT_KEY,
                },
        );
    }

    /**
     * Ask this trip's share link whether the sender has published a newer version, and put
     * the answer in front of the user. Only for a trip that arrived from someone else's
     * link and kept that link's identity; a trip of the user's own is Drive's business.
     *
     * Costs a full download and decrypt — hop has no cheap "has this changed" — which is
     * why it is rate-limited rather than run on every foreground. Silent on failure: a
     * check that cannot reach hop, or whose link the sender has revoked, changes nothing
     * on this device and leaves the user nothing to act on.
     */
    async checkSharedTripForUpdates(openTripManagement: () => void): Promise<void> {
        const stored = this.storedYaml();
        if (!stored || this.sharedUpdate) return;
        const profileId = ensureActiveProfileId();
        const link = tripOrigins.linkFor(profileId);
        const taken = tripOrigins.takenHash(profileId);
        if (!link || taken === null) return;
        if (Date.now() - this.lastSharedCheckAt < SHARED_CHECK_TTL_MS) return;
        this.lastSharedCheckAt = Date.now();

        let yaml: string;
        let tripName: string;
        try {
            const parsed = validateYaml(await resolveShareLink({ kind: "short", ...link }));
            yaml = serializeToYaml(parsed);
            tripName = parsed.trip.name;
        } catch (err) {
            console.warn("Failed to re-read the shared trip link:", err);
            return;
        }
        // The user may have switched trips across the round trip.
        if (!isActiveProfile(profileId) || this.sharedUpdate) return;
        if (yamlFingerprint(yaml) === taken) return;

        this.sharedUpdate = {
            profileId,
            yaml,
            tripName,
            // Compared canonically, because the taken fingerprint was: a copy that came back
            // through a Drive pull holds the same trip in different bytes.
            localChanged: yamlFingerprint(canonicalYaml(stored) ?? stored) !== taken,
        };
        showToast(
            this.sharedUpdate.localChanged
                ? {
                    message: `「${tripName}」的分享連結有新版本，這台裝置也改過`,
                    actionLabel: "處理",
                    onAction: openTripManagement,
                    persist: true,
                    dedupeKey: SHARED_UPDATE_PROMPT_KEY,
                }
                : {
                    message: `「${tripName}」的分享連結有新版本`,
                    actionLabel: "更新",
                    onAction: () => void this.takeSharedUpdate(),
                    kind: "download",
                    persist: true,
                    dedupeKey: SHARED_UPDATE_PROMPT_KEY,
                },
        );
    }

    /** 採用對方版本 — land what the link now carries, over this device's copy. */
    async takeSharedUpdate(): Promise<LandOutcome | null> {
        const update = this.sharedUpdate;
        if (!update || !this.guardActive(update.profileId)) return null;
        const outcome = await this.landYaml(update.profileId, update.yaml);
        if (outcome.kind !== "landed") return outcome;
        tripOrigins.recordTaken(update.profileId, outcome.yaml);
        this.clearSharedUpdate();
        return outcome;
    }

    /**
     * 保留本機版本. Records the sender's version as taken without applying it, which settles
     * this offer rather than suppressing it: the local copy has knowingly diverged, so only
     * the sender moving *again* is worth asking about.
     */
    keepLocalOverSharedUpdate(): void {
        const update = this.sharedUpdate;
        if (!update) return;
        tripOrigins.recordTaken(update.profileId, update.yaml);
        this.clearSharedUpdate();
        showToast("已保留這台裝置的版本");
    }

    /**
     * 兩份都留 — the sender's version takes this slot, keeping its identity and its link, and
     * what was here is parked as a trip of its own. The local copy is read out before the
     * update overwrites it, and the branch happens only once the new version has landed.
     */
    async keepBothOverSharedUpdate(): Promise<LandOutcome | null> {
        const localYaml = this.storedYaml();
        if (localYaml === null) return null;
        const outcome = await this.takeSharedUpdate();
        if (outcome?.kind === "landed") await this.branchLocalCopy(localYaml);
        return outcome;
    }

    private clearSharedUpdate() {
        this.sharedUpdate = null;
        clearToastByKey(SHARED_UPDATE_PROMPT_KEY);
    }

    private async downloadCloudUpdate(profileId: string) {
        const yaml = this.storedYaml();
        if (!yaml || !this.guardActive(profileId)) return;
        // Through the full sync, not a bare download: the listing this offer came from may
        // be a minute old, and anything that moved since turns into a conflict here instead
        // of overwriting the newer side.
        await this.syncWithCloud(profileId, yaml);
    }

    /**
     * Let the prompt speak again after it was turned down. Coming back to the foreground is
     * the boundary that resets it — declining is about the edit in front of you, not about
     * this trip for the rest of the session.
     */
    resumePublishPrompts() {
        this.publishPromptDeclined = false;
        this.promptToPublish();
    }

    /**
     * Offer to send the active trip's changes wherever it is already published. Silent when
     * the trip is published nowhere, when neither side is behind, or when this prompt has
     * already been turned down since the app last came to the foreground.
     *
     * Always the active trip, never one captured when the timer was armed: a trip switched
     * inside the window leaves its own dirtiness on its sync record, which is what raises
     * this again the next time that trip is on screen.
     */
    private promptToPublish() {
        const yaml = this.storedYaml();
        if (!this.data || !yaml || this.publishPromptDeclined) return;
        const profileId = ensureActiveProfileId();
        // A cloud copy that has moved owns this trip's notice; offering an upload beside it
        // would put two persistent toasts on screen asking opposite things.
        if (gdriveSync.remoteStatusFor(profileId, yaml)) return;
        const drive = gdriveSync.hasUnpushedEdits(profileId, yaml);
        const share = this.staleShareLinks.has(profileId) && !!shareLinks.forTrip(profileId);
        if (!drive && !share) return;
        showToast({
            message: drive && share
                ? "行程有改動還沒同步到雲端與分享連結"
                : drive
                ? "行程有改動還沒上傳到 Google Drive"
                : "行程有改動，分享連結還是舊版本",
            actionLabel: drive && share ? "同步" : drive ? "上傳" : "更新連結",
            onAction: () => void this.publishPendingChanges(profileId),
            // The offer is the whole feature now that nothing uploads on its own, so it must
            // not expire unseen; the ✕ is how it gets turned down.
            persist: true,
            dedupeKey: PUBLISH_PROMPT_KEY,
            onDismiss: () => {
                this.publishPromptDeclined = true;
            },
        });
    }

    /**
     * The prompt's tap. Both halves read the slot as it stands at that moment rather than
     * what was on screen when the prompt went up, and Drive goes first because it can
     * replace the local copy — a pull that lands is what the link should then carry.
     */
    async publishPendingChanges(profileId: string): Promise<void> {
        this.cancelPublishPrompt();
        const yaml = this.storedYaml();
        if (!this.data || !yaml || !this.guardActive(profileId)) return;
        if (gdriveSync.hasUnpushedEdits(profileId, yaml)) {
            await this.syncWithCloud(profileId, yaml);
            // The pull may have landed a different trip, or the user may have switched away
            // across the round trip.
            if (!this.data || !isActiveProfile(profileId)) return;
        }
        if (this.staleShareLinks.has(profileId)) await this.republishShareLink(profileId);
    }

    /**
     * Replace the ciphertext behind this trip's existing link so the holders of that URL see
     * the current version — the quiet half of 分享行程, with no share sheet and no clipboard,
     * because nobody asked for the URL again.
     */
    private async republishShareLink(profileId: string) {
        if (!this.data || this.isSharing || !shareLinks.forTrip(profileId)) return;
        this.isSharing = true;
        try {
            const outcome = await shareLinks.publish(profileId, serializeToYaml(this.data));
            if (outcome.kind === "unreachable") {
                showToast("目前無法更新分享連結，請稍後再試一次（原本的連結仍然有效）");
                return;
            }
            this.staleShareLinks.delete(profileId);
            if (outcome.kind !== "inline") void gdriveSync.pushShareLink(profileId);
            if (outcome.kind === "recreated") {
                // A recreated link is a different URL and the one already handed out is dead,
                // so the new one has to be reachable from the notice that says so.
                showToast({
                    message: "原本的分享連結已失效，已建立新的連結",
                    actionLabel: "複製",
                    onAction: () => copyToClipboard(outcome.url),
                    persist: true,
                });
            } else {
                showToast("分享連結已更新為最新版本");
            }
        } catch (err) {
            console.error("Failed to republish the share link:", err);
            showToast("無法更新分享連結，請稍後再試");
        } finally {
            this.isSharing = false;
        }
    }

    async shareDayReport(dayData: DayItinerary) {
        if (!this.data) return;
        const text = buildDayReport(dayData, this.data.trip.hotels, this.data.trip.name);
        await shareOrCopyToClipboard({ text }, text, "已複製今日行程，可直接貼上分享");
    }

    async createProfile(onSuccess?: () => void) {
        if (!this.data) return;
        let yaml: string;
        try {
            yaml = await fetchDefaultYamlText();
        } catch (err) {
            console.error("Failed to prepare new profile:", err);
            showToast("無法建立新行程，請稍後再試");
            return;
        }
        if (!this.persist()) return;
        try {
            createProfile(yaml);
        } catch (err) {
            console.error("Failed to create profile:", err);
            showToast("建立新行程失敗，請稍後再試");
            return;
        }
        await this.load();
        showToast("已建立新行程，請填入行程內容");
        onSuccess?.();
    }

    async switchProfile(id: string, onSuccess?: () => void) {
        // No trip in memory means the active slot failed to load; it is parked as-is so the user can
        // still switch to a trip that works and repair this one from the editor later.
        if (this.data && !this.persist()) return;
        try {
            switchToProfile(id);
        } catch (err) {
            console.error("Failed to switch profile:", err);
            showToast(err instanceof Error ? err.message : "切換行程失敗，請稍後再試");
            this.profiles = listProfiles();
            return;
        }
        this.clearSharedUpdate();
        showToast("已切換行程");
        await this.load();
        onSuccess?.();
    }

    deleteProfile(id: string) {
        deleteProfile(id);
        gdriveSync.unbindTrip(id);
        // Forgotten, not revoked: whoever holds the link keeps the last version until it
        // expires. Deleting a trip from one phone is not a decision about their copy.
        shareLinks.forget(id);
        tripOrigins.forget(id);
        if (this.sharedUpdate?.profileId === id) this.clearSharedUpdate();
        this.profiles = listProfiles();
        showToast("已刪除行程");
    }

    /**
     * 載入為新行程 from the 雲端行程 list. In-memory edits are flushed before the outgoing trip
     * is parked, so what gets parked is the trip the user was looking at rather than the last
     * persisted copy. On invalid YAML the download is left in the editor's draft for repair.
     */
    async loadCloudTrip(fileId: string, fileName: string): Promise<LandOutcome | null> {
        const result = await gdriveSync.importCloudTripAsProfile(fileId, () => !this.data || this.persist());
        if (!result) return null;
        if (!result.ok) {
            console.error("Cloud YAML validation failed:", result.error);
            settingsDraft.yaml = result.yaml;
            showToast("此雲端行程格式有誤，已載入編輯器，請修正後再儲存");
            return { kind: "invalid", yaml: result.yaml, error: result.error };
        }
        await this.load();
        showToast(`已從 Google Drive 載入「${fileName}」為新行程`);
        return { kind: "landed", yaml: result.yaml };
    }

    async deleteCloudTrip(fileId: string) {
        await gdriveSync.deleteTrip(fileId);
    }

    private guardActive(profileId: string): boolean {
        if (isActiveProfile(profileId)) return true;
        showToast("行程已切換，此操作已取消");
        return false;
    }

    /** Every whole-document overwrite of the active slot outside `persist()` comes through here, so the backup is never skipped and a quota failure is always reported. */
    private writeUserYaml(yaml: string): boolean {
        try {
            backupCurrentYaml();
            localStorage.setItem(USER_YAML_KEY, yaml);
            return true;
        } catch (err) {
            console.error("Failed to persist YAML:", err);
            showToast("儲存失敗，請稍後再試");
            return false;
        }
    }

    /**
     * Validate `yaml`, write it into `profileId`'s slot and reload. Re-checks that the slot is
     * still the active one right before writing: callers reach here across awaits, and a
     * profile switch in that gap must not land bytes meant for the previous trip.
     *
     * `canonical` stores the re-serialized form rather than the bytes given. That is what
     * the editor's own saves want, and it is load-bearing for anything about to be uploaded:
     * a hand-written trip has no `trip.id` until `normalizeTripData` mints one, and raw bytes
     * on Drive would carry no identity for `reconcileBindings` to match. A cloud pull keeps
     * the bytes as downloaded, so what is stored is what the sync record hashes.
     */
    async landYaml(profileId: string, yaml: string, { canonical = false } = {}): Promise<LandOutcome> {
        let parsed: TripData;
        try {
            parsed = validateYaml(yaml);
        } catch (err) {
            console.error("YAML validation failed:", err);
            return { kind: "invalid", yaml, error: err instanceof Error ? err.message : "YAML 格式錯誤，請檢查縮排！" };
        }
        const stored = canonical ? serializeToYaml(parsed) : yaml;
        if (!this.guardActive(profileId) || !this.writeUserYaml(stored)) return { kind: "aborted" };
        await this.load();
        return { kind: "landed", yaml: stored };
    }

    /**
     * 儲存並解析 — the editor's save, which is also the import path for a pasted share link. A
     * link is a whole trip with its own identity, not new contents for this slot, so it takes
     * the same branching as the `#s=`/`#h=` hash instead of being written over the active
     * trip — which would leave it wearing this trip's Drive binding.
     */
    async saveFromEditor(profileId: string, text: string): Promise<EditorSaveOutcome> {
        const link = parseShareLink(text);
        if (!link) {
            const outcome = await this.landYaml(profileId, text, { canonical: true });
            if (outcome.kind === "landed") {
                this.notePendingPublish(profileId, { explicit: true });
                showToast("自訂 YAML 行程儲存成功！");
            }
            return outcome;
        }
        let parsed: TripData;
        try {
            parsed = validateYaml(await resolveShareLink(link));
        } catch (err) {
            console.error("Share link import failed:", err);
            return { kind: "invalid", yaml: text, error: err instanceof Error ? err.message : "分享連結內容無效" };
        }
        if (!this.guardActive(profileId)) return { kind: "aborted" };
        const outcome = this.landSharedTrip(parsed, link);
        if (outcome.kind === "declined") return { kind: "aborted" };
        await this.load();
        if (outcome.kind === "unchanged") return outcome;
        // `outcome.profileId`, never `profileId`: an import moves the active slot.
        this.notePendingPublish(outcome.profileId, { explicit: true });
        return { kind: "imported", yaml: outcome.yaml };
    }

    /**
     * Runs `importSharedTrip` and says what it did. The launch hash and a pasted link both
     * come through here, so they cannot drift on the wording — or on which imports get
     * marked as someone else's and watched for updates.
     *
     * Only a copy that kept the link's own `trip.id` is that link's trip. One the import
     * had to re-identify was split away from it deliberately, and watching the link from
     * there would offer to overwrite the fork with the original.
     */
    private landSharedTrip(parsed: TripData, link: ShareLink): ShareImportOutcome {
        const incomingId = parsed.trip.id;
        const credentials = link.kind === "short" ? { id: link.id, key: link.key } : null;
        const outcome = importSharedTrip(parsed);
        if (outcome.kind === "overwritten") {
            // The reopened link is now the version this slot has taken. Without this the
            // next background check would find the very bytes just landed "newer" than what
            // was recorded, and raise a divergence nobody caused.
            tripOrigins.recordTaken(outcome.profileId, outcome.yaml, credentials ?? undefined);
            showToast("已用分享連結更新行程，可在行程管理還原前一版");
        } else if (outcome.kind === "imported") {
            if (tripIdFromYaml(outcome.yaml) === incomingId) {
                tripOrigins.markShared(outcome.profileId, credentials, outcome.yaml);
            }
            showToast("已匯入分享的行程");
        } else if (outcome.kind === "unchanged") showToast("這趟行程已經是連結裡的版本");
        return outcome;
    }

    /**
     * Reconcile `profileId` with Drive and land whatever it pulled. Null when nothing was pulled
     * — pushed, already up to date, a conflict raised, or not connected. The pulled bytes are
     * recorded only once they have landed: `commit` runs on `landed` and on nothing else, or the
     * record would claim a version this device never took.
     */
    async syncWithCloud(profileId: string, yaml: string, options?: SyncOptions): Promise<LandOutcome | null> {
        // Whatever route got here answers the standing offer, so it stops standing.
        this.clearSyncPrompts();
        const res = await gdriveSync.sync(yaml, profileId, options);
        if (res?.action !== "pulled" || !res.yaml) return null;
        const outcome = await this.landYaml(profileId, res.yaml);
        if (outcome.kind === "landed") res.commit?.();
        else if (outcome.kind === "invalid") {
            settingsDraft.yaml = outcome.yaml;
            showToast("下載的雲端行程格式有誤，已載入編輯器，請修正後再儲存");
        }
        return outcome;
    }

    /**
     * 兩份都留 — the conflict resolution that discards neither side. The cloud copy takes this
     * trip's slot, keeping its id and Drive binding, and what was here is parked as a trip of
     * its own. The local YAML is read out before the pull overwrites it, and the branch happens
     * only once the cloud bytes have actually landed — a pull that failed validation, or a trip
     * switched out from under the round trip, must leave one copy rather than fork off a second.
     */
    async keepBothVersions(profileId: string, yaml: string): Promise<LandOutcome | null> {
        const localYaml = localStorage.getItem(USER_YAML_KEY);
        if (localYaml === null) return null;
        const outcome = await this.syncWithCloud(profileId, yaml, { force: "remote" });
        if (outcome?.kind === "landed") await this.branchLocalCopy(localYaml);
        return outcome;
    }

    private async branchLocalCopy(localYaml: string) {
        let forked: TripData;
        try {
            forked = validateYaml(localYaml);
        } catch (err) {
            console.error("Failed to branch the local copy:", err);
            showToast("保留本機版本失敗：內容無法解析");
            return;
        }
        forked.trip.id = genTripId();
        forked.trip.name = `${forked.trip.name}（本機版）`;
        try {
            createProfile(serializeToYaml(forked));
        } catch (err) {
            console.error("Failed to branch the local copy:", err);
            showToast("保留本機版本失敗，請稍後再試");
            return;
        }
        await this.load();
        showToast(`已保留兩份，這台裝置的版本另存為「${forked.trip.name}」`);
    }

    /**
     * 還原備份. The entry is read out before anything is written, or a full ring could evict the
     * very backup being restored; validation runs before the pre-restore snapshot, so a failed
     * restore leaves the ring untouched and the bad copy in the editor's draft instead.
     */
    async restoreBackup(profileId: string, savedAt: string): Promise<LandOutcome | null> {
        const yaml = getYamlBackup(savedAt);
        if (!yaml) {
            showToast("找不到此備份");
            return null;
        }
        const outcome = await this.landYaml(profileId, yaml);
        if (outcome.kind === "landed") showToast("已還原備份的行程");
        else if (outcome.kind === "invalid") {
            settingsDraft.yaml = yaml;
            showToast("此備份內容無效，已載入編輯器，請修正後再儲存");
        }
        return outcome;
    }

    /** 回復預設行程: drop the active slot's YAML so the bundled template loads. False when nothing changed. */
    async resetToDefault(profileId: string): Promise<boolean> {
        if (!this.guardActive(profileId)) return false;
        try {
            backupCurrentYaml();
            localStorage.removeItem(USER_YAML_KEY);
        } catch (err) {
            console.error("Failed to reset trip data:", err);
            showToast("重設失敗，請稍後再試");
            return false;
        }
        // Unbind rather than mark dirty: this discards the trip, and marking it dirty would arm
        // an auto-sync that pushes the bundled template over the user's cloud itinerary. The
        // Drive copy survives and reappears in the 雲端行程 list.
        gdriveSync.unbindTrip(profileId);
        showToast("已恢復為預設行程…");
        await this.load();
        return true;
    }
}

export const tripStore = new TripStore();
