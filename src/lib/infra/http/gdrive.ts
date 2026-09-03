export const GDRIVE_USER_STORAGE = "showmeway_gdrive_user";
const GDRIVE_TOKEN_STORAGE = "showmeway_gdrive_token";
const GDRIVE_AUTO_SYNC_STORAGE = "showmeway_gdrive_auto_sync";
const GDRIVE_FOLDER_ID_STORAGE = "showmeway_gdrive_folder_id";
export const GDRIVE_TRIPS_STORAGE = "showmeway_gdrive_trips";

import { tripStartDateFromYaml } from "$lib/infra/storage/profiles";
import {
    readCachedJson,
    removeCachedKeys,
    writeCachedJson,
} from "$lib/infra/storage/storage-cache";

export const GDRIVE_FOLDER_NAME = "ShowMeWay";
/** Checked explicitly after consent; the userinfo scopes fail loudly in `connect()` instead. */
const GDRIVE_SCOPE_DRIVE_FILE = "https://www.googleapis.com/auth/drive.file";

const GDRIVE_OAUTH_SCOPES = [
    GDRIVE_SCOPE_DRIVE_FILE,
    "https://www.googleapis.com/auth/userinfo.email",
    "https://www.googleapis.com/auth/userinfo.profile",
].join(" ");

export interface GoogleUser {
    email: string;
    name: string;
    picture?: string;
}

export interface CloudTripFile {
    id: string;
    name: string;
    modifiedTime: string;
    size?: number;
    /** The trip's own `trip.id`, carried in `appProperties` so any device can recognise it. */
    tripId?: string;
    startDate?: string;
    md5Checksum?: string;
    /**
     * `yamlFingerprint` of the content this app last wrote, carried in `appProperties`.
     * Unlike `md5Checksum` it is a claim rather than a measurement — an edit made outside
     * this app leaves it stale — so `decideSyncAction` only trusts it where md5 cannot
     * contradict it. What it buys is the one question md5 cannot answer: whether the
     * remote copy is byte-identical to the local one, without downloading it.
     */
    contentHash?: string;
}

/**
 * What both sides looked like at this trip's last successful sync — one record per trip,
 * so a binding can never exist without the checksums that make it safe to write through.
 */
export interface TripSyncRecord {
    fileId: string;
    /** Drive's md5 for that agreed copy. Absent until a sync records one. */
    remoteMd5?: string;
    /** `yamlFingerprint` of the local YAML at that same moment. */
    localHash?: string;
    /**
     * `yamlFingerprint` of the remote copy at that same moment. Equal to `localHash` by
     * construction — an agreement is only ever recorded from bytes both sides hold — and
     * kept separately anyway so a remote-side comparison never has to assume that.
     */
    remoteHash?: string;
    /**
     * A rebind bound this file to a trip whose contents differ from it, and the user has
     * not picked a side yet. Persisted rather than held as UI state because the record it
     * sits on is persisted: it has no `localHash`, which on its own decides `push`, and a
     * conflict that lives only in memory stops holding the trip the moment the app
     * reloads. `decideSyncAction` reads it, so nothing can push past it by accident.
     */
    diverged?: boolean;
}

export type TripSyncMap = Record<string, TripSyncRecord>;

const FALLBACK_CLIENT_ID = "849908319136-che7nc9nag6ua5gd3fipk9evme4ngjde.apps.googleusercontent.com";

export function getGdriveClientId(): string {
    const id = (typeof import.meta !== "undefined" && import.meta.env?.VITE_GOOGLE_CLIENT_ID) as string | undefined;
    if (id && id.trim()) return id.trim();
    return FALLBACK_CLIENT_ID;
}

function isValidGoogleUser(value: unknown): value is GoogleUser {
    return !!value
        && typeof value === "object"
        && typeof (value as GoogleUser).email === "string"
        && typeof (value as GoogleUser).name === "string";
}

