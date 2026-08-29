// The sync executor: `decideSyncAction` decides, this layer carries the decision out
// against Drive and the record store. `gdrive.test.ts` covers the decision truth table;
// what is only reachable here is whether the right request goes out, whether the record
// advances at the right moment, and — the property the whole design rests on — that a
// conflict changes nothing on either side.
//
// `gdriveSync` is a module-level singleton whose state no export resets, so every test
// re-imports it through `vi.resetModules()`. A pre-seeded token cache keeps
// `getValidToken` from ever reaching Google Identity Services.

import {
    ensureActiveProfileId,
    getActiveProfileId,
    listProfiles,
} from "$lib/infra/storage/profiles";
import { USER_YAML_KEY } from "$lib/infra/storage/yaml-storage";
import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from "vitest";

type GdriveModule = typeof import("$lib/infra/http/gdrive");
type SyncModule = typeof import("./gdrive.svelte");

let gdrive: GdriveModule;
let sync: SyncModule["gdriveSync"];

const TRIP = "p-tokyo";
const YAML_A = "trip:\n  name: 東京\ndays:\n  - date: '2026-10-01'\n";
const YAML_B = "trip:\n  name: 東京改\ndays:\n  - date: '2026-10-01'\n";

function createLocalStorageStub() {
    const store = new Map<string, string>();
    return {
        get length() {
            return store.size;
        },
        key: (i: number) => [...store.keys()][i] ?? null,
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => void store.set(key, value),
        removeItem: (key: string) => void store.delete(key),
        clear: () => store.clear(),
    };
}

/** A fetch stub that answers by URL+method, so tests assert on shape not call order. */
function createDriveStub(routes: {
    meta?: { status?: number; body?: unknown; };
    download?: string;
    upload?: { id: string; name: string; md5Checksum?: string; };
    list?: unknown[];
}) {
    const calls: { url: string; method: string; body?: string; }[] = [];
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
        const method = init?.method ?? "GET";
        calls.push({ url, method, body: typeof init?.body === "string" ? init.body : undefined });

        if (url.includes("/upload/drive/v3/files")) {
            return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(routes.upload ?? { id: "file-new", name: "東京.yaml" }) });
        }
        if (url.includes("alt=media")) {
            return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(routes.download ?? "") });
        }
        if (url.includes("drive/v3/files?q=")) {
            return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ files: routes.list ?? [] }) });
        }
        // The app folder: a create with no id in the path, reached when the folder search
        // above came back empty.
        if (url.endsWith("/drive/v3/files") && method === "POST") {
            return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ id: "folder-1" }) });
        }
        // Single-file metadata.
        const status = routes.meta?.status ?? 200;
        return Promise.resolve({
            ok: status >= 200 && status < 300,
            status,
            json: () => Promise.resolve(routes.meta?.body ?? {}),
        });
    });
    vi.stubGlobal("fetch", fetchMock);
    return calls;
}

/**
 * `gdriveSync` reads the record map once, when the module is constructed, so anything a
 * test seeds has to be in storage before this runs.
 */
async function loadSync() {
    sync = (await import("./gdrive.svelte")).gdriveSync;
}

beforeEach(async () => {
    vi.resetModules();
    vi.stubGlobal("localStorage", createLocalStorageStub());
    // Silences the toast service without pulling its timers into these tests.
    vi.doMock("./toast.svelte", () => ({ showToast: vi.fn() }));

    gdrive = await import("$lib/infra/http/gdrive");
    // Signed in, with a token that has not expired, so no GIS popup is ever attempted.
    gdrive.saveGdriveUser({ email: "a@example.com", name: "A" });
    gdrive.setCachedAccessToken("token-1", 3600);
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.doUnmock("./toast.svelte");
    vi.restoreAllMocks();
});

describe("sync: pushing", () => {
    it("creates a Drive file for a trip with no record, then remembers both sides", async () => {
        await loadSync();
        const calls = createDriveStub({ upload: { id: "file-1", name: "東京.yaml", md5Checksum: "md5-1" } });

        const res = await sync.sync(YAML_A, TRIP);

        expect(res?.action).toBe("pushed");
        const upload = calls.find(c => c.url.includes("/upload/"));
        expect(upload?.method).toBe("POST");
        expect(upload?.url).toContain("uploadType=multipart");
        // The metadata part has to name a parent, or Drive drops the file in the root.
        expect(upload?.body).toContain('"parents"');
        expect(upload?.body).toContain("name: 東京");
        expect(gdrive.loadTripSyncMap()[TRIP]).toEqual({
            fileId: "file-1",
            remoteMd5: "md5-1",
            localHash: gdrive.yamlFingerprint(YAML_A),
            remoteHash: gdrive.yamlFingerprint(YAML_A),
        });
    });

    it("publishes the trip's own id, not the local profile slot's", async () => {
        // The profile id means nothing on another device, which is what made this
        // appProperty useless for recognising a trip after the local state was lost.
        await loadSync();
        const calls = createDriveStub({ upload: { id: "file-1", name: "東京.yaml" } });

        await sync.sync("trip:\n  name: 東京\n  id: t-tokyo\ndays:\n  - date: '2026-10-01'\n", TRIP);

        const upload = calls.find(c => c.url.includes("/upload/"));
        expect(upload?.body).toContain('"showmewayTripId":"t-tokyo"');
        expect(upload?.body).not.toContain(TRIP);
    });

    it("updates the bound file when only the local copy moved", async () => {
        gdrive.saveTripSyncMap({ [TRIP]: { fileId: "file-1", remoteMd5: "md5-1", localHash: gdrive.yamlFingerprint(YAML_A) } });
        await loadSync();
        const calls = createDriveStub({
            meta: { body: { id: "file-1", name: "東京.yaml", md5Checksum: "md5-1" } },
            upload: { id: "file-1", name: "東京.yaml", md5Checksum: "md5-2" },
        });

        const res = await sync.sync(YAML_B, TRIP);

        expect(res?.action).toBe("pushed");
        const upload = calls.find(c => c.url.includes("/upload/"));
        expect(upload?.method).toBe("PATCH");
        expect(upload?.url).toContain("/files/file-1");
        expect(upload?.body).not.toContain('"parents"');
        expect(gdrive.loadTripSyncMap()[TRIP].localHash).toBe(gdrive.yamlFingerprint(YAML_B));
    });

    it("fingerprints the bytes it sent, not a later edit, so a mid-upload save still syncs", async () => {
        await loadSync();
        createDriveStub({ upload: { id: "file-1", name: "東京.yaml", md5Checksum: "md5-1" } });

        await sync.sync(YAML_A, TRIP);

        // The user edited while that upload was in flight: the record must still describe
        // YAML_A, or the next sync would call the newer content already sent.
        expect(gdrive.loadTripSyncMap()[TRIP].localHash).not.toBe(gdrive.yamlFingerprint(YAML_B));
        expect(gdrive.decideSyncAction({
            record: gdrive.loadTripSyncMap()[TRIP],
            remoteExists: true,
            remoteMd5: "md5-1",
            // What that upload published, so the remote still describes YAML_A.
            remoteHash: gdrive.yamlFingerprint(YAML_A),
            localHash: gdrive.yamlFingerprint(YAML_B),
        })).toBe("push");
    });

    it("creates a new file instead of patching one Drive no longer has", async () => {
        gdrive.saveTripSyncMap({ [TRIP]: { fileId: "gone", remoteMd5: "md5-1", localHash: "h" } });
        await loadSync();
        const calls = createDriveStub({ meta: { status: 404 }, upload: { id: "file-2", name: "東京.yaml", md5Checksum: "md5-2" } });

        const res = await sync.sync(YAML_A, TRIP);

        expect(res?.action).toBe("pushed");
        expect(calls.find(c => c.url.includes("/upload/"))?.method).toBe("POST");
        expect(gdrive.loadTripSyncMap()[TRIP].fileId).toBe("file-2");
    });

    it("treats a file in Drive's trash as gone rather than syncing into the bin", async () => {
        gdrive.saveTripSyncMap({ [TRIP]: { fileId: "binned", remoteMd5: "md5-1", localHash: "h" } });
        await loadSync();
        const calls = createDriveStub({
            meta: { body: { id: "binned", name: "東京.yaml", md5Checksum: "md5-1", trashed: true } },
            upload: { id: "file-3", name: "東京.yaml", md5Checksum: "md5-3" },
        });

        await sync.sync(YAML_A, TRIP);

        expect(calls.find(c => c.url.includes("/upload/"))?.method).toBe("POST");
        expect(gdrive.loadTripSyncMap()[TRIP].fileId).toBe("file-3");
    });
});

