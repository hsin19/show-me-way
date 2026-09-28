// Google Drive sync for one trip at a time, on top of infra/http/gdrive.ts: the pure
// decisions (`decideSyncAction` for direction, `buildRebindRecord` for a file found
// without a binding) and `planCloudSync`, which reads a trip's remote and hands back the
// transfer it implies. What lives here is the device's side — the records, the conflicts
// awaiting the user, the toasts. The mental model, in the order things go wrong:
//
// - The trip → file binding in `showmeway_gdrive_trips` is a rebuildable cache, not a
//   record of truth: `reconcileBindings` re-derives a lost one after every listing from
//   each file's `appProperties.showmewayTripId`, so a sign-out or evicted storage does
//   not produce a duplicate cloud file.
// - Nothing here transfers on its own. Every push and pull is a tap — the decision
//   strip's, the cloud button's, or the one on the toast TripStore raises once an edit
//   settles — so this module answers questions (`cloudActionFor`, `hasUnpushedEdits`)
//   and acts only when called.
// - A conflict changes nothing on either side. It leaves the decision to 行程管理's
//   strip; `force` is how the user's answer comes back in. `diverged` lives on the
//   record so the hold survives a reload.
// - A `pulled` result is not yet recorded. The caller lands the bytes first and only
//   then runs `commit`; recording ahead of that claims a version this device never took.
// - `checkOnly` transfers nothing in either direction — a clean trip whose Drive file is
//   gone decides `push`, and a button labelled 比對 may not re-create a deleted file.

import { googleClientId } from "$lib/config";
import { yamlFingerprint } from "$lib/domain/utils";
import {
    agreedRecord,
    buildRebindRecord,
    clearCachedAccessToken,
    clearDeadShareLink,
    clearGdriveUser,
    type CloudTripFile,
    decideSyncAction,
    deleteCloudTrip,
    fetchCloudTrip,
    fetchGoogleUserInfo,
    getCachedAccessToken,
    type GoogleAuthPrompt,
    type GoogleUser,
    listCloudTrips,
    loadGdriveUser,
    loadTripSyncMap,
    planCloudSync,
    rebindCandidates,
    requestGoogleAccessToken,
    saveGdriveUser,
    saveTripSyncMap,
    type TripSyncMap,
    type TripSyncRecord,
    updateCloudShareLink,
} from "$lib/infra/http/gdrive";
import {
    listLocalTrips,
    tripIdFromYaml,
} from "$lib/infra/storage/profiles";
import type { ShareLinkRecord } from "$lib/infra/storage/share-links";
import { SvelteSet } from "svelte/reactivity";
import { shareLinks } from "./share-link.svelte";
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
type CloudListState = "idle" | "loading" | "ready" | "failed";

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

export interface SyncOptions {
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

class GDriveSyncState {
    user = $state<GoogleUser | null>(loadGdriveUser());
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

    clientId = $derived<string>(googleClientId());
    isConnected = $derived<boolean>(!!this.user);

    // Write operations only, so a background list refresh cannot clear it out from under a
    // sync that is still running.
    private busy = false;
    private lastRefreshAt = 0;
    private refreshInFlight: Promise<CloudTripFile[]> | null = null;
    /** A listing landed mid-sync and skipped its rebind pass; `withBusyLock` re-runs it on the way out. */
    private reconcileMissed = false;

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
     * what both sides now agree on, and the share link the file carries as this trip's.
     * The caller must have persisted `yaml` first.
     */
    adoptCloudTrip(tripId: string, fileId: string, yaml: string, remoteMd5?: string, shareLink?: ShareLinkRecord) {
        this.adopt(tripId, agreedRecord(fileId, yaml, remoteMd5));
        if (shareLink) shareLinks.adopt(tripId, shareLink);
    }

    /** Stores an agreement both sides hold, which is also what settles any conflict on the trip. */
    private adopt(tripId: string, record: TripSyncRecord) {
        this.writeRecord(tripId, record);
        delete this.conflicts[tripId];
    }

    /** Forgets a trip's Drive binding and everything remembered about it. */
    unbindTrip(tripId: string) {
        delete this.trips[tripId];
        saveTripSyncMap({ ...this.trips });
        delete this.conflicts[tripId];
        if (this.pendingTransfer?.tripId === tripId) this.pendingTransfer = null;
    }

    /**
     * Takes the share link a trip's Drive file carries, so every device of the owner's
     * updates one link rather than minting its own. Called wherever a file's metadata
     * reaches a slot it is bound to; `adopt` itself is idempotent and never clears.
     */
    private absorbShareLink(tripId: string, file: CloudTripFile) {
        if (file.shareLink) shareLinks.adopt(tripId, file.shareLink);
    }