export function loadGdriveUser(): GoogleUser | null {
    return readCachedJson(GDRIVE_USER_STORAGE, isValidGoogleUser);
}

export function saveGdriveUser(user: GoogleUser): void {
    writeCachedJson(GDRIVE_USER_STORAGE, user);
}

export function clearGdriveUser(): void {
    removeCachedKeys([GDRIVE_USER_STORAGE]);
}

function isBoolean(value: unknown): value is boolean {
    return typeof value === "boolean";
}

export function loadGdriveAutoSync(): boolean {
    return readCachedJson(GDRIVE_AUTO_SYNC_STORAGE, isBoolean) ?? false;
}

export function saveGdriveAutoSync(enabled: boolean): void {
    writeCachedJson(GDRIVE_AUTO_SYNC_STORAGE, enabled);
}

function loadGdriveFolderId(): string | null {
    try {
        return localStorage.getItem(GDRIVE_FOLDER_ID_STORAGE);
    } catch {
        return null;
    }
}

/** Exported for the store tests, which pre-seed the folder to skip the lookup round trip. */
export function saveGdriveFolderId(folderId: string): void {
    try {
        localStorage.setItem(GDRIVE_FOLDER_ID_STORAGE, folderId);
    } catch (e) {
        console.warn("Failed to save Google Drive Folder ID", e);
    }
}

export function loadTripSyncMap(): TripSyncMap {
    try {
        const raw = localStorage.getItem(GDRIVE_TRIPS_STORAGE);
        if (!raw) return {};
        const parsed: unknown = JSON.parse(raw);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
        const out: TripSyncMap = {};
        for (const [tripId, value] of Object.entries(parsed as Record<string, unknown>)) {
            // A record without a fileId names no Drive file, so it can only mislead.
            if (value && typeof value === "object" && typeof (value as TripSyncRecord).fileId === "string") {
                out[tripId] = value as TripSyncRecord;
            }
        }
        return out;
    } catch {
        return {};
    }
}

export function saveTripSyncMap(map: TripSyncMap): void {
    try {
        localStorage.setItem(GDRIVE_TRIPS_STORAGE, JSON.stringify(map));
    } catch (e) {
        console.warn("Failed to save Google Drive sync state", e);
    }
}

/**
 * A short fingerprint of a trip's YAML, for answering "has this changed since the last
 * sync" by comparing content instead of by remembering an event.
 *
 * Deliberately not a cryptographic digest: it is only ever compared against another
 * fingerprint this app produced, never against Drive's md5, so FNV-1a over two seeds plus
 * the length is enough. `crypto.subtle` has no MD5 and is async, which would make the
 * sync decision async for no gain.
 *
 * It is compared across sides as well as across time — the remote's copy rides along in
 * `appProperties.contentHash` — so a collision no longer only costs a skipped upload: two
 * genuinely different trips would be declared identical and the divergence would never be
 * raised. 64 bits plus the length over hand-authored YAML makes that vanishingly unlikely,
 * but widen the use again and this is the sentence to re-check.
 */
export function yamlFingerprint(yaml: string): string {
    let a = 0x811c9dc5;
    let b = 0x01000193;
    for (let i = 0; i < yaml.length; i++) {
        const code = yaml.charCodeAt(i);
        a = Math.imul(a ^ code, 0x01000193);
        b = Math.imul(b ^ (code + i), 0x85ebca6b);
    }
    const hex = (n: number) => (n >>> 0).toString(16).padStart(8, "0");
    return `${yaml.length.toString(36)}-${hex(a)}${hex(b)}`;
}

/** Keys the earlier sync schemes wrote, before the one record per trip. */
const LEGACY_KEY_PREFIXES = ["showmeway_gdrive_mod_"];
const LEGACY_FILE_MAP_KEY = "showmeway_gdrive_file_map";
const LEGACY_MD5_MAP_KEY = "showmeway_gdrive_md5_map";
const LEGACY_DIRTY_MAP_KEY = "showmeway_gdrive_dirty_map";