describe("sync: pulling", () => {
    // A function, not a const: `gdrive` is re-imported per test, so a describe-scope value
    // would be built at collection time against a module that does not exist yet.
    const behindRemote = () => ({ fileId: "file-1", remoteMd5: "md5-1", localHash: gdrive.yamlFingerprint(YAML_A) });

    it("hands the remote YAML back and records it once the caller commits", async () => {
        gdrive.saveTripSyncMap({ [TRIP]: behindRemote() });
        await loadSync();
        createDriveStub({
            meta: { body: { id: "file-1", name: "東京.yaml", md5Checksum: "md5-2" } },
            download: YAML_B,
        });

        const res = await sync.sync(YAML_A, TRIP);

        expect(res?.action).toBe("pulled");
        expect(res?.yaml).toBe(YAML_B);
        res?.commit?.();
        expect(gdrive.loadTripSyncMap()[TRIP]).toEqual({
            fileId: "file-1",
            remoteMd5: "md5-2",
            localHash: gdrive.yamlFingerprint(YAML_B),
            remoteHash: gdrive.yamlFingerprint(YAML_B),
        });
    });

    it("leaves the record alone when the caller never lands the download", async () => {
        // The caller's persist can fail (quota, a trip switched out from under the round
        // trip). A record that advanced anyway claims this device holds YAML_B, and the
        // next sync pushes the older YAML_A over the newer cloud copy.
        gdrive.saveTripSyncMap({ [TRIP]: behindRemote() });
        await loadSync();
        createDriveStub({
            meta: { body: { id: "file-1", name: "東京.yaml", md5Checksum: "md5-2" } },
            download: YAML_B,
        });

        const res = await sync.sync(YAML_A, TRIP);

        expect(res?.action).toBe("pulled");
        expect(gdrive.loadTripSyncMap()[TRIP]).toEqual(behindRemote());
        expect(gdrive.decideSyncAction({
            record: gdrive.loadTripSyncMap()[TRIP],
            remoteExists: true,
            remoteMd5: "md5-2",
            remoteHash: gdrive.yamlFingerprint(YAML_B),
            localHash: gdrive.yamlFingerprint(YAML_A),
        })).toBe("pull");
    });

    it("asks instead of downloading on the background path", async () => {
        gdrive.saveTripSyncMap({ [TRIP]: { fileId: "file-1", remoteMd5: "md5-1", localHash: gdrive.yamlFingerprint(YAML_A) } });
        await loadSync();
        const calls = createDriveStub({
            meta: { body: { id: "file-1", name: "東京.yaml", md5Checksum: "md5-2" } },
            download: YAML_B,
        });

        const res = await sync.sync(YAML_A, TRIP, { interactive: false });

        // A debounced timer has nowhere to put the YAML and must not swap the trip.
        expect(res?.action).toBe("conflict");
        expect(sync.conflictFor(TRIP)).toEqual({ tripId: TRIP, fileName: "東京", kind: "remote-newer" });
        expect(calls.some(c => c.url.includes("alt=media"))).toBe(false);
        expect(gdrive.loadTripSyncMap()[TRIP].remoteMd5).toBe("md5-1");
    });

    it("pulls an edit made outside this app, whose published hash is stale", async () => {
        // Someone edited the YAML in Drive itself: the bytes moved, but contentHash still
        // names the copy this app last wrote — which is exactly what is on this device.
        // Trusting the hash here would report 已是最新 and overwrite them on the next push.
        const agreedHash = gdrive.yamlFingerprint(YAML_A);
        gdrive.saveTripSyncMap({ [TRIP]: { fileId: "file-1", remoteMd5: "md5-1", localHash: agreedHash, remoteHash: agreedHash } });
        await loadSync();
        createDriveStub({
            meta: { body: { id: "file-1", name: "東京.yaml", md5Checksum: "md5-2", appProperties: { contentHash: agreedHash } } },
            download: YAML_B,
        });

        const res = await sync.sync(YAML_A, TRIP);

        expect(res?.action).toBe("pulled");
        expect(res?.yaml).toBe(YAML_B);
    });
});

