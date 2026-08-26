import { SvelteSet } from "svelte/reactivity";
import { validateYaml } from "./api";
import {
    clearCachedAccessToken,
    clearGdriveUser,
    type CloudTripFile,
    decideSyncAction,
    deleteCloudTrip,
    downloadCloudTripYaml,
    fetchCloudTripMeta,
    fetchGoogleUserInfo,
    getCachedAccessToken,
    getGdriveClientId,
    type GoogleUser,
    listCloudTrips,
    loadGdriveAutoSync,
    loadGdriveUser,
    loadTripSyncMap,
    requestGoogleAccessToken,
    saveGdriveAutoSync,
    saveGdriveUser,
    saveTripSyncMap,
    type TripSyncMap,
    type TripSyncRecord,
    uploadOrUpdateCloudTrip,
    yamlFingerprint,
} from "./gdrive";
import { createProfile } from "./profiles";
import { showToast } from "./toast.svelte";

/** Something the user has to decide before this trip can sync again. */
interface SyncConflict {
    tripId: string;
    fileName: string;
    /**
     * `both-changed` is a genuine divergence. `remote-newer` is only Drive having moved:
     * taking it is safe, but a background run must not swap the trip the user is looking
     * at, so it waits for a tap too.
     */
    kind: "both-changed" | "remote-newer";
}

interface SyncResult {
    action: "pushed" | "pulled" | "up_to_date" | "conflict";
    /** Set on `pulled` only, and already recorded as the newly agreed copy. */
    yaml?: string;
    file?: CloudTripFile;
}

interface SyncOptions {
    /** false suppresses toasts, never opens a consent popup, and never swaps the trip. */
    interactive?: boolean;
    /** Conflict resolution: which side wins. */
    force?: "local" | "remote";
}

// Long enough that a burst of checklist toggles becomes one round-trip, short enough that
// closing the app right after an edit still catches it.
const SYNC_DEBOUNCE_MS = 4000;

// Bounded so a write that never settles, or a network that stays down, cannot leave a
// timer re-arming for the rest of the session.
const MAX_SYNC_RETRIES = 3;

class GDriveSyncState {
    user = $state<GoogleUser | null>(loadGdriveUser());
    autoSync = $state<boolean>(loadGdriveAutoSync());
    isSyncing = $state<boolean>(false);
    isConnecting = $state<boolean>(false);
    cloudFiles = $state<CloudTripFile[]>([]);
    /**
     * What both sides looked like at each trip's last sync — the one source of truth for
     * sync direction. Private on purpose: callers ask `cloudFileId`, so nothing outside
     * can write half a record.
     */
    private trips = $state<TripSyncMap>(loadTripSyncMap());
    /** Rendered by 行程管理 — something the user has to decide before this trip syncs. */
    conflict = $state<SyncConflict | null>(null);

    clientId = $derived<string>(getGdriveClientId());
    isConnected = $derived<boolean>(!!this.user);

    // Write operations only, so a background list refresh cannot clear it out from under a
    // sync that is still running.
    private busy = false;
    private timer: ReturnType<typeof setTimeout> | null = null;
    private pending: { tripName: string; yaml: string; tripId: string; } | null = null;
    private retries = 0;

    setAutoSync(enabled: boolean) {
        this.autoSync = enabled;
        saveGdriveAutoSync(enabled);
        // An armed timer would otherwise fire one more upload after the user opted out.
        if (!enabled) this.cancelPending();
    }

    /** The Drive file a trip is bound to, if any. */
    cloudFileId(tripId: string): string | null {
        return this.trips[tripId]?.fileId ?? null;
    }

    /**
     * Of the given trip ids, the Drive file ids they are bound to AND that are
     * still present in `cloudFiles` (not trashed or otherwise gone from the
     * list). One place to compute "trip → live Drive binding" so no two callers
     * can derive it differently and disagree.
     */
    boundFileIdsFor(tripIds: string[]): Set<string> {
        const live = new SvelteSet(this.cloudFiles.map(f => f.id));
        const bound = new SvelteSet<string>();
        for (const tripId of tripIds) {
            const fileId = this.cloudFileId(tripId);
            if (fileId && live.has(fileId)) bound.add(fileId);
        }
        return bound;
    }