/**
 * Folds the earlier per-concern maps into the single record map and removes them.
 * Idempotent, so it is safe to call on every load.
 *
 * The dirty flags are dropped rather than carried: a record with no `localHash` already
 * means "assume local changed", which is the same conclusion and one fewer thing to keep
 * in step.
 */
export function migrateGdriveSyncState(): void {
    try {
        const rawFiles = localStorage.getItem(LEGACY_FILE_MAP_KEY);
        if (rawFiles) {
            const files: unknown = JSON.parse(rawFiles);
            const md5s: unknown = JSON.parse(localStorage.getItem(LEGACY_MD5_MAP_KEY) ?? "{}");
            if (files && typeof files === "object" && !Array.isArray(files)) {
                const map = loadTripSyncMap();
                for (const [tripId, fileId] of Object.entries(files as Record<string, unknown>)) {
                    if (typeof fileId !== "string" || map[tripId]) continue;
                    const md5 = (md5s as Record<string, unknown>)?.[tripId];
                    map[tripId] = { fileId, remoteMd5: typeof md5 === "string" ? md5 : undefined };
                }
                saveTripSyncMap(map);
            }
        }
        [LEGACY_FILE_MAP_KEY, LEGACY_MD5_MAP_KEY, LEGACY_DIRTY_MAP_KEY].forEach(key => localStorage.removeItem(key));

        const stale: string[] = [];
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key && LEGACY_KEY_PREFIXES.some(prefix => key.startsWith(prefix))) stale.push(key);
        }
        stale.forEach(key => localStorage.removeItem(key));
    } catch (e) {
        console.warn("Failed to migrate Google Drive sync state", e);
    }
}

/** What a sync should do, given what both sides last agreed on. */
export type SyncDecision = "push" | "pull" | "up_to_date" | "conflict";

/**
 * Whether the remote copy moved since the last agreement, or `null` when neither side of
 * the comparison is available.
 *
 * Drive's md5 is asked first and is final: it measures the bytes, so it catches an edit
 * made outside this app — in Drive's own UI, by a desktop sync client, or by restoring a
 * version — which `contentHash` cannot, being a value this app writes and only refreshes
 * when it writes the file itself.
 */
function remoteMoved(record: TripSyncRecord, remoteMd5: string | null, remoteHash: string | null): boolean | null {
    if (record.remoteMd5 && remoteMd5) return remoteMd5 !== record.remoteMd5;
    if (record.remoteHash && remoteHash) return remoteHash !== record.remoteHash;
    return null;
}

/**
 * The whole sync direction decision, kept pure so the truth table is testable.
 *
 * Three memories drive it. Two are per-side history: `record.localHash` says what the
 * local YAML looked like at the last successful sync, `record.remoteMd5`/`remoteHash` what
 * Drive held at that same moment. Comparing each against its current value answers "did
 * this side move" without ever comparing two clocks — the device's clock and Google's are
 * not comparable, and doing so is what used to discard whichever side the phone's clock
 * disagreed with. The third is `remoteHash` vs `localHash`, which answers a question no
 * history can: whether the two sides are byte-identical *right now*. It exists only
 * because `yamlFingerprint` runs on both sides; Drive's md5 has no local counterpart
 * (`crypto.subtle` has no MD5).
 *
 * Rule order, and why the first one comes first:
 *   1. remote moved, local did not              → pull
 *   2. contents are equal                       → up_to_date
 *   3. remote moved (so local did too)          → conflict
 *   4. remote did not move                      → push / up_to_date
 *   5. unknowable, but contents differ          → conflict / pull
 *   6. unknowable                               → conflict / up_to_date
 * Rule 1 outranks rule 2 deliberately: equal hashes with a moved md5 is the signature of
 * an edit made outside this app, where the hash is stale and the bytes are authoritative.
 * Taking the remote there loses nothing; trusting the hash would silently overwrite that
 * edit on the next push.
 *
 * Rule 5 reads the equality backwards to recover a direction the history could not supply:
 * an agreement is only ever recorded from bytes both sides hold, so "local has not moved
 * and the contents now differ" can only mean the remote did.
 *
 * `push` covers creating the file too: no record, or a record whose Drive copy is gone,
 * both mean there is nothing to overwrite.
 *
 * Two deliberate asymmetries:
 * - A record with no remote memory at all (migrated from the timestamp scheme) resolves to
 *   `push`. This is the ONE case that can overwrite a remote another device advanced: with
 *   nothing agreed there is nothing to compare, and the alternative — prompting every
 *   upgrading install on its first sync — trades a rare loss for certain noise.
 * - A live remote that reports neither md5 nor `contentHash` is unknowable rather than
 *   unchanged, so it never silently pushes: it asks, or does nothing.
 */