describe("sync: content equality", () => {
    it("settles a divergence where both sides were edited into the same content", async () => {
        // Would be a conflict on checksums alone, and there is nothing for the user to
        // decide: the two copies are byte-identical.
        gdrive.saveTripSyncMap({
            [TRIP]: { fileId: "file-1", remoteMd5: "md5-1", localHash: gdrive.yamlFingerprint(YAML_A), remoteHash: gdrive.yamlFingerprint(YAML_A) },
        });
        await loadSync();
        const calls = createDriveStub({
            meta: {
                body: { id: "file-1", name: "東京.yaml", md5Checksum: "md5-2", appProperties: { contentHash: gdrive.yamlFingerprint(YAML_B) } },
            },
        });

        const res = await sync.sync(YAML_B, TRIP);

        expect(res?.action).toBe("up_to_date");
        expect(sync.conflictFor(TRIP)).toBeNull();
        // Neither side moves, and no bytes travel in either direction.
        expect(calls.some(c => c.url.includes("alt=media") || c.url.includes("/upload/"))).toBe(false);
        // The base has to advance too, or the next real edit reads as "both changed".
        expect(gdrive.loadTripSyncMap()[TRIP]).toEqual({
            fileId: "file-1",
            remoteMd5: "md5-2",
            localHash: gdrive.yamlFingerprint(YAML_B),
            remoteHash: gdrive.yamlFingerprint(YAML_B),
        });
    });

    it("leaves the base alone when up_to_date rests on no evidence at all", async () => {
        // Drive reported no checksum and the file carries no contentHash: nothing moved as
        // far as we can tell, which is not the same as having verified the two copies.
        const record = { fileId: "file-1", remoteMd5: "md5-1", localHash: gdrive.yamlFingerprint(YAML_A), remoteHash: gdrive.yamlFingerprint(YAML_A) };
        gdrive.saveTripSyncMap({ [TRIP]: record });
        await loadSync();
        createDriveStub({ meta: { body: { id: "file-1", name: "東京.yaml" } } });

        expect((await sync.sync(YAML_A, TRIP))?.action).toBe("up_to_date");
        expect(gdrive.loadTripSyncMap()[TRIP]).toEqual(record);
    });
});

describe("sync: checkOnly", () => {
    it("offers the download as its own tap instead of downloading, and never PATCHes or GETs the bytes", async () => {
        gdrive.saveTripSyncMap({ [TRIP]: { fileId: "file-1", remoteMd5: "md5-1", localHash: gdrive.yamlFingerprint(YAML_A) } });
        await loadSync();
        const calls = createDriveStub({
            meta: { body: { id: "file-1", name: "東京.yaml", md5Checksum: "md5-2" } },
            download: YAML_B,
        });

        const res = await sync.sync(YAML_A, TRIP, { checkOnly: true });

        expect(res?.action).toBe("pull_ready");
        expect(sync.cloudActionFor(TRIP, YAML_A)).toEqual({ kind: "download" });
        expect(sync.conflictFor(TRIP)).toBeNull();
        expect(calls.some(c => c.url.includes("alt=media"))).toBe(false);
        expect(gdrive.loadTripSyncMap()[TRIP].remoteMd5).toBe("md5-1");
    });

    it("a real sync afterwards re-decides from scratch instead of trusting the armed flag", async () => {
        gdrive.saveTripSyncMap({ [TRIP]: { fileId: "file-1", remoteMd5: "md5-1", localHash: gdrive.yamlFingerprint(YAML_A) } });
        await loadSync();
        createDriveStub({
            meta: { body: { id: "file-1", name: "東京.yaml", md5Checksum: "md5-2" } },
            download: YAML_B,
        });
        await sync.sync(YAML_A, TRIP, { checkOnly: true });
        expect(sync.cloudActionFor(TRIP, YAML_A)).toEqual({ kind: "download" });

        // The user typed an edit before tapping 下載: local is now dirty too, so the
        // follow-up call must land on "conflict", not blindly overwrite it.
        const res = await sync.sync(YAML_B, TRIP);

        expect(res?.action).toBe("conflict");
        expect(sync.cloudActionFor(TRIP, YAML_A)).toEqual({ kind: "conflict" });
    });

    it("offers the upload as its own tap when the bound file has gone, without re-creating it", async () => {
        // A clean trip decides `push` exactly when its Drive copy vanished — the user
        // tidied their Drive, or another device deleted it. A button that only promised
        // to compare must not resurrect a file someone deliberately removed.
        gdrive.saveTripSyncMap({ [TRIP]: { fileId: "file-1", remoteMd5: "md5-1", localHash: gdrive.yamlFingerprint(YAML_A) } });
        await loadSync();
        const calls = createDriveStub({ meta: { status: 404 } });

        const res = await sync.sync(YAML_A, TRIP, { checkOnly: true });

        expect(res?.action).toBe("push_ready");
        expect(calls.some(c => c.url.includes("/upload/"))).toBe(false);
        expect(sync.cloudActionFor(TRIP, YAML_A)).toEqual({ kind: "upload", overwrite: false });
    });

    it("uploads on the follow-up tap that is no longer checkOnly", async () => {
        gdrive.saveTripSyncMap({ [TRIP]: { fileId: "file-1", remoteMd5: "md5-1", localHash: gdrive.yamlFingerprint(YAML_A) } });
        await loadSync();
        const calls = createDriveStub({ meta: { status: 404 }, upload: { id: "file-2", name: "東京.yaml", md5Checksum: "md5-2" } });
        await sync.sync(YAML_A, TRIP, { checkOnly: true });

        const res = await sync.sync(YAML_A, TRIP);

        expect(res?.action).toBe("pushed");
        // A new file, not a PATCH of the id that just answered 404.
        expect(calls.find(c => c.url.includes("/upload/"))?.method).toBe("POST");
    });

    it("still up to date: toasts and keeps the button on check", async () => {
        gdrive.saveTripSyncMap({ [TRIP]: { fileId: "file-1", remoteMd5: "md5-1", localHash: gdrive.yamlFingerprint(YAML_A) } });
        await loadSync();
        createDriveStub({ meta: { body: { id: "file-1", name: "東京.yaml", md5Checksum: "md5-1" } } });

        const res = await sync.sync(YAML_A, TRIP, { checkOnly: true });

        expect(res?.action).toBe("up_to_date");
        expect(sync.cloudActionFor(TRIP, YAML_A)).toEqual({ kind: "check" });
    });
});

