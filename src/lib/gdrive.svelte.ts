import { SvelteSet } from "svelte/reactivity";
import {
    serializeToYaml,
    type TripData,
    validateYaml,
} from "./api";
import {
    buildRebindRecord,
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
    type GoogleAuthPrompt,
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
import {
    createProfile,
    ensureUniqueTripId,
    listLocalTrips,
    tripIdFromYaml,
    tripNameFromYaml,
} from "./profiles";
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
    action: "pushed" | "pulled" | "up_to_date" | "conflict" | "pull_ready" | "push_ready";
    /** Set on `pulled` only — the downloaded copy, which nothing has recorded yet. */
    yaml?: string;
    /**
     * Set on `pulled` only: records `yaml` as the copy both sides now agree on. Call it
     * once those bytes are persisted, and **not at all** if they were not — a record that
     * ran ahead of the caller claims this device holds a version it never took, and the
     * next sync pushes the older local content over the newer cloud one.
     */
    commit?: () => void;
    file?: CloudTripFile;
}

/**
 * How far a token request may go, and the reason there is no middle setting.
 *
 * GIS has no silent refresh: the token model supports only the dialog UX, so "get a
 * token" and "open a window in the user's face" are the same act — `prompt: "none"`
 * included (see `GoogleAuthPrompt`). Every path that a tap did not start must therefore
 * stop at the cached token and let the UI offer a reconnect button, which is also what
 * Google's own guidance says to do with an expired token.
 */
type TokenMode =
    /** Cached token or nothing. Never reaches GIS, so it can never open a window. */
    | "cache-only"
    /** May escalate all the way to the consent screen. Only from a user gesture. */
    | "interactive";

/** Where the cloud trip list stands, so the switcher can render one row instead of guessing. */
export type CloudListState = "idle" | "loading" | "ready" | "failed";

/**
 * What the cloud button's next tap means, decided by `cloudActionFor` from this module's
 * own state. The panel maps each kind onto icon, label, and handler; the first three
 * kinds are the states with nothing a tap could do. `upload.overwrite` distinguishes a
 * bound trip's push (覆蓋雲端) from creating a brand-new Drive file.
 */
type CloudAction =
    | { kind: "connecting"; }
    | { kind: "busy"; phase: "checking" | "pushing" | "pulling"; }
    | { kind: "conflict"; }
    | { kind: "login"; }
    | { kind: "upload"; overwrite: boolean; }
    | { kind: "download"; }
    | { kind: "check"; };

// Long enough that opening and closing the switcher a few times costs one Drive call,
// short enough that a trip added on another device shows up without a reload.
const CLOUD_LIST_TTL_MS = 60_000;

interface SyncOptions {
    /** false suppresses toasts, keeps token acquisition cache-only, and never swaps the trip. */
    interactive?: boolean;
    /** Conflict resolution: which side wins. */
    force?: "local" | "remote";
    /**
     * The 同步 button's own click: fetch and decide, but transfer nothing. Both directions
     * only arm `pendingTransfer`, so the button turns into an explicit 上傳/下載 tap rather
     * than swapping the trip out from under — or uploading on behalf of — a user who only
     * asked to check.
     */
    checkOnly?: boolean;
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
    /** Only meaningful while `isSyncing`. Set exclusively by `sync()`, so any other busy-locked operation (delete, load) leaves it `null`. */
    private syncPhase = $state<"checking" | "pushing" | "pulling" | null>(null);
    isConnecting = $state<boolean>(false);
    cloudFiles = $state<CloudTripFile[]>([]);
    cloudListState = $state<CloudListState>("idle");
    /**
     * What both sides looked like at each trip's last sync — the one source of truth for
     * sync direction. Private on purpose: callers ask `cloudFileId`, so nothing outside
     * can write half a record.
     */
    private trips = $state<TripSyncMap>(loadTripSyncMap());
    /**
     * Conflicts raised by a sync in this session, keyed by profile id. One per trip rather
     * than one overall: only the active trip's is on screen, so a single slot would drop
     * the others on the floor. Read through `conflictFor`, which also surfaces the
     * divergences recorded in `trips` — those outlive the session, these do not.
     */
    private conflicts = $state<Record<string, SyncConflict>>({});
    /**
     * Set by a `checkOnly` sync that found a safe, one-directional transfer waiting —
     * `cloudActionFor` reports it as `download`/`upload` instead of the ambiguous `check`.
     * The next tap re-runs `sync()` for real, which recomputes the decision from scratch
     * rather than trusting this snapshot.
     */
    private pendingTransfer = $state<{ tripId: string; direction: "pull" | "push"; } | null>(null);