export function decideSyncAction(state: {
    record: TripSyncRecord | null;
    remoteExists: boolean;
    remoteMd5: string | null;
    remoteHash: string | null;
    localHash: string;
}): SyncDecision {
    const { record } = state;
    if (!record || !state.remoteExists) return "push";
    if (!record.remoteMd5 && !record.remoteHash) return "push";

    // No recorded fingerprint means the last sync predates them: assume local moved.
    const localChanged = record.localHash === undefined || record.localHash !== state.localHash;
    const remoteChanged = remoteMoved(record, state.remoteMd5, state.remoteHash);
    const sameContent = state.remoteHash === null ? null : state.remoteHash === state.localHash;

    // An unresolved rebind outranks every direction below: the record deliberately holds
    // no base, so those rules would read it as "local moved" and overwrite a cloud copy
    // the user has never seen. Only the two sides turning out to hold the same content
    // settles it without a decision — see `buildRebindRecord`.
    if (record.diverged) return sameContent === true ? "up_to_date" : "conflict";

    if (remoteChanged === true && !localChanged) return "pull";
    if (sameContent === true) return "up_to_date";
    if (remoteChanged === true) return "conflict";
    if (remoteChanged === false) return localChanged ? "push" : "up_to_date";
    if (sameContent === false) return localChanged ? "conflict" : "pull";
    return localChanged ? "conflict" : "up_to_date";
}

/**
 * The record to write for a Drive file that names this trip but which this device holds no
 * binding for — after a sign-out, a reinstall, or storage being evicted. Kept pure and
 * separate from `decideSyncAction` because the question is a different one: not "which way
 * should this sync go" but "is there an agreement here to record at all".
 *
 * Whether they agree is the whole point of publishing `contentHash`: the two copies can be compared
 * without downloading either, so the common rebind — you signed back in and nothing had
 * changed — costs one listing and recovers a complete merge base.
 *
 * When they differ there is no agreement to record, and `localHash` is deliberately left
 * out rather than filled with the current value: writing it would claim the two sides
 * agreed on contents they never shared, and the next sync would call that up_to_date and
 * quietly overwrite one of them. The record still names the file, which is what stops a
 * duplicate being created, and carries `diverged` so it holds the trip by itself —
 * `decideSyncAction` refuses to push past it until the user picks a side. The flag is on
 * the record rather than in the caller's UI state because a missing `localHash` decides
 * `push`, and anything the caller keeps in memory stops holding it at the next reload.
 */
export function buildRebindRecord(
    file: { id: string; md5Checksum?: string; contentHash?: string; },
    localHash: string,
): TripSyncRecord {
    const agreed = !!file.contentHash && file.contentHash === localHash;
    return {
        fileId: file.id,
        remoteMd5: file.md5Checksum,
        remoteHash: file.contentHash,
        ...(agreed ? { localHash } : { diverged: true }),
    };
}

/**
 * Throws on a non-ok Drive response, dropping the cached token when Google rejected it.
 *
 * 401 only, deliberately: a Drive 403 is usually `rateLimitExceeded`, and clearing a
 * perfectly good token for that would trade a retryable error for a consent popup. A
 * 403 from a missing scope is caught at connect time instead.
 */
