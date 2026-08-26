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
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from "vitest";
import { USER_YAML_KEY } from "./api";
import {
    ensureActiveProfileId,
    getActiveProfileId,
    listProfiles,
} from "./profiles";

type GdriveModule = typeof import("./gdrive");
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

    gdrive = await import("./gdrive");
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

        const res = await sync.sync("東京", YAML_A, TRIP);

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
        });
    });

    it("updates the bound file when only the local copy moved", async () => {
        gdrive.saveTripSyncMap({ [TRIP]: { fileId: "file-1", remoteMd5: "md5-1", localHash: gdrive.yamlFingerprint(YAML_A) } });
        await loadSync();
        const calls = createDriveStub({
            meta: { body: { id: "file-1", name: "東京.yaml", md5Checksum: "md5-1" } },
            upload: { id: "file-1", name: "東京.yaml", md5Checksum: "md5-2" },
        });

        const res = await sync.sync("東京", YAML_B, TRIP);

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

        await sync.sync("東京", YAML_A, TRIP);

        // The user edited while that upload was in flight: the record must still describe
        // YAML_A, or the next sync would call the newer content already sent.
        expect(gdrive.loadTripSyncMap()[TRIP].localHash).not.toBe(gdrive.yamlFingerprint(YAML_B));
        expect(gdrive.decideSyncAction({
            record: gdrive.loadTripSyncMap()[TRIP],
            remoteExists: true,
            remoteMd5: "md5-1",
            localHash: gdrive.yamlFingerprint(YAML_B),
        })).toBe("push");
    });

    it("creates a new file instead of patching one Drive no longer has", async () => {
        gdrive.saveTripSyncMap({ [TRIP]: { fileId: "gone", remoteMd5: "md5-1", localHash: "h" } });
        await loadSync();
        const calls = createDriveStub({ meta: { status: 404 }, upload: { id: "file-2", name: "東京.yaml", md5Checksum: "md5-2" } });

        const res = await sync.sync("東京", YAML_A, TRIP);

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

        await sync.sync("東京", YAML_A, TRIP);

        expect(calls.find(c => c.url.includes("/upload/"))?.method).toBe("POST");
        expect(gdrive.loadTripSyncMap()[TRIP].fileId).toBe("file-3");
    });
});

