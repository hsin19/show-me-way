import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from "vitest";
import {
    buildRebindRecord,
    clearCachedAccessToken,
    clearGdriveUser,
    decideSyncAction,
    deleteCloudTrip,
    downloadCloudTripYaml,
    fetchCloudTripMeta,
    fetchGoogleUserInfo,
    findOrCreateAppFolder,
    GDRIVE_FOLDER_NAME,
    GDRIVE_TRIPS_STORAGE,
    GDRIVE_USER_STORAGE,
    getCachedAccessToken,
    getGdriveClientId,
    listCloudTrips,
    loadGdriveAutoSync,
    loadGdriveUser,
    loadTripSyncMap,
    migrateGdriveSyncState,
    saveGdriveAutoSync,
    saveGdriveUser,
    saveTripSyncMap,
    setCachedAccessToken,
    uploadOrUpdateCloudTrip,
    yamlFingerprint,
} from "./gdrive";

/** One recorded fetch, typed, so the request-shape assertions below stay type-checked. */
function fetchCall(index: number): { url: string; method: string; headers: Record<string, string>; body: string; } {
    const mock = globalThis.fetch as unknown as { mock: { calls: [string, RequestInit][]; }; };
    const [url, init] = mock.mock.calls[index];
    return {
        url,
        method: init.method ?? "GET",
        headers: (init.headers ?? {}) as Record<string, string>,
        body: typeof init.body === "string" ? init.body : "",
    };
}