function assertDriveOk(res: Response, message: string): void {
    if (res.ok) return;
    if (res.status === 401) clearCachedAccessToken();
    throw new Error(`${message} (${res.status})`);
}

interface CachedTokenData {
    token: string;
    expiresAt: number;
}

export function getCachedAccessToken(): string | null {
    try {
        const raw = localStorage.getItem(GDRIVE_TOKEN_STORAGE);
        if (!raw) return null;
        const data: unknown = JSON.parse(raw);
        if (
            data
            && typeof data === "object"
            && "token" in data
            && "expiresAt" in data
            && typeof (data as CachedTokenData).token === "string"
            && typeof (data as CachedTokenData).expiresAt === "number"
        ) {
            const cached = data as CachedTokenData;
            // 60-second buffer before actual token expiration
            if (Date.now() < cached.expiresAt - 60000) {
                return cached.token;
            }
        }
        return null;
    } catch {
        return null;
    }
}

export function setCachedAccessToken(token: string, expiresInSeconds: number): void {
    try {
        const data: CachedTokenData = {
            token,
            expiresAt: Date.now() + expiresInSeconds * 1000,
        };
        localStorage.setItem(GDRIVE_TOKEN_STORAGE, JSON.stringify(data));
    } catch (e) {
        console.warn("Failed to cache Google Drive Token", e);
    }
}

export function clearCachedAccessToken(): void {
    try {
        localStorage.removeItem(GDRIVE_TOKEN_STORAGE);
    } catch (e) {
        console.warn("Failed to clear Google Drive Token", e);
    }
}

const GIS_SCRIPT_SRC = "https://accounts.google.com/gsi/client";

// One shared attempt per page, rather than re-querying the DOM for an existing tag.
// `load`/`error` do not replay, so listeners attached to a <script> that already failed
// never fire — and since that dead tag stayed in the head, the next call found it and
// returned a promise that could never settle, latching every caller's loading flag on.
let gisLoadPromise: Promise<void> | null = null;

/** Loads the Google Identity Services SDK. Rejects (rather than hanging) when offline. */
function loadGisScript(): Promise<void> {
    if (typeof window === "undefined") return Promise.resolve();
    if (typeof (window as unknown as { google?: { accounts?: { oauth2?: unknown; }; }; }).google?.accounts?.oauth2 !== "undefined") {
        return Promise.resolve();
    }
    if (gisLoadPromise) return gisLoadPromise;

    const attempt = new Promise<void>((resolve, reject) => {
        const script = document.createElement("script");
        script.src = GIS_SCRIPT_SRC;
        script.async = true;
        script.defer = true;
        script.onload = () => resolve();
        script.onerror = () => {
            script.remove();
            reject(new Error("無法載入 Google 登入模組，請檢查網路連線"));
        };
        document.head.appendChild(script);
    });
    // A failure must not poison later calls: forget it so a retry once the network is
    // back injects the script again instead of replaying the rejection forever.
    attempt.catch(() => {
        if (gisLoadPromise === attempt) gisLoadPromise = null;
    });
    gisLoadPromise = attempt;
    return attempt;
}

interface TokenResponse {
    access_token?: string;
    expires_in?: number;
    scope?: string;
    error?: string;
    error_description?: string;
}

/**
 * The prompts this app asks GIS for.
 *
 * `"none"` is deliberately absent. It reads like a silent refresh and is not one: the
 * token model supports only the dialog UX, so GIS still calls `window.open` — measured,
 * one open and zero iframes — and the user sees the same flash. Worse, it then failed
 * with `Popup window closed` and returned no token, so it costs the flash and buys
 * nothing. Anything that must not open a window has to stop at the cached token.
 */
export type GoogleAuthPrompt = "" | "consent" | "select_account";

/** The prompts whose whole purpose is to re-ask, so a cached token would defeat them. */
const CACHE_BYPASSING_PROMPTS: GoogleAuthPrompt[] = ["consent", "select_account"];