    /** The listing is the one place every bound trip's metadata arrives at once. */
    private absorbListedShareLinks(files: CloudTripFile[]) {
        const byFileId = new Map(files.map(file => [file.id, file]));
        for (const [tripId, record] of Object.entries(this.trips)) {
            const file = byFileId.get(record.fileId);
            if (file) this.absorbShareLink(tripId, file);
        }
    }

    /**
     * Writes this trip's share link — or its absence, after a revoke — onto the bound Drive
     * file, without touching the trip's content. Best effort and silent: minting a link
     * must not fail because Drive is unreachable, and the next push carries the same
     * properties anyway. Skipped while a sync holds the lock, for that same reason.
     */
    async pushShareLink(tripId: string): Promise<void> {
        const fileId = this.cloudFileId(tripId);
        if (!this.isConnected || !fileId || this.busy) return;
        try {
            const token = await this.getValidToken("cache-only");
            await updateCloudShareLink(token, fileId, shareLinks.forTrip(tripId));
        } catch (err) {
            console.warn("Failed to publish the share link to Drive:", err);
        }
    }

    /**
     * Takes a link hop refused off the bound Drive file, if the file still carries it — see
     * `clearDeadShareLink`. Best effort and silent: a miss leaves the dead link on Drive
     * until the next share that reaches hop finds it again, since no sync push clears it.
     * Unlike `pushShareLink` it runs during a sync: that push leaves these properties alone.
     */
    async dropDeadShareLink(tripId: string, linkId: string): Promise<void> {
        const fileId = this.cloudFileId(tripId);
        if (!this.isConnected || !fileId) return;
        try {
            await clearDeadShareLink(await this.getValidToken("cache-only"), fileId, linkId);
        } catch (err) {
            console.warn("Failed to drop the dead share link from Drive:", err);
        }
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
     * Whether this trip has edits its Drive file has not been told about — the question the
     * publish prompt is raised from. False for a trip with no binding at all: an edit to a
     * trip that has never been uploaded is not an unsynced change, it is a trip that does
     * not sync. False while a conflict holds it, too; that decision belongs to 行程管理's
     * strip and a second prompt for the same trip would only compete with it.
     */
    hasUnpushedEdits(tripId: string, localYaml: string): boolean {
        if (!this.isConnected || !this.cloudFileId(tripId)) return false;
        if (this.conflictFor(tripId)) return false;
        return this.tripSyncState(tripId, localYaml) === "dirty";
    }

    /**
     * What deleting this device's copy of `tripId` would leave in Drive — the question a
     * local delete's confirm is worded from. `none` is no copy at all; `behind` a copy
     * missing edits made here (or caught in a divergence), which the delete would lose;
     * `kept` a copy holding at least everything local does, reloadable from the cloud list
     * once the delete unbinds it.
     *
     * Not gated on being signed in: signing out leaves the file in Drive. The listing is
     * consulted only to spot a bound file that has since gone, and only once it has
     * actually loaded — a stale or missing listing falls back to trusting the binding.
     */
    cloudCopyFor(tripId: string, localYaml: string): "none" | "behind" | "kept" {
        const fileId = this.cloudFileId(tripId);
        if (!fileId) return "none";
        if (this.cloudListState === "ready" && !this.cloudFiles.some(file => file.id === fileId)) return "none";
        if (this.conflictFor(tripId)?.kind === "both-changed") return "behind";
        return this.tripSyncState(tripId, localYaml) === "dirty" ? "behind" : "kept";
    }

    /**
     * What the last listing implies for `tripId`, without asking Drive again: a download
     * waiting (`pull`), or a divergence only the user can settle (`conflict`). Null when
     * there is nothing to offer — no binding, the file missing from the listing, or the
     * only movement being local, which is the publish prompt's business rather than this
     * one's.
     *
     * Reads `cloudFiles`, so it costs no request and can run on every foreground: the
     * listing already carries both checksums, which is the whole reason `contentHash` is
     * published. The answer is therefore only as fresh as the listing — whoever acts on it
     * goes through `sync`, which re-decides against a live `files.get` and turns a stale
     * `pull` into `up_to_date` rather than transferring on this snapshot.
     */
    remoteStatusFor(tripId: string, localYaml: string): "pull" | "conflict" | null {
        if (!this.isConnected) return null;
        const record = this.trips[tripId] ?? null;
        if (!record) return null;
        const file = this.cloudFiles.find(candidate => candidate.id === record.fileId);
        if (!file) return null;
        const decision = decideSyncAction({
            record,
            remoteExists: true,
            remoteMd5: file.md5Checksum ?? null,
            remoteHash: file.contentHash ?? null,
            localHash: yamlFingerprint(localYaml),
        });
        return decision === "pull" || decision === "conflict" ? decision : null;
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

    /**
     * Signed in, but holding no usable token — the state every background path stops at,
     * since only a tap may reach GIS. Read at call time, not reactive: the cache is
     * localStorage and expires on the clock.
     */
    needsReconnect(): boolean {
        return this.isConnected && !getCachedAccessToken();
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
                this.absorbListedShareLinks(files);
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

        const byTripId = rebindCandidates(files, Object.values(this.trips).map(record => record.fileId));
        if (Object.keys(byTripId).length === 0) return;

        for (const { profileId, yaml } of listLocalTrips()) {
            if (this.trips[profileId]) continue;
            const documentId = tripIdFromYaml(yaml);
            const file = documentId === null ? undefined : byTripId[documentId];
            if (!file || documentId === null) continue;
            // Two profiles holding one trip id (a copy made before copies were re-identified)
            // must not both claim the file; the first one wins and the other stays unbound.
            delete byTripId[documentId];
            // `record.diverged` when they differ is the conflict — no separate in-memory
            // entry, which is what used to vanish on reload and let the next edit push.
            this.writeRecord(profileId, buildRebindRecord(file, yamlFingerprint(yaml)));
            this.absorbShareLink(profileId, file);
        }
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
                    const plan = await planCloudSync(token, this.trips[tripId] ?? null, localYaml, options.force);
                    // Every decision other than push comes from a live remote; a forced pull with none has nothing to take.
                    if (!plan) return null;
                    if (plan.remoteFile) this.absorbShareLink(tripId, plan.remoteFile);

                    if (plan.decision === "push") {
                        if (options.checkOnly) {
                            this.pendingTransfer = { tripId, direction: "push" };
                            if (interactive) {
                                showToast(
                                    plan.remoteFile
                                        ? `雲端「${plan.remoteFile.name}」落後於本機，可以上傳更新`
                                        : "雲端還沒有這趟行程的備份，可以上傳建立",
                                );
                            }
                            return { action: "push_ready", file: plan.remoteFile ?? undefined };
                        }
                        this.syncPhase = "pushing";
                        // Undefined, not null, when this device holds no link: absence means "leave
                        // whatever the file carries" — only a revoke clears it. The properties are
                        // metadata, so nothing here reaches the YAML a recipient decrypts. Read
                        // after `absorbShareLink`, so a link the file just taught this device rides along.
                        const pushed = await plan.push(shareLinks.forTrip(tripId) ?? undefined);
                        this.adopt(tripId, pushed.record);
                        const res = pushed.file;
                        if (interactive) {
                            // A forced push is the user resolving a conflict, so say what it cost
                            // rather than reporting it as a routine sync.
                            showToast(
                                options.force === "local"
                                    ? `已以本機版本覆蓋雲端「${res.name}」`
                                    : plan.remoteFile
                                    ? `已同步「${res.name}」到 Google Drive`
                                    : `已建立雲端備份「${res.name}」`,
                            );
                        }
                        void this.refreshFiles({ force: true });
                        return { action: "pushed", file: res };
                    }

                    const { remoteFile } = plan;
                    if (plan.decision === "pull") {
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
                        const pulled = await plan.pull();
                        // Recording — and announcing — the download is the caller's to
                        // trigger once it has actually persisted these bytes.
                        return {
                            action: "pulled",
                            yaml: pulled.yaml,
                            file: remoteFile,
                            commit: () => {
                                this.adopt(tripId, pulled.record);
                                showToast(`已載入雲端版本「${remoteFile.name}」`);
                            },
                        };
                    }

                    if (plan.decision === "conflict") {
                        // Deliberately changes nothing: re-binding or overwriting here would
                        // abandon whichever copy the user has not seen yet.
                        this.conflicts[tripId] = { tripId, fileName: remoteFile.name, kind: "both-changed" };
                        if (interactive) {
                            showToast(`「${remoteFile.name}」雲端與本機都有修改，請選擇要保留哪一份`);
                        }
                        return { action: "conflict", file: remoteFile };
                    }

                    if (plan.settled) this.adopt(tripId, plan.settled);
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
    async loadTripYaml(fileId: string): Promise<{ yaml: string; md5?: string; shareLink?: ShareLinkRecord; } | null> {
        if (!this.isConnected) return null;
        return this.withBusyLock(
            () => {
                showToast("同步進行中，請稍候…");
                return null;
            },
            async () => {
                const token = await this.getValidToken();
                const { yaml, remoteFile } = await fetchCloudTrip(token, fileId);
                return { yaml, md5: remoteFile?.md5Checksum, shareLink: remoteFile?.shareLink };
            },
            msg => {
                showToast(`下載雲端行程失敗: ${msg}`);
                return null;
            },
        );
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