    private writeRecord(tripId: string, record: TripSyncRecord) {
        this.trips[tripId] = record;
        saveTripSyncMap({ ...this.trips });
    }

    /**
     * Adopts a Drive file as this trip's cloud copy, recording the downloaded bytes as
     * what both sides now agree on. The caller must have persisted `yaml` first.
     */
    adoptCloudTrip(tripId: string, fileId: string, yaml: string, remoteMd5?: string) {
        this.writeRecord(tripId, { fileId, remoteMd5, localHash: yamlFingerprint(yaml) });
        if (this.conflict?.tripId === tripId) this.conflict = null;
    }

    /** Forgets a trip's Drive binding and everything remembered about it. */
    unbindTrip(tripId: string) {
        delete this.trips[tripId];
        saveTripSyncMap({ ...this.trips });
        if (this.conflict?.tripId === tripId) this.conflict = null;
        if (this.pending?.tripId === tripId) this.pending = null;
    }

    private async getValidToken(interactive = true): Promise<string> {
        const cached = getCachedAccessToken();
        if (cached) return cached;

        if (this.isConnected) {
            try {
                const res = await requestGoogleAccessToken(this.clientId, "");
                return res.token;
            } catch (err) {
                if (!interactive) {
                    throw err;
                }
            }
        }

        if (!interactive) {
            throw new Error("尚未登入 Google 或登入憑證已過期");
        }

        const res = await requestGoogleAccessToken(this.clientId, "consent");
        return res.token;
    }

    async connect(): Promise<boolean> {
        this.isConnecting = true;
        try {
            const { token } = await requestGoogleAccessToken(this.clientId, "consent");
            const userInfo = await fetchGoogleUserInfo(token);
            // The consent screen doubles as an account chooser. Records name files the
            // previous account owns, which this one has no `drive.file` grant for, so
            // keeping them would make every later sync PATCH a 404.
            if (this.user && this.user.email !== userInfo.email) {
                Object.keys(this.trips).forEach(tripId => this.unbindTrip(tripId));
                showToast(`已改用 ${userInfo.email}，行程的雲端連結已重設`);
            }
            saveGdriveUser(userInfo);
            this.user = userInfo;
            showToast(`Google 雲端硬碟已連線 (${userInfo.email})`);
            void this.refreshFiles();
            return true;
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.error("Google connect failed:", err);
            showToast(`連線失敗: ${msg}`);
            return false;
        } finally {
            this.isConnecting = false;
        }
    }

    disconnect() {
        clearGdriveUser();
        clearCachedAccessToken();
        this.cancelPending();
        this.user = null;
        this.cloudFiles = [];
        // Left behind it would keep rendering a strip whose buttons cannot do anything.
        this.conflict = null;
        showToast("已取消 Google 雲端硬碟連線");
    }

    async refreshFiles(): Promise<CloudTripFile[]> {
        if (!this.isConnected) return [];
        try {
            const token = await this.getValidToken(false);
            const files = await listCloudTrips(token);
            this.cloudFiles = files;
            return files;
        } catch (err) {
            // Listing is a background convenience, so it touches neither `isSyncing` nor
            // `error`: clearing either would let a refresh drop the spinner, and mask the
            // reason, of a write that is still running.
            console.warn("Refresh cloud files failed:", err);
            return [];
        }
    }

    /**
     * 儲存完同步. Debounced, because every trip edit goes through `persistTripData` — a
     * handful of checklist taps would otherwise be a handful of round-trips, and it is
     * that request rate which provokes the Drive rate limits that can split the app folder
     * in two. Safe to call unconditionally: it returns early unless the user opted in.
     */
    scheduleSync(tripName: string, yaml: string, tripId: string) {
        if (!this.autoSync || !this.isConnected) return;
        // An unresolved conflict is waiting on the user to pick a side; asking Drive again
        // on every keystroke cannot produce an answer we do not already have.
        if (this.conflict?.tripId === tripId) return;
        // The queue holds one trip. Switching trips inside the window must flush the
        // previous one rather than drop its push.
        if (this.pending && this.pending.tripId !== tripId) void this.flush();
        this.pending = { tripName, yaml, tripId };
        this.retries = 0;
        this.arm();
    }

    private arm() {
        if (this.timer !== null) clearTimeout(this.timer);
        this.timer = setTimeout(() => void this.flush(), SYNC_DEBOUNCE_MS);
    }