/** Request OAuth access token using Google Identity Services */
export async function requestGoogleAccessToken(
    clientId: string,
    prompt: GoogleAuthPrompt = "",
): Promise<{ token: string; expiresIn: number; }> {
    const cached = getCachedAccessToken();
    if (cached && !CACHE_BYPASSING_PROMPTS.includes(prompt)) {
        return { token: cached, expiresIn: 3600 };
    }

    await loadGisScript();

    const google = (window as unknown as {
        google?: {
            accounts?: {
                oauth2?: {
                    initTokenClient: (config: {
                        client_id: string;
                        scope: string;
                        prompt?: string;
                        callback: (resp: TokenResponse) => void;
                        error_callback?: (err: unknown) => void;
                    }) => { requestAccessToken: (opts?: { prompt?: string; }) => void; };
                };
            };
        };
    }).google;

    if (!google?.accounts?.oauth2) {
        throw new Error("Google Identity Services 未正確初始化");
    }

    return new Promise((resolve, reject) => {
        try {
            const client = google.accounts!.oauth2!.initTokenClient({
                client_id: clientId,
                scope: GDRIVE_OAUTH_SCOPES,
                prompt,
                callback: (resp: TokenResponse) => {
                    if (resp.error) {
                        reject(new Error(`Google 登入失敗: ${resp.error_description || resp.error}`));
                        return;
                    }
                    if (!resp.access_token) {
                        reject(new Error("Google 登入未回傳有效 Token"));
                        return;
                    }
                    // Granular consent lets the user approve sign-in and still decline
                    // the Drive checkbox. Without this the token caches for an hour and
                    // the UI reports 已連線 while every Drive call comes back 403.
                    if (resp.scope && !resp.scope.split(" ").includes(GDRIVE_SCOPE_DRIVE_FILE)) {
                        reject(new Error("未取得 Google 雲端硬碟權限，請在授權畫面允許存取雲端硬碟"));
                        return;
                    }
                    const expiresIn = resp.expires_in ?? 3599;
                    setCachedAccessToken(resp.access_token, expiresIn);
                    resolve({ token: resp.access_token, expiresIn });
                },
                error_callback: (err: unknown) => {
                    reject(new Error(`Google 登入發生錯誤: ${String(err)}`));
                },
            });

            client.requestAccessToken({ prompt });
        } catch (e) {
            reject(e instanceof Error ? e : new Error(String(e)));
        }
    });
}

/** Fetch user profile info using the access token */
export async function fetchGoogleUserInfo(token: string): Promise<GoogleUser> {
    const res = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
        headers: { Authorization: `Bearer ${token}` },
    });
    assertDriveOk(res, "無法取得 Google 使用者資訊");
    const data = await res.json() as { email?: string; name?: string; picture?: string; };
    if (!data.email) {
        throw new Error("取得 Google 帳號失敗：未包含 Email 資訊");
    }
    return {
        email: data.email,
        name: data.name || data.email.split("@")[0] || data.email,
        picture: data.picture,
    };
}