describe("cloudActionFor", () => {
    it("offers upload for an unbound or dirty trip, check when clean", async () => {
        gdrive.saveTripSyncMap({ [TRIP]: { fileId: "file-1", remoteMd5: "md5-1", localHash: gdrive.yamlFingerprint(YAML_A) } });
        await loadSync();

        expect(sync.cloudActionFor("p-unbound", YAML_A)).toEqual({ kind: "upload", overwrite: false });
        expect(sync.cloudActionFor(TRIP, YAML_A)).toEqual({ kind: "check" });
        expect(sync.cloudActionFor(TRIP, YAML_B)).toEqual({ kind: "upload", overwrite: false });

        // Only once the bound file is live in the cloud list does the upload overwrite it.
        sync.cloudFiles = [{ id: "file-1", name: "東京.yaml", modifiedTime: "2026-06-11T00:00:00Z" }];
        expect(sync.cloudActionFor(TRIP, YAML_B)).toEqual({ kind: "upload", overwrite: true });
    });

    it("asks for login when signed out, whatever the trip's state", async () => {
        gdrive.clearGdriveUser();
        await loadSync();

        expect(sync.cloudActionFor(TRIP, YAML_A)).toEqual({ kind: "login" });
    });
});

describe("sync: conflict", () => {
    // A stale fingerprint: any value that is not YAML_A's makes the local side "changed",
    // which is all decideSyncAction compares.
    const diverged = { fileId: "file-1", remoteMd5: "md5-1", localHash: "stale-hash" };

    it("changes nothing on either side when both moved", async () => {
        gdrive.saveTripSyncMap({ [TRIP]: diverged });
        await loadSync();
        const calls = createDriveStub({
            meta: { body: { id: "file-1", name: "東京.yaml", md5Checksum: "md5-2" } },
            download: YAML_B,
        });

        const res = await sync.sync(YAML_A, TRIP);

        expect(res?.action).toBe("conflict");
        expect(sync.conflictFor(TRIP)?.kind).toBe("both-changed");
        // No upload, no download, and the record untouched — this is the property the
        // "never destructive on its own" contract rests on.
        expect(calls.some(c => c.url.includes("/upload/"))).toBe(false);
        expect(calls.some(c => c.url.includes("alt=media"))).toBe(false);
        expect(gdrive.loadTripSyncMap()[TRIP]).toEqual(diverged);
    });

    it("force local overwrites the remote and clears the conflict", async () => {
        gdrive.saveTripSyncMap({ [TRIP]: diverged });
        await loadSync();
        const calls = createDriveStub({
            meta: { body: { id: "file-1", name: "東京.yaml", md5Checksum: "md5-2" } },
            upload: { id: "file-1", name: "東京.yaml", md5Checksum: "md5-3" },
        });
        await sync.sync(YAML_A, TRIP);
        expect(sync.conflictFor(TRIP)).not.toBeNull();

        const res = await sync.sync(YAML_A, TRIP, { force: "local" });

        expect(res?.action).toBe("pushed");
        expect(sync.conflictFor(TRIP)).toBeNull();
        expect(calls.filter(c => c.url.includes("/upload/")).length).toBe(1);
        expect(gdrive.loadTripSyncMap()[TRIP].remoteMd5).toBe("md5-3");
    });

    it("force remote returns the cloud copy and clears the conflict", async () => {
        gdrive.saveTripSyncMap({ [TRIP]: diverged });
        await loadSync();
        createDriveStub({
            meta: { body: { id: "file-1", name: "東京.yaml", md5Checksum: "md5-2" } },
            download: YAML_B,
        });
        await sync.sync(YAML_A, TRIP);

        const res = await sync.sync(YAML_A, TRIP, { force: "remote" });

        expect(res?.action).toBe("pulled");
        expect(res?.yaml).toBe(YAML_B);
        // The conflict outlives the download and is cleared by the commit, so a pull the
        // caller could not land leaves the decision strip up rather than looking settled.
        expect(sync.conflictFor(TRIP)).not.toBeNull();
        res?.commit?.();
        expect(sync.conflictFor(TRIP)).toBeNull();
    });

    it("pauses the debounced path for a trip whose conflict is unresolved", async () => {
        gdrive.saveTripSyncMap({ [TRIP]: diverged });
        await loadSync();
        createDriveStub({ meta: { body: { id: "file-1", name: "東京.yaml", md5Checksum: "md5-2" } } });
        sync.setAutoSync(true);
        await sync.sync(YAML_A, TRIP);
        expect(sync.conflictFor(TRIP)).not.toBeNull();

        vi.useFakeTimers();
        try {
            sync.scheduleSync(YAML_B, TRIP);
            await vi.runAllTimersAsync();
        } finally {
            vi.useRealTimers();
        }

        // Still diverged: asking Drive again cannot answer what the user has not decided.
        expect(gdrive.loadTripSyncMap()[TRIP]).toEqual(diverged);
    });
});

describe("sync: guards", () => {
    it("does nothing when not signed in", async () => {
        gdrive.clearGdriveUser();
        await loadSync();
        createDriveStub({});

        expect(await sync.sync(YAML_A, TRIP)).toBeNull();
    });

    it("reports up to date without writing when neither side moved", async () => {
        const record = { fileId: "file-1", remoteMd5: "md5-1", localHash: gdrive.yamlFingerprint(YAML_A) };
        gdrive.saveTripSyncMap({ [TRIP]: record });
        await loadSync();
        const calls = createDriveStub({ meta: { body: { id: "file-1", name: "東京.yaml", md5Checksum: "md5-1" } } });

        const res = await sync.sync(YAML_A, TRIP);

        expect(res?.action).toBe("up_to_date");
        expect(calls.some(c => c.url.includes("/upload/"))).toBe(false);
        expect(gdrive.loadTripSyncMap()[TRIP]).toEqual(record);
    });

    it("drops the cached token on a 401 so the next attempt re-authenticates", async () => {
        gdrive.saveTripSyncMap({ [TRIP]: { fileId: "file-1", remoteMd5: "md5-1", localHash: "h" } });
        await loadSync();
        createDriveStub({ meta: { status: 401 } });

        expect(await sync.sync(YAML_A, TRIP)).toBeNull();
        expect(gdrive.getCachedAccessToken()).toBeNull();
    });

    it("keeps the cached token on a 403, which is usually a rate limit", async () => {
        gdrive.saveTripSyncMap({ [TRIP]: { fileId: "file-1", remoteMd5: "md5-1", localHash: "h" } });
        await loadSync();
        createDriveStub({ meta: { status: 403 } });

        expect(await sync.sync(YAML_A, TRIP)).toBeNull();
        expect(gdrive.getCachedAccessToken()).toBe("token-1");
    });
});