    private cancelPending() {
        if (this.timer !== null) clearTimeout(this.timer);
        this.timer = null;
        this.pending = null;
        this.retries = 0;
    }

    private async flush() {
        this.timer = null;
        const pending = this.pending;
        if (!pending) return;
        // Re-checked here, not only when the timer was armed: the user may have turned
        // automatic sync off, or signed out, while it was waiting.
        if (!this.autoSync || !this.isConnected) {
            this.cancelPending();
            return;
        }
        if (this.busy) {
            if (this.retries++ < MAX_SYNC_RETRIES) this.arm();
            return;
        }
        const result = await this.sync(pending.tripName, pending.yaml, pending.tripId, { interactive: false });
        if (!result) {
            // The edit is still only local — keep it queued so a dropped connection
            // retries instead of discarding the push.
            if (this.retries++ < MAX_SYNC_RETRIES) this.arm();
            return;
        }
        // A newer edit may have replaced it while the upload was in flight.
        if (this.pending === pending) this.pending = null;
        this.retries = 0;
    }

    /** Uploads `yaml` and records it as what both sides now agree on. */
    private async push(
        token: string,
        tripName: string,
        yaml: string,
        tripId: string,
        fileId: string | null,
    ): Promise<CloudTripFile> {
        const res = await uploadOrUpdateCloudTrip(token, tripName, yaml, {
            fileId: fileId ?? undefined,
            tripId,
        });
        // Fingerprinted from the bytes actually sent, not from whatever the editor holds
        // now: a save that landed mid-upload is not in `yaml`, and recording the current
        // content would mark that edit as sent and let the next sync drop it.
        this.adoptCloudTrip(tripId, res.id, yaml, res.md5Checksum);
        return res;
    }

    /**
     * 按一下同步 — the one sync operation. Reconciles a trip with its Drive copy and
     * reports what it did.
     *
     * Never destructive on its own: a divergence surfaces as `conflict` with the record
     * left untouched, and the user resolves it by calling again with `force`. A `pulled`
     * result hands back the YAML for the caller to persist; the record advances only once
     * those bytes are in hand, so a download the caller rejects cannot leave the trip
     * claiming to hold a version it never took.
     */
    async sync(
        tripName: string,
        localYaml: string,
        tripId: string,
        options: SyncOptions = {},
    ): Promise<SyncResult | null> {
        const interactive = options.interactive ?? true;
        if (!this.isConnected) return null;
        if (this.busy) {
            if (interactive) showToast("同步進行中，請稍候…");
            return null;
        }
        this.busy = true;
        this.isSyncing = true;
        try {
            const token = await this.getValidToken(interactive);
            const record = this.trips[tripId] ?? null;
            const remoteFile = record ? await fetchCloudTripMeta(token, record.fileId) : null;

            const decision = options.force === "local"
                ? "push"
                : options.force === "remote"
                ? "pull"
                : decideSyncAction({
                    record,
                    remoteExists: !!remoteFile,
                    remoteMd5: remoteFile?.md5Checksum ?? null,
                    localHash: yamlFingerprint(localYaml),
                });

            if (decision === "push") {
                // A record whose Drive copy is gone has to create a new file rather than
                // PATCH the id that just answered 404.
                const targetFileId = remoteFile && record ? record.fileId : null;
                const res = await this.push(token, tripName, localYaml, tripId, targetFileId);
                if (interactive) {
                    // A forced push is the user resolving a conflict, so say what it cost
                    // rather than reporting it as a routine sync.
                    showToast(
                        options.force === "local"
                            ? `已以本機版本覆蓋雲端「${res.name}」`
                            : targetFileId
                            ? `已同步「${res.name}」到 Google Drive`
                            : `已建立雲端備份「${res.name}」`,
                    );
                }
                void this.refreshFiles();
                return { action: "pushed", file: res };
            }

            // Every remaining decision came from a live remote, which is what produced it.
            if (!record || !remoteFile) return null;

            if (decision === "pull") {
                if (!interactive) {
                    // A debounced timer has nowhere to put the YAML and must not swap the
                    // trip the user is looking at, so it asks instead of downloading.
                    this.conflict = { tripId, fileName: remoteFile.name, kind: "remote-newer" };
                    return { action: "conflict", file: remoteFile };
                }
                const yaml = await downloadCloudTripYaml(token, record.fileId);
                this.adoptCloudTrip(tripId, record.fileId, yaml, remoteFile.md5Checksum);
                showToast(`已載入雲端版本「${remoteFile.name}」`);
                return { action: "pulled", yaml, file: remoteFile };
            }

            if (decision === "conflict") {
                // Deliberately changes nothing: re-binding or overwriting here would
                // abandon whichever copy the user has not seen yet.
                this.conflict = { tripId, fileName: remoteFile.name, kind: "both-changed" };
                if (interactive) {
                    showToast(`「${remoteFile.name}」雲端與本機都有修改，請選擇要保留哪一份`);
                }
                return { action: "conflict", file: remoteFile };
            }

            if (interactive) showToast(`「${remoteFile.name}」本地與雲端已是最新狀態`);
            return { action: "up_to_date", file: remoteFile };
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            if (interactive) showToast(`同步失敗: ${msg}`);
            return null;
        } finally {
            this.isSyncing = false;
            this.busy = false;
        }
    }