/** Find or create the dedicated ShowMeWay folder in Google Drive */
export async function findOrCreateAppFolder(token: string): Promise<string> {
    const cachedFolderId = loadGdriveFolderId();
    if (cachedFolderId) {
        // Verify it exists
        try {
            const checkRes = await fetch(`https://www.googleapis.com/drive/v3/files/${cachedFolderId}?fields=id,trashed`, {
                headers: { Authorization: `Bearer ${token}` },
            });
            if (checkRes.ok) {
                const folderData = await checkRes.json() as { id?: string; trashed?: boolean; };
                if (folderData.id && !folderData.trashed) {
                    return folderData.id;
                }
            }
        } catch {
            // Re-search below
        }
    }

    // Query folder
    const query = `name = '${GDRIVE_FOLDER_NAME}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
    const searchRes = await fetch(
        `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=files(id,name)&spaces=drive`,
        { headers: { Authorization: `Bearer ${token}` } },
    );

    // A failed search must not fall through to the create below: a transient 5xx or
    // rateLimitExceeded would mint a second ShowMeWay folder and cache its id, leaving
    // every existing cloud trip in a folder the app no longer looks at.
    assertDriveOk(searchRes, "無法搜尋 Google Drive 資料夾");

    const searchData = await searchRes.json() as { files?: { id: string; }[]; };
    const found = Array.isArray(searchData.files) ? searchData.files[0] : undefined;
    if (found) {
        saveGdriveFolderId(found.id);
        return found.id;
    }

    // Create folder
    const createRes = await fetch("https://www.googleapis.com/drive/v3/files", {
        method: "POST",
        headers: {
            "Authorization": `Bearer ${token}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            name: GDRIVE_FOLDER_NAME,
            mimeType: "application/vnd.google-apps.folder",
        }),
    });

    assertDriveOk(createRes, `無法在 Google Drive 建立 ${GDRIVE_FOLDER_NAME} 資料夾`);

    const created = await createRes.json() as { id: string; };
    saveGdriveFolderId(created.id);
    return created.id;
}

interface RawDriveFile {
    id?: string;
    name?: string;
    modifiedTime?: string;
    size?: string;
    md5Checksum?: string;
    trashed?: boolean;
    appProperties?: { showmewayTripId?: string; startDate?: string; contentHash?: string; };
}

/** Fetch metadata of a single Google Drive file */
export async function fetchCloudTripMeta(token: string, fileId: string): Promise<CloudTripFile | null> {
    const url = `https://www.googleapis.com/drive/v3/files/${fileId}?fields=id,name,modifiedTime,size,md5Checksum,trashed,appProperties`;
    const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
    });
    // 404 is the "remote copy is gone" signal smartSyncTrip re-creates from.
    if (res.status === 404) return null;
    assertDriveOk(res, "無法讀取雲端檔案資訊");
    const f = await res.json() as RawDriveFile;
    if (!f.id || !f.name) return null;
    // A binned file still answers files.get with 200, but listCloudTrips filters it out
    // and Drive accepts writes to it — so reporting it as live would keep syncing a trip
    // into the user's trash, invisibly.
    if (f.trashed) return null;
    return {
        id: f.id,
        name: f.name.replace(/\.ya?ml$/i, ""),
        modifiedTime: f.modifiedTime || new Date().toISOString(),
        size: f.size ? parseInt(f.size, 10) : undefined,
        tripId: f.appProperties?.showmewayTripId,
        startDate: f.appProperties?.startDate,
        md5Checksum: f.md5Checksum,
        contentHash: f.appProperties?.contentHash,
    };
}