describe("rebinding after the local state is lost", () => {
    const YAML_ID = "trip:\n  name: 東京\n  id: t-tokyo\ndays:\n  - date: '2026-10-01'\n";
    const YAML_ID_EDITED = "trip:\n  name: 東京改\n  id: t-tokyo\ndays:\n  - date: '2026-10-01'\n";

    /** The state a sign-out and back in leaves: the trip is still here, the binding is not. */
    function seedUnboundTrip(yaml: string = YAML_ID) {
        localStorage.setItem(USER_YAML_KEY, yaml);
        ensureActiveProfileId();
    }

    /** One listing answer carrying the appProperties Drive would return. */
    function stubList(files: { id: string; name: string; tripId?: string; contentHash?: string; md5Checksum?: string; }[]) {
        return createDriveStub({
            list: files.map(f => ({
                id: f.id,
                name: f.name,
                modifiedTime: "2026-08-24T00:00:00Z",
                md5Checksum: f.md5Checksum ?? "md5-1",
                appProperties: { showmewayTripId: f.tripId, contentHash: f.contentHash },
            })),
        });
    }

    it("re-binds silently when the cloud copy is the same content", async () => {
        seedUnboundTrip();
        await loadSync();
        stubList([{ id: "file-1", name: "東京.yaml", tripId: "t-tokyo", contentHash: gdrive.yamlFingerprint(YAML_ID) }]);

        await sync.refreshFiles({ force: true });

        const profileId = getActiveProfileId()!;
        // A complete merge base, recovered from the listing alone — nothing was downloaded.
        expect(gdrive.loadTripSyncMap()[profileId]).toEqual({
            fileId: "file-1",
            remoteMd5: "md5-1",
            remoteHash: gdrive.yamlFingerprint(YAML_ID),
            localHash: gdrive.yamlFingerprint(YAML_ID),
        });
        expect(sync.conflictFor(profileId)).toBeNull();
    });

    it("binds but asks when the two copies have drifted apart", async () => {
        seedUnboundTrip(YAML_ID_EDITED);
        await loadSync();
        stubList([{ id: "file-1", name: "東京", tripId: "t-tokyo", contentHash: gdrive.yamlFingerprint(YAML_ID) }]);

        await sync.refreshFiles({ force: true });

        const profileId = getActiveProfileId()!;
        // Bound, so nothing creates a second file — but with no local agreement recorded.
        expect(sync.cloudFileId(profileId)).toBe("file-1");
        expect(gdrive.loadTripSyncMap()[profileId].localHash).toBeUndefined();
        expect(sync.conflictFor(profileId)).toEqual({ tripId: profileId, fileName: "東京", kind: "both-changed" });
    });

    it("holds the drifted trip on that conflict, since the record alone would push", async () => {
        seedUnboundTrip(YAML_ID_EDITED);
        await loadSync();
        const calls = stubList([{ id: "file-1", name: "東京", tripId: "t-tokyo", contentHash: gdrive.yamlFingerprint(YAML_ID) }]);
        await sync.refreshFiles({ force: true });
        const profileId = getActiveProfileId()!;
        sync.setAutoSync(true);

        vi.useFakeTimers();
        try {
            sync.scheduleSync(YAML_ID_EDITED, profileId);
            await vi.runAllTimersAsync();
        } finally {
            vi.useRealTimers();
        }

        expect(calls.some(c => c.url.includes("/upload/"))).toBe(false);
    });

    it("keeps holding the drifted trip after a reload drops the in-memory conflict", async () => {
        // The failure this guards: the record is persisted, the conflict used not to be.
        // A restart left a binding with no base — which decides `push` on its own — and
        // the next checklist tap overwrote the cloud copy nobody had looked at yet.
        seedUnboundTrip(YAML_ID_EDITED);
        await loadSync();
        stubList([{ id: "file-1", name: "東京", tripId: "t-tokyo", contentHash: gdrive.yamlFingerprint(YAML_ID) }]);
        await sync.refreshFiles({ force: true });
        const profileId = getActiveProfileId()!;

        vi.resetModules();
        await loadSync();
        const calls = createDriveStub({ meta: { body: { id: "file-1", name: "東京", md5Checksum: "md5-1" } } });

        expect(sync.conflictFor(profileId)?.kind).toBe("both-changed");
        expect(await sync.sync(YAML_ID_EDITED, profileId)).toMatchObject({ action: "conflict" });
        expect(calls.some(c => c.url.includes("/upload/"))).toBe(false);
    });

    it("resolves the recorded divergence once the user picks a side", async () => {
        seedUnboundTrip(YAML_ID_EDITED);
        await loadSync();
        stubList([{ id: "file-1", name: "東京", tripId: "t-tokyo", contentHash: gdrive.yamlFingerprint(YAML_ID) }]);
        await sync.refreshFiles({ force: true });
        const profileId = getActiveProfileId()!;
        createDriveStub({
            meta: { body: { id: "file-1", name: "東京", md5Checksum: "md5-1" } },
            upload: { id: "file-1", name: "東京.yaml", md5Checksum: "md5-2" },
        });

        await sync.sync(YAML_ID_EDITED, profileId, { force: "local" });

        expect(gdrive.loadTripSyncMap()[profileId].diverged).toBeUndefined();
        expect(sync.conflictFor(profileId)).toBeNull();
    });

    it("leaves a trip that is already bound alone", async () => {
        seedUnboundTrip();
        localStorage.setItem(gdrive.GDRIVE_TRIPS_STORAGE, JSON.stringify({ [TRIP]: { fileId: "file-old", remoteMd5: "md5-old" } }));
        await loadSync();
        stubList([{ id: "file-1", name: "東京.yaml", tripId: "t-tokyo", contentHash: gdrive.yamlFingerprint(YAML_ID) }]);

        await sync.refreshFiles({ force: true });

        expect(gdrive.loadTripSyncMap()[TRIP].fileId).toBe("file-old");
    });

    it("ignores files no local trip claims, and trips no file claims", async () => {
        seedUnboundTrip();
        await loadSync();
        stubList([
            { id: "file-1", name: "首爾.yaml", tripId: "t-seoul", contentHash: "whatever" },
            { id: "file-2", name: "無標記.yaml" },
        ]);

        await sync.refreshFiles({ force: true });

        expect(gdrive.loadTripSyncMap()).toEqual({});
    });

    it("takes the newest of two files claiming one trip", async () => {
        // Exactly the duplicates the missing rebind used to produce; listCloudTrips orders
        // by modifiedTime, so the first match is the one to keep.
        seedUnboundTrip();
        await loadSync();
        stubList([
            { id: "file-new", name: "東京.yaml", tripId: "t-tokyo", contentHash: gdrive.yamlFingerprint(YAML_ID) },
            { id: "file-old", name: "東京.yaml", tripId: "t-tokyo", contentHash: gdrive.yamlFingerprint(YAML_ID) },
        ]);

        await sync.refreshFiles({ force: true });

        expect(sync.cloudFileId(getActiveProfileId()!)).toBe("file-new");
    });

    it("re-runs a rebind pass that a sync in flight made it skip", async () => {
        // Nothing else would retry it: the 60s listing TTL turns every later refresh into
        // a cache hit, and the trip left unbound creates a duplicate Drive file on its
        // next push — the very bug rebinding exists to prevent.
        const parkedYaml = "trip:\n  name: 京都\n  id: t-kyoto\ndays:\n  - date: '2026-11-01'\n";
        seedUnboundTrip();
        localStorage.setItem(
            "showmeway_profiles",
            JSON.stringify([{ id: "p-parked", yaml: parkedYaml, savedAt: "2026-08-01T00:00:00Z" }]),
        );
        gdrive.saveTripSyncMap({ [TRIP]: { fileId: "file-1", remoteMd5: "md5-1", localHash: gdrive.yamlFingerprint(YAML_A) } });
        await loadSync();

        let releaseMeta: (() => void) | null = null;
        const listBody = {
            files: [{
                id: "file-2",
                name: "京都.yaml",
                modifiedTime: "2026-08-24T00:00:00Z",
                md5Checksum: "md5-2",
                appProperties: { showmewayTripId: "t-kyoto", contentHash: gdrive.yamlFingerprint(parkedYaml) },
            }],
        };
        vi.stubGlobal(
            "fetch",
            vi.fn((url: string, init?: RequestInit) => {
                // The trip's own metadata is the one call the sync blocks on, so the
                // listing lands while it is still in flight.
                if (url.includes("/drive/v3/files/file-1")) {
                    return new Promise(resolve => {
                        releaseMeta = () => resolve({ ok: true, status: 200, json: () => Promise.resolve({ id: "file-1", name: "東京.yaml", md5Checksum: "md5-1" }) });
                    });
                }
                if (url.endsWith("/drive/v3/files") && (init?.method ?? "GET") === "POST") {
                    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ id: "folder-1" }) });
                }
                return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(listBody) });
            }),
        );

        const inFlight = sync.sync(YAML_A, TRIP);
        await sync.refreshFiles({ force: true });
        // Skipped, because the sync owns the record map for the moment.
        expect(sync.cloudFileId("p-parked")).toBeNull();

        releaseMeta!();
        await inFlight;
        // Drained by the retry the busy lock schedules on its way out.
        await vi.waitFor(() => expect(sync.cloudFileId("p-parked")).toBe("file-2"));
    });

    it("binds a parked profile too, not only the trip on screen", async () => {
        const parkedYaml = "trip:\n  name: 京都\n  id: t-kyoto\ndays:\n  - date: '2026-11-01'\n";
        seedUnboundTrip();
        localStorage.setItem(
            "showmeway_profiles",
            JSON.stringify([{ id: "p-parked", yaml: parkedYaml, savedAt: "2026-08-01T00:00:00Z" }]),
        );
        await loadSync();
        stubList([{ id: "file-2", name: "京都.yaml", tripId: "t-kyoto", contentHash: gdrive.yamlFingerprint(parkedYaml) }]);

        await sync.refreshFiles({ force: true });

        expect(sync.cloudFileId("p-parked")).toBe("file-2");
    });
});