    /**
     * Downloads a Drive copy together with its checksum, so the caller can adopt the exact
     * version it applied rather than trusting the cached listing. This is for opening a
     * cloud trip nothing local is bound to yet; reconciling a bound one is `sync`.
     */
    async loadTripYaml(fileId: string): Promise<{ yaml: string; md5?: string; } | null> {
        if (!this.isConnected) return null;
        if (this.busy) {
            showToast("同步進行中，請稍候…");
            return null;
        }
        this.busy = true;
        this.isSyncing = true;
        try {
            const token = await this.getValidToken(true);
            const remote = await fetchCloudTripMeta(token, fileId);
            const yaml = await downloadCloudTripYaml(token, fileId);
            return { yaml, md5: remote?.md5Checksum };
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            showToast(`下載雲端行程失敗: ${msg}`);
            return null;
        } finally {
            this.isSyncing = false;
            this.busy = false;
        }
    }

    /**
     * 載入為新行程 — adopts a Drive file as a brand-new local profile: load →
     * validate → `createProfile` → `adoptCloudTrip`, the one sequence every
     * "load a cloud trip I am not bound to yet" entry point needs.
     *
     * Returns null only when the download itself failed — `loadTripYaml` has
     * already toasted that. On invalid YAML `yaml` still comes back so a caller
     * with an editing surface can seed it for correction; a caller without one
     * can ignore that field. `beforeCommit` runs only once validation succeeds,
     * right before `createProfile` reads the outgoing trip out of storage — the
     * one place a caller needs to flush its own in-memory edits first.
     */
    async importCloudTripAsProfile(
        fileId: string,
        beforeCommit?: () => void,
    ): Promise<{ ok: true; yaml: string; profileId: string; } | { ok: false; yaml: string; error: string; } | null> {
        const pulled = await this.loadTripYaml(fileId);
        if (!pulled) return null;
        const yaml = pulled.yaml;
        try {
            validateYaml(yaml);
        } catch (err) {
            const error = err instanceof Error ? err.message : "雲端 YAML 格式錯誤，請檢查！";
            return { ok: false, yaml, error };
        }
        beforeCommit?.();
        const profileId = createProfile(yaml);
        // The bytes just downloaded, not the cached listing's checksum: a stale entry
        // would record an agreement matching no version and report a conflict nobody
        // caused.
        this.adoptCloudTrip(profileId, fileId, yaml, pulled.md5);
        return { ok: true, yaml, profileId };
    }

    async deleteTrip(fileId: string): Promise<boolean> {
        if (this.busy) {
            showToast("同步進行中，請稍候…");
            return false;
        }
        this.busy = true;
        this.isSyncing = true;
        try {
            const token = await this.getValidToken(true);
            await deleteCloudTrip(token, fileId);
            // Any trip still bound to it would PATCH a file that no longer exists.
            Object.entries(this.trips)
                .filter(([, record]) => record.fileId === fileId)
                .forEach(([tripId]) => this.unbindTrip(tripId));
            showToast("已從 Google Drive 刪除行程");
            void this.refreshFiles();
            return true;
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            showToast(`刪除失敗: ${msg}`);
            return false;
        } finally {
            this.isSyncing = false;
            this.busy = false;
        }
    }
}

export const gdriveSync = new GDriveSyncState();