    clientId = $derived<string>(getGdriveClientId());
    isConnected = $derived<boolean>(!!this.user);

    // Write operations only, so a background list refresh cannot clear it out from under a
    // sync that is still running.
    private busy = false;
    private timer: ReturnType<typeof setTimeout> | null = null;
    private pending: { yaml: string; tripId: string; } | null = null;
    private retries = 0;
    private lastRefreshAt = 0;
    private refreshInFlight: Promise<CloudTripFile[]> | null = null;
    /** A listing landed mid-sync and skipped its rebind pass; `withBusyLock` re-runs it on the way out. */
    private reconcileMissed = false;

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
     *
     * `yaml` is the agreed content on both sides — every caller either just sent those
     * bytes or just received them — so one fingerprint stands for both memories.
     */
    adoptCloudTrip(tripId: string, fileId: string, yaml: string, remoteMd5?: string) {
        const hash = yamlFingerprint(yaml);
        this.writeRecord(tripId, { fileId, remoteMd5, localHash: hash, remoteHash: hash });
        delete this.conflicts[tripId];
    }

    /** Forgets a trip's Drive binding and everything remembered about it. */
    unbindTrip(tripId: string) {
        delete this.trips[tripId];
        saveTripSyncMap({ ...this.trips });
        delete this.conflicts[tripId];
        if (this.pending?.tripId === tripId) this.pending = null;
        if (this.pendingTransfer?.tripId === tripId) this.pendingTransfer = null;
    }

    /**
     * Whether `tripId` has ever been bound, and if so whether `localYaml` still matches
     * what was last agreed with Drive. Purely local — no network — which is what lets
     * `cloudActionFor` re-run on every keystroke.
     */
    private tripSyncState(tripId: string, localYaml: string): "unbound" | "dirty" | "clean" {
        const record = this.trips[tripId] ?? null;
        if (!record) return "unbound";
        const dirty = record.localHash === undefined || record.localHash !== yamlFingerprint(localYaml);
        return dirty ? "dirty" : "clean";
    }

    /**
     * The unresolved conflict on `tripId`, if any — what 行程管理 renders its decision strip
     * from, and what every path that could transfer checks before acting.
     *
     * A `diverged` record is reported even with nothing in `conflicts`: that is the state
     * a reload leaves behind, and without it the strip would disappear while the record
     * that raised it still decides `push`.
     */
    conflictFor(tripId: string): SyncConflict | null {
        const raised = this.conflicts[tripId];
        if (raised) return raised;
        const record = this.trips[tripId];
        if (!record?.diverged) return null;
        return {
            tripId,
            // From the last listing, which is where the divergence was found; the fallback
            // only shows before the first refresh of a fresh session.
            fileName: this.cloudFiles.find(file => file.id === record.fileId)?.name ?? "雲端行程",
            kind: "both-changed",
        };
    }

    /**
     * What the 行程管理 cloud button's next tap means, so the decision lives with the
     * state it reads instead of being reassembled from exported flags.
     *
     * A conflict and a signed-out user are unambiguous. Otherwise `tripSyncState` tells
     * "unbound"/"dirty" — both an upload — apart from "clean" without asking Drive; a
     * clean trip only offers a direction once a `checkOnly` sync has actually asked and
     * armed `pendingTransfer` (an upload from there means the cloud copy is gone, not
     * that this device edited anything). Until then its tap is `check` — the ambiguous
     * resting state that only a real fetch can resolve.
     */
    cloudActionFor(tripId: string, localYaml: string): CloudAction {
        if (this.isConnecting) return { kind: "connecting" };
        if (this.isSyncing) return { kind: "busy", phase: this.syncPhase ?? "checking" };
        if (this.conflictFor(tripId)) return { kind: "conflict" };
        if (!this.isConnected) return { kind: "login" };
        if (this.tripSyncState(tripId, localYaml) !== "clean") {
            return { kind: "upload", overwrite: this.boundFileIdsFor([tripId]).size > 0 };
        }
        if (this.pendingTransfer?.tripId === tripId) {
            return this.pendingTransfer.direction === "pull"
                ? { kind: "download" }
                : { kind: "upload", overwrite: false };
        }
        return { kind: "check" };
    }