describe("record bookkeeping", () => {
    it("adopts a downloaded cloud trip as the agreed copy", async () => {
        await loadSync();
        sync.adoptCloudTrip(TRIP, "file-9", YAML_A, "md5-9");

        expect(sync.cloudFileId(TRIP)).toBe("file-9");
        expect(gdrive.loadTripSyncMap()[TRIP]).toEqual({
            fileId: "file-9",
            remoteMd5: "md5-9",
            localHash: gdrive.yamlFingerprint(YAML_A),
            remoteHash: gdrive.yamlFingerprint(YAML_A),
        });
    });

    it("forgets everything about a trip on unbind", async () => {
        await loadSync();
        sync.adoptCloudTrip(TRIP, "file-9", YAML_A, "md5-9");
        sync.unbindTrip(TRIP);

        expect(sync.cloudFileId(TRIP)).toBeNull();
        expect(gdrive.loadTripSyncMap()).toEqual({});
    });

    it("unbinds every trip pointing at a file it deleted from Drive", async () => {
        await loadSync();
        sync.adoptCloudTrip("p-a", "file-1", YAML_A, "md5-1");
        sync.adoptCloudTrip("p-b", "file-2", YAML_B, "md5-2");
        createDriveStub({});

        await sync.deleteTrip("file-1");

        expect(sync.cloudFileId("p-a")).toBeNull();
        expect(sync.cloudFileId("p-b")).toBe("file-2");
    });
});