describe("sync: pulling", () => {
    it("hands the remote YAML back and records it as the agreed copy", async () => {
        gdrive.saveTripSyncMap({ [TRIP]: { fileId: "file-1", remoteMd5: "md5-1", localHash: gdrive.yamlFingerprint(YAML_A) } });
        await loadSync();
        createDriveStub({
            meta: { body: { id: "file-1", name: "東京.yaml", md5Checksum: "md5-2" } },
            download: YAML_B,
        });

        const res = await sync.sync("東京", YAML_A, TRIP);

        expect(res?.action).toBe("pulled");
        expect(res?.yaml).toBe(YAML_B);
        expect(gdrive.loadTripSyncMap()[TRIP]).toEqual({
            fileId: "file-1",
            remoteMd5: "md5-2",
            localHash: gdrive.yamlFingerprint(YAML_B),
        });
    });

    it("asks instead of downloading on the background path", async () => {
        gdrive.saveTripSyncMap({ [TRIP]: { fileId: "file-1", remoteMd5: "md5-1", localHash: gdrive.yamlFingerprint(YAML_A) } });
        await loadSync();
        const calls = createDriveStub({
            meta: { body: { id: "file-1", name: "東京.yaml", md5Checksum: "md5-2" } },
            download: YAML_B,
        });

        const res = await sync.sync("東京", YAML_A, TRIP, { interactive: false });

        // A debounced timer has nowhere to put the YAML and must not swap the trip.
        expect(res?.action).toBe("conflict");
        expect(sync.conflict).toEqual({ tripId: TRIP, fileName: "東京", kind: "remote-newer" });
        expect(calls.some(c => c.url.includes("alt=media"))).toBe(false);
        expect(gdrive.loadTripSyncMap()[TRIP].remoteMd5).toBe("md5-1");
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

        const res = await sync.sync("東京", YAML_A, TRIP);

        expect(res?.action).toBe("conflict");
        expect(sync.conflict?.kind).toBe("both-changed");
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
        await sync.sync("東京", YAML_A, TRIP);
        expect(sync.conflict).not.toBeNull();

        const res = await sync.sync("東京", YAML_A, TRIP, { force: "local" });

        expect(res?.action).toBe("pushed");
        expect(sync.conflict).toBeNull();
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
        await sync.sync("東京", YAML_A, TRIP);

        const res = await sync.sync("東京", YAML_A, TRIP, { force: "remote" });

        expect(res?.action).toBe("pulled");
        expect(res?.yaml).toBe(YAML_B);
        expect(sync.conflict).toBeNull();
    });

    it("pauses the debounced path for a trip whose conflict is unresolved", async () => {
        gdrive.saveTripSyncMap({ [TRIP]: diverged });
        await loadSync();
        createDriveStub({ meta: { body: { id: "file-1", name: "東京.yaml", md5Checksum: "md5-2" } } });
        sync.setAutoSync(true);
        await sync.sync("東京", YAML_A, TRIP);
        expect(sync.conflict).not.toBeNull();

        vi.useFakeTimers();
        try {
            sync.scheduleSync("東京", YAML_B, TRIP);
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

        expect(await sync.sync("東京", YAML_A, TRIP)).toBeNull();
    });

    it("reports up to date without writing when neither side moved", async () => {
        const record = { fileId: "file-1", remoteMd5: "md5-1", localHash: gdrive.yamlFingerprint(YAML_A) };
        gdrive.saveTripSyncMap({ [TRIP]: record });
        await loadSync();
        const calls = createDriveStub({ meta: { body: { id: "file-1", name: "東京.yaml", md5Checksum: "md5-1" } } });

        const res = await sync.sync("東京", YAML_A, TRIP);

        expect(res?.action).toBe("up_to_date");
        expect(calls.some(c => c.url.includes("/upload/"))).toBe(false);
        expect(gdrive.loadTripSyncMap()[TRIP]).toEqual(record);
    });

    it("drops the cached token on a 401 so the next attempt re-authenticates", async () => {
        gdrive.saveTripSyncMap({ [TRIP]: { fileId: "file-1", remoteMd5: "md5-1", localHash: "h" } });
        await loadSync();
        createDriveStub({ meta: { status: 401 } });

        expect(await sync.sync("東京", YAML_A, TRIP)).toBeNull();
        expect(gdrive.getCachedAccessToken()).toBeNull();
    });

    it("keeps the cached token on a 403, which is usually a rate limit", async () => {
        gdrive.saveTripSyncMap({ [TRIP]: { fileId: "file-1", remoteMd5: "md5-1", localHash: "h" } });
        await loadSync();
        createDriveStub({ meta: { status: 403 } });

        expect(await sync.sync("東京", YAML_A, TRIP)).toBeNull();
        expect(gdrive.getCachedAccessToken()).toBe("token-1");
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
        const beforeCommit = vi.fn();
        createDriveStub({ meta: { body: { id: "file-1", name: "無效.yaml" } }, download: "not: valid" });

        await sync.importCloudTripAsProfile("file-1", beforeCommit);

        expect(beforeCommit).not.toHaveBeenCalled();
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
            sync.scheduleSync("東京", YAML_A, TRIP);
            sync.scheduleSync("東京", YAML_A, TRIP);
            sync.scheduleSync("東京", YAML_B, TRIP);
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
            sync.scheduleSync("東京", YAML_A, TRIP);
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
            sync.scheduleSync("東京", YAML_A, TRIP);
            sync.setAutoSync(false);
            await vi.runAllTimersAsync();
        } finally {
            vi.useRealTimers();
        }

        expect(calls.length).toBe(0);
    });
});