    private async getValidToken(mode: TokenMode = "interactive"): Promise<string> {
        const cached = getCachedAccessToken();
        if (cached) return cached;

        if (mode === "cache-only" || !this.isConnected) {
            throw new Error("尚未登入 Google 或登入憑證已過期");
        }

        try {
            return (await requestGoogleAccessToken(this.clientId, "")).token;
        } catch {
            // An empty prompt only re-uses an existing grant; falling back is what covers
            // a scope the account has not approved yet.
        }
        const res = await requestGoogleAccessToken(this.clientId, "consent");
        return res.token;
    }

    /**
     * Signs in, or re-authorizes an account that is already signed in.
     *
     * `prompt` defaults by situation: a first sign-in has to show the consent screen,
     * but merely replacing an expired token does not — re-consenting an account that
     * already granted the scopes only makes the user re-read a list they have approved.
     * Pass `"select_account"` to deliberately switch accounts.
     */
    async connect(prompt?: GoogleAuthPrompt): Promise<boolean> {
        this.isConnecting = true;
        try {
            const { token } = await requestGoogleAccessToken(this.clientId, prompt ?? (this.user ? "" : "consent"));
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
            void this.refreshFiles({ force: true });
            // An edit made while the token was dead is still queued; without this it would
            // wait for the user to touch the trip again before it reached Drive.
            void this.flush();
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
        this.cloudListState = "idle";
        // Left behind it would keep rendering a strip whose buttons cannot do anything.
        this.conflicts = {};
        showToast("已取消 Google 雲端硬碟連線");
    }

    /**
     * Reloads the cloud trip list and reports the outcome through `cloudListState`, which
     * is what the switcher renders its cloud row from.
     *
     * Always cache-only: listing is never worth a window in the user's face, so an
     * expired token surfaces as `failed` and the switcher offers a reconnect instead.
     * A failure leaves `cloudFiles` alone — the list is hidden while `cloudListState` is
     * `failed`, so keeping it means a successful retry restores the rows instead of
     * flashing an empty list first.
     */
    async refreshFiles(options: { force?: boolean; } = {}): Promise<CloudTripFile[]> {
        if (!this.isConnected) {
            this.cloudListState = "idle";
            return [];
        }
        if (this.refreshInFlight) return this.refreshInFlight;
        if (
            !options.force
            && this.cloudListState === "ready"
            && Date.now() - this.lastRefreshAt < CLOUD_LIST_TTL_MS
        ) {
            return this.cloudFiles;
        }

        this.cloudListState = "loading";
        const attempt = (async () => {
            try {
                const token = await this.getValidToken("cache-only");
                const files = await listCloudTrips(token);
                this.cloudFiles = files;
                this.lastRefreshAt = Date.now();
                this.cloudListState = "ready";
                this.reconcileBindings(files);
                return files;
            } catch (err) {
                // Listing is a background convenience, so it touches neither `isSyncing` nor
                // `error`: clearing either would let a refresh drop the spinner, and mask the
                // reason, of a write that is still running.
                console.warn("Refresh cloud files failed:", err);
                this.cloudListState = "failed";
                return [];
            } finally {
                this.refreshInFlight = null;
            }
        })();
        this.refreshInFlight = attempt;
        return attempt;
    }

    /**
     * Re-derives the trip → file bindings this device no longer has, by matching each
     * Drive file's `trip.id` against the trips held locally. This is what makes signing
     * out and back in, reinstalling, or having storage evicted recoverable: without it the
     * same trip shows up as a local profile AND an unrelated cloud file, and the next sync
     * creates a duplicate rather than updating the file that is already there.
     *
     * Only ever fills gaps — a trip that already has a record is left alone, and so is a
     * file some other trip is bound to, so this can run after every listing.
     *
     * Silent when the two copies match, which is the common case and the reason
     * `contentHash` is published at all. When they differ the binding is still recorded
     * (so no duplicate gets created and the resolution has a file to act on) and a
     * conflict is raised for the user to settle — see `buildRebindRecord`, whose record
     * decides `push` on its own and depends on that conflict to hold it.
     */
    private reconcileBindings(files: CloudTripFile[]) {
        // A sync in flight owns these records; it will write its own agreement on the way
        // out. Flagged rather than dropped: nothing else would retry this pass — the TTL
        // makes every later refresh a cache hit — and a trip left unbound creates a
        // duplicate Drive file on its next push, which is the bug rebinding exists to fix.
        if (this.busy) {
            this.reconcileMissed = true;
            return;
        }

        const boundFileIds = Object.values(this.trips).map(record => record.fileId);
        const byTripId: Record<string, CloudTripFile> = {};
        for (const file of files) {
            // Newest wins: `listCloudTrips` orders by modifiedTime, and duplicates sharing
            // one trip id are exactly what the missing rebind used to produce.
            if (file.tripId && !boundFileIds.includes(file.id) && !byTripId[file.tripId]) {
                byTripId[file.tripId] = file;
            }
        }
        if (Object.keys(byTripId).length === 0) return;

        for (const { profileId, yaml } of listLocalTrips()) {
            if (this.trips[profileId]) continue;
            const documentId = tripIdFromYaml(yaml);
            const file = documentId === null ? undefined : byTripId[documentId];
            if (!file || documentId === null) continue;
            // Two profiles holding one trip id (a copy made before ensureUniqueTripId) must
            // not both claim the file; the first one wins and the other stays unbound.
            delete byTripId[documentId];
            // `record.diverged` when they differ is the conflict — no separate in-memory
            // entry, which is what used to vanish on reload and let the next edit push.
            this.writeRecord(profileId, buildRebindRecord(file, yamlFingerprint(yaml)));
        }
    }

    /**
     * 儲存完同步. Debounced, because every trip edit goes through `persistTripData` — a
     * handful of checklist taps would otherwise be a handful of round-trips, and it is
     * that request rate which provokes the Drive rate limits that can split the app folder
     * in two. Safe to call unconditionally: it returns early unless the user opted in.
     */
    scheduleSync(yaml: string, tripId: string) {
        if (!this.autoSync || !this.isConnected) return;
        // An unresolved conflict is waiting on the user to pick a side; asking Drive again
        // on every keystroke cannot produce an answer we do not already have.
        if (this.conflictFor(tripId)) return;
        // The queue holds one trip. Switching trips inside the window must flush the
        // previous one rather than drop its push.
        if (this.pending && this.pending.tripId !== tripId) void this.flush();
        this.pending = { yaml, tripId };
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
        // Re-checked here for the same reason: a timer armed before a refresh found the
        // trip diverged would otherwise still fire, and `sync` would resolve the conflict
        // by overwriting one side of it. The edit is already in storage; the decision
        // strip is what sends it on.
        if (this.conflictFor(pending.tripId)) {
            this.cancelPending();
            return;
        }
        if (this.busy) {
            if (this.retries++ < MAX_SYNC_RETRIES) this.arm();
            return;
        }
        const result = await this.sync(pending.yaml, pending.tripId, { interactive: false });
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
            // The trip's own id out of the YAML, not `tripId` — that one names a local
            // profile slot and means nothing on another device, which is what made the
            // appProperty useless for recognising a trip after the local state was lost.
            tripId: tripIdFromYaml(yaml) ?? undefined,
        });
        // Fingerprinted from the bytes actually sent, not from whatever the editor holds
        // now: a save that landed mid-upload is not in `yaml`, and recording the current
        // content would mark that edit as sent and let the next sync drop it.
        this.adoptCloudTrip(tripId, res.id, yaml, res.md5Checksum);
        return res;
    }

    /**
     * Runs `action` under the busy lock: bails via `whenBusy` if a sync is already in
     * flight, otherwise holds `busy`/`isSyncing` for its duration and routes a thrown
     * error to `onError`. The one busy-lock shape every sync-style method needs.
     */
    private async withBusyLock<T>(
        whenBusy: () => T,
        action: () => Promise<T>,
        onError: (message: string) => T,
    ): Promise<T> {
        if (this.busy) return whenBusy();
        this.busy = true;
        this.isSyncing = true;
        try {
            return await action();
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            return onError(msg);
        } finally {
            this.isSyncing = false;
            this.busy = false;
            if (this.reconcileMissed) {
                this.reconcileMissed = false;
                // Forced, because the listing this replaces is inside the TTL window.
                void this.refreshFiles({ force: true });
            }
        }
    }

    /**
     * 按一下同步 — the one sync operation. Reconciles a trip with its Drive copy and
     * reports what it did.
     *
     * Never destructive on its own: a divergence surfaces as `conflict` with the record
     * left untouched, and the user resolves it by calling again with `force`. A `pulled`
     * result hands back the YAML for the caller to persist along with the `commit` that
     * records it — the record advances only when the caller says the bytes landed, so a
     * download it rejects cannot leave the trip claiming to hold a version it never took.
     *
     * `checkOnly` transfers nothing in either direction: it arms `pendingTransfer` so
     * 行程管理's button can offer 下載/上傳 as its own tap. That covers the push side too —
     * a clean trip decides `push` exactly when its Drive file has gone, and re-creating a
     * file the user deleted is not something a button labelled 比對 may do on its own.
     */
    async sync(
        localYaml: string,
        tripId: string,
        options: SyncOptions = {},
    ): Promise<SyncResult | null> {
        const interactive = options.interactive ?? true;
        if (!this.isConnected) return null;
        return this.withBusyLock(
            () => {
                if (interactive) showToast("同步進行中，請稍候…");
                return null;
            },
            async () => {
                this.syncPhase = "checking";
                // Any real attempt supersedes a snapshot from an earlier checkOnly tap;
                // re-armed below if this call is itself a checkOnly that finds the same thing.
                if (this.pendingTransfer?.tripId === tripId) this.pendingTransfer = null;
                try {
                    const token = await this.getValidToken(interactive ? "interactive" : "cache-only");
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
                            remoteHash: remoteFile?.contentHash ?? null,
                            localHash: yamlFingerprint(localYaml),
                        });

                    if (decision === "push") {
                        if (options.checkOnly) {
                            this.pendingTransfer = { tripId, direction: "push" };
                            if (interactive) {
                                showToast(
                                    remoteFile
                                        ? `雲端「${remoteFile.name}」落後於本機，可以上傳更新`
                                        : "雲端還沒有這趟行程的備份，可以上傳建立",
                                );
                            }
                            return { action: "push_ready", file: remoteFile ?? undefined };
                        }
                        this.syncPhase = "pushing";
                        // A record whose Drive copy is gone has to create a new file rather than
                        // PATCH the id that just answered 404.
                        const targetFileId = remoteFile && record ? record.fileId : null;
                        const res = await this.push(token, tripNameFromYaml(localYaml), localYaml, tripId, targetFileId);
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
                        void this.refreshFiles({ force: true });
                        return { action: "pushed", file: res };
                    }

                    // Every remaining decision came from a live remote, which is what produced it.
                    if (!record || !remoteFile) return null;

                    if (decision === "pull") {
                        if (options.checkOnly) {
                            // Arm the button's own "下載" tap rather than swapping the trip out
                            // from under a user who only asked to check.
                            this.pendingTransfer = { tripId, direction: "pull" };
                            if (interactive) showToast(`雲端「${remoteFile.name}」有新版本，可以下載更新`);
                            return { action: "pull_ready", file: remoteFile };
                        }
                        if (!interactive) {
                            // A debounced timer has nowhere to put the YAML and must not swap the
                            // trip the user is looking at, so it asks instead of downloading.
                            this.conflicts[tripId] = { tripId, fileName: remoteFile.name, kind: "remote-newer" };
                            return { action: "conflict", file: remoteFile };
                        }
                        this.syncPhase = "pulling";
                        const yaml = await downloadCloudTripYaml(token, record.fileId);
                        // Recording — and announcing — the download is the caller's to
                        // trigger once it has actually persisted these bytes.
                        return {
                            action: "pulled",
                            yaml,
                            file: remoteFile,
                            commit: () => {
                                this.adoptCloudTrip(tripId, record.fileId, yaml, remoteFile.md5Checksum);
                                showToast(`已載入雲端版本「${remoteFile.name}」`);
                            },
                        };
                    }

                    if (decision === "conflict") {
                        // Deliberately changes nothing: re-binding or overwriting here would
                        // abandon whichever copy the user has not seen yet.
                        this.conflicts[tripId] = { tripId, fileName: remoteFile.name, kind: "both-changed" };
                        if (interactive) {
                            showToast(`「${remoteFile.name}」雲端與本機都有修改，請選擇要保留哪一份`);
                        }
                        return { action: "conflict", file: remoteFile };
                    }

                    // Both sides having moved to the same content decides as up_to_date, but
                    // leaves the recorded base naming the copies they moved away from — the
                    // next real edit would then read as "both changed" and raise a conflict
                    // nobody caused. Re-recorded only on proven content equality: up_to_date
                    // is also reached with the remote's movement unknowable, and stamping an
                    // unverified base there is exactly what the checksums exist to prevent.
                    if (remoteFile.contentHash && remoteFile.contentHash === yamlFingerprint(localYaml)) {
                        this.adoptCloudTrip(tripId, record.fileId, localYaml, remoteFile.md5Checksum);
                    }
                    if (interactive) showToast(`「${remoteFile.name}」本地與雲端已是最新狀態`);
                    return { action: "up_to_date", file: remoteFile };
                } finally {
                    this.syncPhase = null;
                }
            },
            msg => {
                if (interactive) showToast(`同步失敗: ${msg}`);
                return null;
            },
        );
    }

    /**
     * Downloads a Drive copy together with its checksum, so the caller can adopt the exact
     * version it applied rather than trusting the cached listing. This is for opening a
     * cloud trip nothing local is bound to yet; reconciling a bound one is `sync`.
     */
    async loadTripYaml(fileId: string): Promise<{ yaml: string; md5?: string; } | null> {
        if (!this.isConnected) return null;
        return this.withBusyLock(
            () => {
                showToast("同步進行中，請稍候…");
                return null;
            },
            async () => {
                const token = await this.getValidToken();
                const [remote, yaml] = await Promise.all([
                    fetchCloudTripMeta(token, fileId),
                    downloadCloudTripYaml(token, fileId),
                ]);
                return { yaml, md5: remote?.md5Checksum };
            },
            msg => {
                showToast(`下載雲端行程失敗: ${msg}`);
                return null;
            },
        );
    }

    /**
     * 載入為新行程 — adopts a Drive file as a brand-new local profile: load →
     * validate → `createProfile` → `adoptCloudTrip`, the one sequence every
     * "load a cloud trip I am not bound to yet" entry point needs.
     *
     * Returns null when the download failed or `beforeCommit` refused — both have
     * already told the user why. On invalid YAML `yaml` still comes back so a caller
     * with an editing surface can seed it for correction; a caller without one
     * can ignore that field. `beforeCommit` runs only once validation succeeds,
     * right before `createProfile` reads the outgoing trip out of storage — the
     * one place a caller needs to flush its own in-memory edits first, and returning
     * false there aborts rather than parking a stale copy of the trip being replaced.
     */
    async importCloudTripAsProfile(
        fileId: string,
        beforeCommit?: () => boolean,
    ): Promise<{ ok: true; yaml: string; profileId: string; } | { ok: false; yaml: string; error: string; } | null> {
        const pulled = await this.loadTripYaml(fileId);
        if (!pulled) return null;
        const yaml = pulled.yaml;
        let parsed: TripData;
        try {
            parsed = validateYaml(yaml);
        } catch (err) {
            const error = err instanceof Error ? err.message : "雲端 YAML 格式錯誤，請檢查！";
            return { ok: false, yaml, error };
        }
        if (beforeCommit && !beforeCommit()) return null;
        // A file whose trip this device already holds — a duplicate in Drive, or a copy
        // the last rebind pass missed — arrives as a second trip, not as that one. Sharing
        // an id would make the two fight over a single cloud file.
        const reIdentified = ensureUniqueTripId(parsed);
        const localYaml = reIdentified ? serializeToYaml(parsed) : yaml;
        const profileId = createProfile(localYaml);
        // Only the copy that kept the file's identity is that file's trip. Binding a
        // re-identified one would hand it the very cloud file it was split away from; left
        // unbound it gets a file of its own on the next push.
        if (!reIdentified) {
            // The bytes just downloaded, not the cached listing's checksum: a stale entry
            // would record an agreement matching no version and report a conflict nobody
            // caused.
            this.adoptCloudTrip(profileId, fileId, yaml, pulled.md5);
        }
        return { ok: true, yaml: localYaml, profileId };
    }

    async deleteTrip(fileId: string): Promise<boolean> {
        return this.withBusyLock(
            () => {
                showToast("同步進行中，請稍候…");
                return false;
            },
            async () => {
                const token = await this.getValidToken();
                await deleteCloudTrip(token, fileId);
                // Any trip still bound to it would PATCH a file that no longer exists.
                Object.entries(this.trips)
                    .filter(([, record]) => record.fileId === fileId)
                    .forEach(([tripId]) => this.unbindTrip(tripId));
                showToast("已從 Google Drive 刪除行程");
                void this.refreshFiles({ force: true });
                return true;
            },
            msg => {
                showToast(`刪除失敗: ${msg}`);
                return false;
            },
        );
    }
}

export const gdriveSync = new GDriveSyncState();