describe("boundFileIdsFor", () => {
    function cloudFile(id: string): { id: string; name: string; modifiedTime: string; } {
        return { id, name: `${id}.yaml`, modifiedTime: "2026-06-11T00:00:00Z" };
    }

    it("includes only ids whose bound file is still present in cloudFiles", async () => {
        await loadSync();
        sync.adoptCloudTrip("p-a", "file-1", YAML_A, "md5-1");
        sync.adoptCloudTrip("p-b", "file-2", YAML_B, "md5-2");
        sync.cloudFiles = [cloudFile("file-1")]; // file-2 has since been trashed/removed

        expect([...sync.boundFileIdsFor(["p-a", "p-b"])]).toEqual(["file-1"]);
    });

    it("omits an unbound trip id entirely", async () => {
        await loadSync();
        sync.adoptCloudTrip("p-a", "file-1", YAML_A, "md5-1");
        sync.cloudFiles = [cloudFile("file-1")];

        expect([...sync.boundFileIdsFor(["p-a", "p-never-bound"])]).toEqual(["file-1"]);
    });

    it("returns an empty set when nothing is bound or nothing is live", async () => {
        await loadSync();
        expect(sync.boundFileIdsFor([]).size).toBe(0);
        expect(sync.boundFileIdsFor(["p-a"]).size).toBe(0);
    });
});

describe("importCloudTripAsProfile", () => {
    // Unlike YAML_A/YAML_B (byte-level fixtures for upload/download tests, never
    // actually parsed), this method runs the downloaded bytes through the same
    // `validateYaml` gate the editor and AI edits do, so a success case needs a
    // structurally valid trip.
    const VALID_DOWNLOAD = "trip:\n  name: 東京\n  hotels: []\ndays:\n  - date: '2026-10-01'\n    title: Day1\n    timeline: []\n";

    it("returns null when the download itself fails (already toasted by loadTripYaml)", async () => {
        await loadSync();
        createDriveStub({ meta: { status: 500 } });

        expect(await sync.importCloudTripAsProfile("file-9")).toBeNull();
    });

    it("returns the invalid YAML for the caller to show, without creating a profile", async () => {
        await loadSync();
        createDriveStub({
            meta: { body: { id: "file-9", name: "亂寫.yaml", md5Checksum: "md5-9" } },
            download: "not: a\nvalid: trip",
        });
        const profilesBefore = listProfiles().length;

        const result = await sync.importCloudTripAsProfile("file-9");

        expect(result?.ok).toBe(false);
        if (result?.ok === false) {
            expect(result.yaml).toBe("not: a\nvalid: trip");
            expect(result.error).toEqual(expect.any(String));
        }
        expect(listProfiles().length).toBe(profilesBefore);
    });

    it("parks the outgoing trip, adopts the file under the new profile, and reports its id", async () => {
        await loadSync();
        const outgoingId = ensureActiveProfileId();
        localStorage.setItem(USER_YAML_KEY, YAML_B);
        createDriveStub({
            meta: { body: { id: "file-9", name: "東京.yaml", md5Checksum: "md5-9" } },
            download: VALID_DOWNLOAD,
        });

        const result = await sync.importCloudTripAsProfile("file-9");

        expect(result?.ok).toBe(true);
        if (result?.ok !== true) throw new Error("expected success");
        expect(result.yaml).toBe(VALID_DOWNLOAD);
        expect(result.profileId).not.toBe(outgoingId);
        // The outgoing active trip is parked as a profile, not dropped.
        expect(listProfiles().some(p => p.id === outgoingId)).toBe(true);
        // The new profile is bound to the file that was just downloaded.
        expect(sync.cloudFileId(result.profileId)).toBe("file-9");
        expect(getActiveProfileId()).toBe(result.profileId);
    });

    it("never calls beforeCommit when the download turns out invalid", async () => {
        await loadSync();
        const beforeCommit = vi.fn(() => true);
        createDriveStub({ meta: { body: { id: "file-1", name: "無效.yaml" } }, download: "not: valid" });

        await sync.importCloudTripAsProfile("file-1", beforeCommit);

        expect(beforeCommit).not.toHaveBeenCalled();
    });

    it("aborts without parking anything when beforeCommit reports its save failed", async () => {
        // The outgoing trip's latest edits only exist in the caller's memory. Parking the
        // stale copy that is still in storage would lose them with nothing left to undo.
        await loadSync();
        const outgoingId = ensureActiveProfileId();
        localStorage.setItem(USER_YAML_KEY, YAML_B);
        createDriveStub({
            meta: { body: { id: "file-9", name: "東京.yaml", md5Checksum: "md5-9" } },
            download: VALID_DOWNLOAD,
        });

        expect(await sync.importCloudTripAsProfile("file-9", () => false)).toBeNull();

        expect(getActiveProfileId()).toBe(outgoingId);
        expect(localStorage.getItem(USER_YAML_KEY)).toBe(YAML_B);
        expect(listProfiles()).toEqual([]);
    });

    it("re-identifies a file whose trip this device already holds, and leaves the copy unbound", async () => {
        // Reachable when the file's appProperty is missing or stale, or when a rebind pass
        // was skipped. Two local trips sharing one id would fight over a single Drive file.
        const held = "trip:\n  name: 東京\n  id: t-tokyo\n  hotels: []\ndays:\n  - date: '2026-10-01'\n    title: Day1\n    timeline: []\n";
        localStorage.setItem(USER_YAML_KEY, held);
        ensureActiveProfileId();
        await loadSync();
        createDriveStub({
            meta: { body: { id: "file-9", name: "東京.yaml", md5Checksum: "md5-9" } },
            download: held,
        });

        const result = await sync.importCloudTripAsProfile("file-9");

        expect(result?.ok).toBe(true);
        if (result?.ok !== true) throw new Error("expected success");
        expect(result.yaml).not.toContain("t-tokyo");
        // Unbound: this copy is a trip of its own now, not the one that file belongs to.
        expect(sync.cloudFileId(result.profileId)).toBeNull();
    });

    it("runs beforeCommit before createProfile snapshots the outgoing trip", async () => {
        await loadSync();
        ensureActiveProfileId();
        localStorage.setItem(USER_YAML_KEY, "trip:\n  name: 舊版本待更新\ndays: []\n");
        createDriveStub({
            meta: { body: { id: "file-2", name: "東京.yaml", md5Checksum: "md5-2" } },
            download: VALID_DOWNLOAD,
        });
        const outgoingId = getActiveProfileId();

        const result = await sync.importCloudTripAsProfile("file-2", () => {
            // Simulates a caller flushing its own in-memory edits (e.g. App.svelte's
            // `saveTripData(tripData)`) right before the outgoing trip is parked.
            localStorage.setItem(USER_YAML_KEY, YAML_B);
            return true;
        });

        expect(result?.ok).toBe(true);
        // createProfile must have parked what beforeCommit just wrote, not the
        // stale value that was in storage before this call started.
        expect(listProfiles().find(p => p.id === outgoingId)?.name).toBe("東京改");
    });
});

