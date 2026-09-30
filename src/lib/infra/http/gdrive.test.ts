import { yamlFingerprint } from "$lib/domain/utils";
import { appStorage } from "$lib/infra/storage/app-storage";
import { createLocalStorageStub } from "$lib/testing/stubs";
import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from "vitest";
import {
    clearCachedAccessToken,
    clearDeadShareLink,
    clearGdriveUser,
    deleteCloudTrip,
    downloadCloudTripYaml,
    fetchCloudTripMeta,
    fetchGoogleUserInfo,
    findOrCreateAppFolder,
    GDRIVE_FOLDER_NAME,
    GDRIVE_TRIPS_STORAGE,
    GDRIVE_USER_STORAGE,
    getCachedAccessToken,
    listCloudTrips,
    loadGdriveUser,
    loadTripSyncMap,
    saveGdriveUser,
    saveTripSyncMap,
    setCachedAccessToken,
    uploadOrUpdateCloudTrip,
} from "./gdrive";

/** One recorded fetch, typed, so the request-shape assertions below stay type-checked. */
function fetchCall(index: number): { url: string; method: string; headers: Record<string, string>; body: string; } {
    const mock = globalThis.fetch as unknown as { mock: { calls: [string, RequestInit][]; }; };
    const [url, init] = mock.mock.calls[index]!;
    return {
        url,
        method: init.method ?? "GET",
        headers: (init.headers ?? {}) as Record<string, string>,
        body: typeof init.body === "string" ? init.body : "",
    };
}

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
        it("handles user profile save, load, clear", () => {
            expect(loadGdriveUser()).toBeNull();
            const user = { email: "user@example.com", name: "User Example", picture: "https://pic.jpg" };
            saveGdriveUser(user);
            expect(JSON.parse(appStorage.get(GDRIVE_USER_STORAGE) ?? "{}")).toEqual(user);
            expect(loadGdriveUser()).toEqual(user);
            clearGdriveUser();
            expect(loadGdriveUser()).toBeNull();
        });

        it("round-trips the per-trip sync record", () => {
            expect(loadTripSyncMap()).toEqual({});
            saveTripSyncMap({ "trip-1": { fileId: "file-abc", remoteMd5: "md5-1", localHash: "h1" } });
            expect(loadTripSyncMap()).toEqual({ "trip-1": { fileId: "file-abc", remoteMd5: "md5-1", localHash: "h1" } });
        });

        it("drops records that name no Drive file", () => {
            appStorage.set(
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
            const boundary = req.headers["Content-Type"]!.split("boundary=")[1];
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

describe("clearDeadShareLink", () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    /** A Drive file carrying `shareLink` (or no link), answering any PATCH with success. */
    function stubDrive(shareLink?: string) {
        vi.stubGlobal(
            "fetch",
            vi.fn((_url: string, init?: RequestInit) =>
                Promise.resolve({
                    ok: true,
                    status: 200,
                    json: () => Promise.resolve(init?.method === "PATCH" ? {} : { id: "file-1", name: "東京.yaml", appProperties: shareLink ? { shareLink, shareLinkAt: "" } : {} }),
                })
            ),
        );
    }

    it("clears the properties while they still name the dead link", async () => {
        stubDrive("abcd1234.key.tok");

        await expect(clearDeadShareLink("token", "file-1", "abcd1234")).resolves.toBe(true);

        const patch = fetchCall(1);
        expect(patch.method).toBe("PATCH");
        expect(JSON.parse(patch.body)).toEqual({ appProperties: { shareLink: null, shareLinkAt: null } });
    });

    // Another device may have minted a replacement since, and clearing that would lose a working link.
    it("leaves a different link, or none, alone", async () => {
        for (const shareLink of ["efgh5678.key.tok", undefined]) {
            stubDrive(shareLink);
            await expect(clearDeadShareLink("token", "file-1", "abcd1234")).resolves.toBe(false);
            expect(fetchCall(0).method).toBe("GET");
            expect(globalThis.fetch).toHaveBeenCalledTimes(1);
        }
    });
});