function createLocalStorageStub() {
    const store = new Map<string, string>();
    return {
        // length/key included so the prefix sweeps under test can actually see anything.
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

describe("yamlFingerprint", () => {
    it("is stable for identical content and differs for a one-character edit", () => {
        const a = "trip:\n  name: 東京\n";
        expect(yamlFingerprint(a)).toBe(yamlFingerprint(a));
        expect(yamlFingerprint(a)).not.toBe(yamlFingerprint("trip:\n  name: 東京 \n"));
        expect(yamlFingerprint("")).toBe(yamlFingerprint(""));
    });
});

describe("decideSyncAction", () => {
    // Both sides agreed on md5-a / hash-a at the last sync.
    const agreed = {
        record: { fileId: "file-1", remoteMd5: "md5-a", localHash: "hash-a", remoteHash: "hash-a" },
        remoteExists: true,
        remoteMd5: "md5-a",
        remoteHash: "hash-a",
        localHash: "hash-a",
    };

    it("pushes when the trip has no Drive file yet", () => {
        expect(decideSyncAction({ ...agreed, record: null })).toBe("push");
    });

    it("pushes when the bound file is gone from Drive", () => {
        expect(decideSyncAction({ ...agreed, remoteExists: false })).toBe("push");
    });

    it("pushes a record migrated from the timestamp scheme, which agreed on nothing", () => {
        // The one case that can overwrite a remote another device advanced — documented.
        expect(decideSyncAction({ ...agreed, record: { fileId: "file-1" } })).toBe("push");
    });

    it("compares the recorded hashes when the record predates md5 but has one", () => {
        // Narrower than "no remoteMd5 means push": a hash on both sides is a usable base.
        const record = { fileId: "file-1", localHash: "hash-a", remoteHash: "hash-a" };
        expect(decideSyncAction({ ...agreed, record, remoteMd5: null })).toBe("up_to_date");
        expect(decideSyncAction({ ...agreed, record, remoteMd5: null, remoteHash: "hash-b", localHash: "hash-b" }))
            .toBe("up_to_date");
    });

    describe("with md5 saying the remote moved", () => {
        const moved = { ...agreed, remoteMd5: "md5-b" };

        it("pulls when only the remote moved, whatever the remote hash claims", () => {
            // Rule 1 outranks rule 2: equal hashes against a moved md5 means the hash is
            // stale — someone wrote the file outside this app — and the bytes win.
            expect(decideSyncAction({ ...moved, remoteHash: "hash-a" })).toBe("pull");
            expect(decideSyncAction({ ...moved, remoteHash: "hash-b" })).toBe("pull");
            expect(decideSyncAction({ ...moved, remoteHash: null })).toBe("pull");
        });

        it("resolves to up_to_date when both sides moved to identical content", () => {
            expect(decideSyncAction({ ...moved, remoteHash: "hash-b", localHash: "hash-b" })).toBe("up_to_date");
        });

        it("reports a conflict when both sides moved apart", () => {
            expect(decideSyncAction({ ...moved, remoteHash: "hash-c", localHash: "hash-b" })).toBe("conflict");
            expect(decideSyncAction({ ...moved, remoteHash: null, localHash: "hash-b" })).toBe("conflict");
        });
    });

    describe("with md5 saying the remote stood still", () => {
        it("does nothing when neither side moved", () => {
            expect(decideSyncAction(agreed)).toBe("up_to_date");
        });

        it("pushes local changes", () => {
            expect(decideSyncAction({ ...agreed, localHash: "hash-b" })).toBe("push");
            expect(decideSyncAction({ ...agreed, localHash: "hash-b", remoteHash: null })).toBe("push");
        });

        it("skips the upload when the local edit landed back on the remote's content", () => {
            expect(decideSyncAction({
                ...agreed,
                record: { ...agreed.record, localHash: "hash-b", remoteHash: "hash-a" },
            })).toBe("up_to_date");
        });
    });

    describe("with the remote's movement unknowable", () => {
        // Drive reporting no md5 for a live file, and no recorded hash to fall back on.
        const unknowable = { ...agreed, remoteMd5: null, record: { fileId: "file-1", remoteMd5: "md5-a", localHash: "hash-a" } };

        it("derives the direction from the content comparison when it can", () => {
            // An agreement is only ever recorded from bytes both sides hold, so local
            // standing still while the contents differ can only mean the remote moved.
            expect(decideSyncAction({ ...unknowable, remoteHash: "hash-b" })).toBe("pull");
            expect(decideSyncAction({ ...unknowable, remoteHash: "hash-b", localHash: "hash-b" })).toBe("up_to_date");
            expect(decideSyncAction({ ...unknowable, remoteHash: "hash-c", localHash: "hash-b" })).toBe("conflict");
        });

        it("never pushes blind with nothing at all to compare", () => {
            // Unknowable, not unchanged — pushing here would be last-writer-wins.
            expect(decideSyncAction({ ...unknowable, remoteHash: null, localHash: "hash-b" })).toBe("conflict");
            expect(decideSyncAction({ ...unknowable, remoteHash: null })).toBe("up_to_date");
        });
    });

    it("treats a record with no local fingerprint as locally changed", () => {
        const record = { fileId: "file-1", remoteMd5: "md5-a" };
        expect(decideSyncAction({ ...agreed, record, remoteHash: null })).toBe("push");
        expect(decideSyncAction({ ...agreed, record, remoteMd5: "md5-b", remoteHash: null })).toBe("conflict");
    });

    describe("with an unresolved rebind on the record", () => {
        // What buildRebindRecord writes when the two copies differ: a binding, no base.
        const rebound = { fileId: "file-1", remoteMd5: "md5-a", remoteHash: "hash-a", diverged: true };

        it("refuses to push past it even though nothing moved since", () => {
            // The whole point: without the flag this is indistinguishable from a legacy
            // record, and "assume local moved" would overwrite a cloud copy the user has
            // never seen. It has to survive the reload that drops any in-memory conflict.
            expect(decideSyncAction({ ...agreed, record: rebound, localHash: "hash-b" })).toBe("conflict");
        });

        it("still refuses when only the remote has moved on", () => {
            expect(decideSyncAction({ ...agreed, record: rebound, remoteMd5: "md5-b", remoteHash: "hash-c", localHash: "hash-b" }))
                .toBe("conflict");
        });

        it("settles itself when the two sides turn out to hold the same content", () => {
            // The one resolution that needs no decision — nothing would be discarded.
            expect(decideSyncAction({ ...agreed, record: rebound, remoteHash: "hash-b", localHash: "hash-b" }))
                .toBe("up_to_date");
        });

        it("leaves a legacy record without one pushing as before", () => {
            // Records migrated from the timestamp scheme also lack a localHash; only the
            // flag distinguishes them, and their documented behaviour is to push.
            const legacy = { fileId: "file-1", remoteMd5: "md5-a", remoteHash: "hash-a" };
            expect(decideSyncAction({ ...agreed, record: legacy, localHash: "hash-b" })).toBe("push");
        });
    });
});

describe("buildRebindRecord", () => {
    const file = { id: "file-1", md5Checksum: "md5-a", contentHash: "hash-a" };

    it("records a complete agreement when the two copies match", () => {
        // The payoff of publishing contentHash: a full merge base without downloading.
        expect(buildRebindRecord(file, "hash-a")).toEqual({
            fileId: "file-1",
            remoteMd5: "md5-a",
            remoteHash: "hash-a",
            localHash: "hash-a",
        });
    });

    it("binds the file but marks it diverged when the two copies differ", () => {
        // A localHash here would claim the two sides once shared contents they never did,
        // and the next sync would read that as up_to_date. `diverged` is what holds it
        // instead, and it is on the record so a reload cannot lose it.
        expect(buildRebindRecord(file, "hash-b")).toEqual({
            fileId: "file-1",
            remoteMd5: "md5-a",
            remoteHash: "hash-a",
            diverged: true,
        });
    });

    it("cannot agree with a file that published no hash", () => {
        expect(buildRebindRecord({ id: "file-1", md5Checksum: "md5-a" }, "hash-a")).toEqual({
            fileId: "file-1",
            remoteMd5: "md5-a",
            remoteHash: undefined,
            diverged: true,
        });
    });
});

describe("gdrive module", () => {
    let storage: ReturnType<typeof createLocalStorageStub>;

    beforeEach(() => {
        storage = createLocalStorageStub();
        vi.stubGlobal("localStorage", storage);
        clearCachedAccessToken();
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    describe("storage helpers", () => {
        it("reads client ID from environment or fallback", () => {
            const envId = (import.meta.env?.VITE_GOOGLE_CLIENT_ID)?.trim();
            const expectedId = envId || "849908319136-che7nc9nag6ua5gd3fipk9evme4ngjde.apps.googleusercontent.com";
            expect(getGdriveClientId()).toBe(expectedId);
        });

        it("handles user profile save, load, clear", () => {
            expect(loadGdriveUser()).toBeNull();
            const user = { email: "user@example.com", name: "User Example", picture: "https://pic.jpg" };
            saveGdriveUser(user);
            expect(JSON.parse(storage.getItem(GDRIVE_USER_STORAGE) ?? "{}")).toEqual(user);
            expect(loadGdriveUser()).toEqual(user);
            clearGdriveUser();
            expect(loadGdriveUser()).toBeNull();
        });

        it("handles auto sync setting", () => {
            expect(loadGdriveAutoSync()).toBe(false);
            saveGdriveAutoSync(true);
            expect(loadGdriveAutoSync()).toBe(true);
            saveGdriveAutoSync(false);
            expect(loadGdriveAutoSync()).toBe(false);
        });

        it("folds the earlier per-concern maps into one record and removes them", () => {
            storage.setItem("showmeway_gdrive_file_map", JSON.stringify({ "p-1": "file-1", "p-2": "file-2" }));
            storage.setItem("showmeway_gdrive_md5_map", JSON.stringify({ "p-1": "md5-1" }));
            storage.setItem("showmeway_gdrive_dirty_map", JSON.stringify({ "p-2": true }));
            storage.setItem("showmeway_gdrive_mod_p-1", "1750000000000");

            migrateGdriveSyncState();

            expect(loadTripSyncMap()).toEqual({
                "p-1": { fileId: "file-1", remoteMd5: "md5-1" },
                // No md5 recorded under the old scheme: absent, which decideSyncAction
                // reads as "assume local changed" rather than inventing an agreement.
                "p-2": { fileId: "file-2", remoteMd5: undefined },
            });
            expect(storage.getItem("showmeway_gdrive_file_map")).toBeNull();
            expect(storage.getItem("showmeway_gdrive_md5_map")).toBeNull();
            expect(storage.getItem("showmeway_gdrive_dirty_map")).toBeNull();
            expect(storage.getItem("showmeway_gdrive_mod_p-1")).toBeNull();
        });

        it("is safe to run on every load and never overwrites a newer record", () => {
            saveTripSyncMap({ "p-1": { fileId: "file-new", remoteMd5: "md5-new", localHash: "h" } });
            storage.setItem("showmeway_gdrive_file_map", JSON.stringify({ "p-1": "file-old" }));

            migrateGdriveSyncState();
            migrateGdriveSyncState();

            expect(loadTripSyncMap()["p-1"]).toEqual({ fileId: "file-new", remoteMd5: "md5-new", localHash: "h" });
        });

        it("round-trips the per-trip sync record", () => {
            expect(loadTripSyncMap()).toEqual({});
            saveTripSyncMap({ "trip-1": { fileId: "file-abc", remoteMd5: "md5-1", localHash: "h1" } });
            expect(loadTripSyncMap()).toEqual({ "trip-1": { fileId: "file-abc", remoteMd5: "md5-1", localHash: "h1" } });
        });

        it("drops records that name no Drive file", () => {
            storage.setItem(
                GDRIVE_TRIPS_STORAGE,
                JSON.stringify({ good: { fileId: "f1" }, bad: { remoteMd5: "md5" } }),
            );
            expect(loadTripSyncMap()).toEqual({ good: { fileId: "f1" } });
        });

        it("handles persistent token cache and expiry", () => {
            expect(getCachedAccessToken()).toBeNull();
            setCachedAccessToken("token-xyz", 3600);
            expect(getCachedAccessToken()).toBe("token-xyz");
            // Expired token
            setCachedAccessToken("token-expired", 10); // 10s is within the 60s buffer
            expect(getCachedAccessToken()).toBeNull();
            clearCachedAccessToken();
            expect(getCachedAccessToken()).toBeNull();
        });
    });

    describe("Google Drive API client", () => {
        it("fetches user info", async () => {
            const mockUser = { email: "test@gmail.com", name: "Test User", picture: "https://avatar.jpg" };
            vi.stubGlobal(
                "fetch",
                vi.fn().mockResolvedValue({
                    ok: true,
                    json: () => Promise.resolve(mockUser),
                }),
            );

            const res = await fetchGoogleUserInfo("test-token");
            expect(res).toEqual(mockUser);
        });

        it("throws when fetching user info fails", async () => {
            vi.stubGlobal(
                "fetch",
                vi.fn().mockResolvedValue({
                    ok: false,
                    status: 401,
                }),
            );

            await expect(fetchGoogleUserInfo("bad-token")).rejects.toThrow("無法取得 Google 使用者資訊 (401)");
        });

        it("finds existing App folder or creates it", async () => {
            // First search returns existing folder
            const mockFetch = vi.fn().mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve({ files: [{ id: "folder-123", name: GDRIVE_FOLDER_NAME }] }),
            });
            vi.stubGlobal("fetch", mockFetch);

            const folderId = await findOrCreateAppFolder("token");
            expect(folderId).toBe("folder-123");
        });

        it("creates App folder if not found", async () => {
            const mockFetch = vi.fn()
                // Search: empty
                .mockResolvedValueOnce({
                    ok: true,
                    json: () => Promise.resolve({ files: [] }),
                })
                // Create: success
                .mockResolvedValueOnce({
                    ok: true,
                    json: () => Promise.resolve({ id: "new-folder-999" }),
                });
            vi.stubGlobal("fetch", mockFetch);

            const folderId = await findOrCreateAppFolder("token");
            expect(folderId).toBe("new-folder-999");
        });

        it("lists cloud trip files", async () => {
            const mockFiles = [
                { id: "f1", name: "東京五日.yaml", modifiedTime: "2026-08-23T10:00:00Z", size: "1234", appProperties: { showmewayTripId: "p1", contentHash: "h1" } },
                { id: "f2", name: "京都散策.yml", modifiedTime: "2026-08-22T10:00:00Z", size: "2345" },
            ];
            vi.stubGlobal(
                "fetch",
                vi.fn().mockResolvedValue({
                    ok: true,
                    json: () => Promise.resolve({ files: mockFiles }),
                }),
            );

            const trips = await listCloudTrips("token", "folder-123");
            expect(trips).toEqual([
                { id: "f1", name: "東京五日", modifiedTime: "2026-08-23T10:00:00Z", size: 1234, tripId: "p1", contentHash: "h1" },
                { id: "f2", name: "京都散策", modifiedTime: "2026-08-22T10:00:00Z", size: 2345, tripId: undefined },
            ]);
        });

        it("uploads a new trip file", async () => {
            vi.stubGlobal(
                "fetch",
                vi.fn().mockResolvedValue({
                    ok: true,
                    json: () => Promise.resolve({ id: "file-new", name: "福岡四日.yaml", modifiedTime: "2026-08-23T12:00:00Z" }),
                }),
            );

            const result = await uploadOrUpdateCloudTrip("token", "福岡四日", "trip:\n  name: 福岡四日", {
                folderId: "folder-123",
                tripId: "p-fukuoka",
            });

            const req = fetchCall(0);
            expect(req.method).toBe("POST");
            expect(req.url).toContain("uploadType=multipart");
            expect(req.url).toContain("md5Checksum");
            expect(req.headers["Content-Type"]).toMatch(/^multipart\/related; boundary=/);
            // Both parts, in order, with the trip id that binds the file back to a profile.
            const boundary = req.headers["Content-Type"].split("boundary=")[1];
            const parts = req.body.split(`--${boundary}`);
            expect(parts[1]).toContain('"parents":["folder-123"]');
            expect(parts[1]).toContain('"showmewayTripId":"p-fukuoka"');
            expect(parts[2]).toContain("name: 福岡四日");
            expect(req.body.endsWith(`--${boundary}--`)).toBe(true);

            expect(result.id).toBe("file-new");
            expect(result.name).toBe("福岡四日");
            // The API client writes no local state: the record belongs to the caller,
            // the only side that knows the upload is the copy the user is looking at.
            expect(loadTripSyncMap()).toEqual({});
        });

        it("updates an existing trip file", async () => {
            vi.stubGlobal(
                "fetch",
                vi.fn().mockResolvedValue({
                    ok: true,
                    json: () => Promise.resolve({ id: "file-existing", name: "福岡五日.yaml", modifiedTime: "2026-08-23T13:00:00Z" }),
                }),
            );

            const result = await uploadOrUpdateCloudTrip("token", "福岡五日", "trip:\n  name: 福岡五日", {
                fileId: "file-existing",
                tripId: "p-fukuoka",
            });

            const req = fetchCall(0);
            // PATCH the existing id, and no `parents`: sending one would move the file.
            expect(req.method).toBe("PATCH");
            expect(req.url).toContain("/upload/drive/v3/files/file-existing");
            expect(req.body).not.toContain('"parents"');

            expect(result.id).toBe("file-existing");
            expect(result.name).toBe("福岡五日");
        });

        it("writes the startDate appProperty the trip list sorts on", async () => {
            vi.stubGlobal(
                "fetch",
                vi.fn().mockResolvedValue({
                    ok: true,
                    status: 200,
                    json: () => Promise.resolve({ id: "file-x", name: "東京.yaml", modifiedTime: "2026-08-24T00:00:00Z" }),
                }),
            );

            const yaml = "days:\n  - date: '2026-10-05'\n  - date: '2026-10-01'\n";
            const result = await uploadOrUpdateCloudTrip("token", "東京", yaml, { folderId: "f", tripId: "p-1" });

            // The earliest day, not the first listed one.
            expect(fetchCall(0).body).toContain('"startDate":"2026-10-01"');
            expect(result.startDate).toBe("2026-10-01");
        });

        it("publishes the content fingerprint alongside the bytes it describes", async () => {
            vi.stubGlobal(
                "fetch",
                vi.fn().mockResolvedValue({
                    ok: true,
                    status: 200,
                    json: () => Promise.resolve({ id: "file-x", name: "東京.yaml", modifiedTime: "2026-08-24T00:00:00Z" }),
                }),
            );

            const yaml = "trip:\n  name: 東京\n";
            const result = await uploadOrUpdateCloudTrip("token", "東京", yaml, { folderId: "f", tripId: "p-1" });

            // One request, so a reader can never see the hash without the content it names.
            expect(fetchCall(0).body).toContain(`"contentHash":"${yamlFingerprint(yaml)}"`);
            expect(result.contentHash).toBe(yamlFingerprint(yaml));
        });

        it("downloads yaml content", async () => {
            vi.stubGlobal(
                "fetch",
                vi.fn().mockResolvedValue({
                    ok: true,
                    text: () => Promise.resolve("trip:\n  name: 測試下載\n"),
                }),
            );

            const yaml = await downloadCloudTripYaml("token", "file-123");
            expect(yaml).toBe("trip:\n  name: 測試下載\n");
        });

        it("deletes a trip file", async () => {
            vi.stubGlobal(
                "fetch",
                vi.fn().mockResolvedValue({
                    ok: true,
                    status: 204,
                }),
            );

            await expect(deleteCloudTrip("token", "file-123")).resolves.toBeUndefined();
        });

        it("treats a trashed remote file as gone", async () => {
            // files.get answers 200 for a binned file, and Drive accepts writes to it, so
            // reporting it as live would keep syncing the trip into the user's trash.
            vi.stubGlobal(
                "fetch",
                vi.fn().mockResolvedValue({
                    ok: true,
                    status: 200,
                    json: () => Promise.resolve({ id: "file-binned", name: "已刪除.yaml", trashed: true, md5Checksum: "md5-x" }),
                }),
            );

            await expect(fetchCloudTripMeta("token", "file-binned")).resolves.toBeNull();
        });

        it("returns null for a file that no longer exists", async () => {
            vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 404 }));
            await expect(fetchCloudTripMeta("token", "gone")).resolves.toBeNull();
        });

        it("fetches single file metadata with md5Checksum", async () => {
            vi.stubGlobal(
                "fetch",
                vi.fn().mockResolvedValue({
                    ok: true,
                    status: 200,
                    json: () =>
                        Promise.resolve({
                            id: "file-meta",
                            name: "東京五日.yaml",
                            modifiedTime: "2026-08-24T08:00:00Z",
                            md5Checksum: "md5-abc-123",
                            appProperties: { contentHash: "hash-abc-123" },
                        }),
                }),
            );

            const meta = await fetchCloudTripMeta("token", "file-meta");
            expect(meta).not.toBeNull();
            expect(meta?.id).toBe("file-meta");
            expect(meta?.name).toBe("東京五日");
            expect(meta?.md5Checksum).toBe("md5-abc-123");
            expect(meta?.contentHash).toBe("hash-abc-123");
        });
    });
});