describe("scheduleSync", () => {
    it("collapses a burst of saves into one upload", async () => {
        await loadSync();
        const calls = createDriveStub({ upload: { id: "file-1", name: "東京.yaml", md5Checksum: "md5-1" } });
        sync.setAutoSync(true);

        vi.useFakeTimers();
        try {
            sync.scheduleSync(YAML_A, TRIP);
            sync.scheduleSync(YAML_A, TRIP);
            sync.scheduleSync(YAML_B, TRIP);
            await vi.runAllTimersAsync();
        } finally {
            vi.useRealTimers();
        }

        expect(calls.filter(c => c.url.includes("/upload/")).length).toBe(1);
        // The last payload wins, not the first.
        expect(gdrive.loadTripSyncMap()[TRIP].localHash).toBe(gdrive.yamlFingerprint(YAML_B));
    });

    it("does nothing while automatic sync is off", async () => {
        await loadSync();
        const calls = createDriveStub({ upload: { id: "file-1", name: "東京.yaml" } });
        sync.setAutoSync(false);

        vi.useFakeTimers();
        try {
            sync.scheduleSync(YAML_A, TRIP);
            await vi.runAllTimersAsync();
        } finally {
            vi.useRealTimers();
        }

        expect(calls.length).toBe(0);
    });

    it("cancels an armed upload when the user opts out inside the window", async () => {
        await loadSync();
        const calls = createDriveStub({ upload: { id: "file-1", name: "東京.yaml" } });
        sync.setAutoSync(true);

        vi.useFakeTimers();
        try {
            sync.scheduleSync(YAML_A, TRIP);
            sync.setAutoSync(false);
            await vi.runAllTimersAsync();
        } finally {
            vi.useRealTimers();
        }

        expect(calls.length).toBe(0);
    });
});

describe("refreshFiles", () => {
    const CLOUD = { id: "file-1", name: "東京.yaml", modifiedTime: "2026-06-11T00:00:00Z" };

    /** How many list round-trips actually went out — the folder is pre-seeded, so one per refresh. */
    function listCalls(calls: { url: string; }[]): number {
        return calls.filter(c => c.url.includes("in+parents") || c.url.includes("in%20parents")).length;
    }

    beforeEach(() => {
        gdrive.saveGdriveFolderId("folder-1");
    });

    it("serves the cached list inside the TTL and refetches once past it", async () => {
        await loadSync();
        const calls = createDriveStub({ list: [CLOUD], meta: { body: { id: "folder-1" } } });

        vi.useFakeTimers();
        try {
            await sync.refreshFiles();
            expect(listCalls(calls)).toBe(1);

            await sync.refreshFiles();
            expect(listCalls(calls)).toBe(1);

            vi.advanceTimersByTime(61_000);
            await sync.refreshFiles();
            expect(listCalls(calls)).toBe(2);
        } finally {
            vi.useRealTimers();
        }
    });

    it("refetches inside the TTL when forced, which is what a push or delete needs", async () => {
        await loadSync();
        const calls = createDriveStub({ list: [CLOUD], meta: { body: { id: "folder-1" } } });

        await sync.refreshFiles();
        await sync.refreshFiles({ force: true });

        expect(listCalls(calls)).toBe(2);
    });

    it("never reaches Google when the token has expired", async () => {
        gdrive.clearCachedAccessToken();
        await loadSync();
        const calls = createDriveStub({ list: [CLOUD], meta: { body: { id: "folder-1" } } });

        await sync.refreshFiles();

        // The whole point: no request, no GIS, and above all no popup outside a gesture.
        expect(calls.length).toBe(0);
        expect(sync.cloudListState).toBe("failed");
    });

    it("keeps the last good list when a later refresh fails, so a retry cannot flash empty", async () => {
        await loadSync();
        createDriveStub({ list: [CLOUD], meta: { body: { id: "folder-1" } } });
        await sync.refreshFiles();
        expect(sync.cloudFiles).toHaveLength(1);

        gdrive.clearCachedAccessToken();
        await sync.refreshFiles({ force: true });

        expect(sync.cloudListState).toBe("failed");
        expect(sync.cloudFiles).toHaveLength(1);
    });

    it("reports idle rather than failed when nobody is signed in", async () => {
        gdrive.clearGdriveUser();
        await loadSync();

        expect(await sync.refreshFiles()).toEqual([]);
        expect(sync.cloudListState).toBe("idle");
    });
});

describe("connect", () => {
    /** Captures the prompt GIS was asked for; the token cache must be empty or it short-circuits. */
    function stubGis(): string[] {
        const prompts: string[] = [];
        vi.stubGlobal("window", {
            google: {
                accounts: {
                    oauth2: {
                        initTokenClient: (config: { prompt?: string; callback: (r: unknown) => void; }) => ({
                            requestAccessToken: (opts?: { prompt?: string; }) => {
                                prompts.push(opts?.prompt ?? config.prompt ?? "");
                                config.callback({
                                    access_token: "gis-token",
                                    expires_in: 3600,
                                    scope: "https://www.googleapis.com/auth/drive.file",
                                });
                            },
                        }),
                    },
                },
            },
        });
        vi.stubGlobal(
            "fetch",
            vi.fn((url: string) => {
                if (url.includes("oauth2/v3/userinfo")) {
                    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ email: "a@example.com", name: "A" }) });
                }
                return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ files: [] }) });
            }),
        );
        return prompts;
    }

    it("re-authorizes an account that is already signed in without the consent screen", async () => {
        gdrive.clearCachedAccessToken();
        await loadSync();
        const prompts = stubGis();

        expect(await sync.connect()).toBe(true);
        expect(prompts).toEqual([""]);
    });

    it("asks for consent on a first sign-in", async () => {
        gdrive.clearGdriveUser();
        gdrive.clearCachedAccessToken();
        await loadSync();
        const prompts = stubGis();

        expect(await sync.connect()).toBe(true);
        expect(prompts).toEqual(["consent"]);
    });
});