/** List all trip files stored in the ShowMeWay Google Drive folder */
export async function listCloudTrips(token: string, folderId?: string): Promise<CloudTripFile[]> {
    const parentFolderId = folderId || await findOrCreateAppFolder(token);
    const query = `'${parentFolderId}' in parents and trashed = false and mimeType != 'application/vnd.google-apps.folder'`;
    const url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=files(id,name,modifiedTime,size,md5Checksum,appProperties)&orderBy=modifiedTime+desc`;

    const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
    });

    assertDriveOk(res, "無法讀取 Google Drive 行程列表");

    const data = await res.json() as { files?: RawDriveFile[]; };
    if (!Array.isArray(data.files)) return [];

    return data.files
        .filter((f): f is RawDriveFile & { id: string; name: string; modifiedTime: string; } => typeof f.id === "string" && typeof f.name === "string" && typeof f.modifiedTime === "string")
        .map(f => ({
            id: f.id,
            name: f.name.replace(/\.ya?ml$/i, ""),
            modifiedTime: f.modifiedTime,
            size: f.size ? parseInt(f.size, 10) : undefined,
            tripId: f.appProperties?.showmewayTripId,
            startDate: f.appProperties?.startDate,
            md5Checksum: f.md5Checksum,
            contentHash: f.appProperties?.contentHash,
        }));
}

function buildMultipartBody(boundary: string, metadata: Record<string, unknown>, content: string): string {
    return [
        `--${boundary}`,
        "Content-Type: application/json; charset=UTF-8",
        "",
        JSON.stringify(metadata),
        `--${boundary}`,
        "Content-Type: text/yaml; charset=UTF-8",
        "",
        content,
        `--${boundary}--`,
    ].join("\r\n");
}

/**
 * Upload a new trip or update an existing one in Google Drive.
 *
 * Pure API client: it writes no local sync state. The caller owns the file-map binding
 * and the md5 merge base, because only the caller knows whether the copy it just sent
 * is the one the user is looking at.
 */
export async function uploadOrUpdateCloudTrip(
    token: string,
    tripName: string,
    yamlContent: string,
    options: { fileId?: string; tripId?: string; folderId?: string; } = {},
): Promise<CloudTripFile> {
    const boundary = `-------ShowMeWayBoundary${Date.now()}`;
    const fileName = `${tripName.trim() || "未命名行程"}.yaml`;
    const startDate = tripStartDateFromYaml(yamlContent);

    const contentHash = yamlFingerprint(yamlContent);
    const appProperties: Record<string, string> = {
        updatedAt: new Date().toISOString(),
        // Rides in the same multipart request as the bytes it describes, so this app can
        // never publish a hash that disagrees with the content it just wrote. Anything
        // that writes the file without going through here leaves it stale on purpose —
        // that mismatch against Drive's md5 is what tells decideSyncAction not to trust it.
        contentHash,
    };
    if (options.tripId) {
        appProperties.showmewayTripId = options.tripId;
    }
    if (startDate) {
        appProperties.startDate = startDate;
    }

    let method: string;
    let url: string;
    let metadata: Record<string, unknown>;
    let errorMessage: string;

    if (options.fileId) {
        method = "PATCH";
        url = `https://www.googleapis.com/upload/drive/v3/files/${options.fileId}?uploadType=multipart&fields=id,name,modifiedTime,size,md5Checksum,appProperties`;
        metadata = { name: fileName, appProperties };
        errorMessage = "無法更新 Google Drive 行程檔案";
    } else {
        const parentFolderId = options.folderId || await findOrCreateAppFolder(token);
        method = "POST";
        url = "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,modifiedTime,size,md5Checksum,appProperties";
        metadata = { name: fileName, parents: [parentFolderId], mimeType: "text/yaml", appProperties };
        errorMessage = "無法上傳行程至 Google Drive";
    }

    const body = buildMultipartBody(boundary, metadata, yamlContent);
    const res = await fetch(url, {
        method,
        headers: {
            "Authorization": `Bearer ${token}`,
            "Content-Type": `multipart/related; boundary=${boundary}`,
        },
        body,
    });

    assertDriveOk(res, errorMessage);

    const data = await res.json() as RawDriveFile;
    return {
        id: data.id!,
        name: (data.name || fileName).replace(/\.ya?ml$/i, ""),
        modifiedTime: data.modifiedTime || new Date().toISOString(),
        tripId: options.tripId,
        startDate: startDate ?? undefined,
        md5Checksum: data.md5Checksum,
        contentHash,
    };
}

/** Download YAML content from a Google Drive file */
export async function downloadCloudTripYaml(token: string, fileId: string): Promise<string> {
    const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
        headers: { Authorization: `Bearer ${token}` },
    });

    assertDriveOk(res, "無法下載 Google Drive 檔案");

    return await res.text();
}

/** Delete a file in Google Drive */
export async function deleteCloudTrip(token: string, fileId: string): Promise<void> {
    const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
    });

    // 404 means someone already removed it, which is the outcome the caller wanted.
    if (res.status !== 404) assertDriveOk(res, "無法刪除 Google Drive 檔案");
}
