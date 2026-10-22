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
    trashDriveFile,
    uploadAttachment,
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

/**
 * Answers Drive by what each request is for, so a test can pick out the call it is about
 * without depending on the folder lookups around it. `tripFolder` is what the trip-folder
 * search finds — without one an upload creates `folder-trip` under `folder-root` — and
 * `tripFolders` / `tripFiles` what the listing finds under ShowMeWay and in those folders.
 */
function stubDrive(options: { tripFolder?: { id: string; name: string; }; tripFolders?: string[]; tripFiles?: unknown[]; } = {}) {
    const fetchMock = vi.fn((url: string, init: RequestInit = {}) => {
        const method = init.method ?? "GET";
        const query = decodeURIComponent(url);
        const respond = (body: unknown, status = 200, headers: Record<string, string> = {}) => Promise.resolve(new Response(JSON.stringify(body), { status, headers }));
        if (query.includes("appProperties has")) return respond({ files: options.tripFolder ? [options.tripFolder] : [] });
        if (query.includes(`name = '${GDRIVE_FOLDER_NAME}'`)) return respond({ files: [{ id: "folder-root" }] });
        if (query.includes("mimeType = 'text/yaml'")) return respond({ files: options.tripFiles ?? [] });
        if (query.includes("in parents")) return respond({ files: (options.tripFolders ?? []).map(id => ({ id })) });
        if (url.endsWith("/drive/v3/files") && method === "POST") return respond({ id: "folder-trip" });
        if (url.includes("upload_id=")) return respond({ id: "file-attached" });
        if (url.includes("uploadType=resumable")) return respond({}, 200, { Location: "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=session-1" });
        if (url.includes("uploadType=multipart")) return respond({ id: "file-x", name: "東京.yaml", modifiedTime: "2026-08-24T00:00:00Z" });
        return respond({});
    });
    vi.stubGlobal("fetch", fetchMock);
    type Call = { url: string; method: string; headers: Record<string, string>; body: string; rawBody: unknown; };
    return {
        find: (match: (call: Call) => boolean): Call => {
            const call = fetchMock.mock.calls
                .map(([url, init = {}]) => ({ url, method: init.method ?? "GET", headers: (init.headers ?? {}) as Record<string, string>, body: typeof init.body === "string" ? init.body : "", rawBody: init.body }))
                .find(match);
            if (!call) throw new Error("no such request");
            return call;
        },
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

        it("lists the YAML in each trip folder under ShowMeWay, and nothing outside them", async () => {
            const drive = stubDrive({
                tripFolders: ["folder-a", "folder-b"],
                tripFiles: [
                    { id: "f1", name: "東京五日.yaml", modifiedTime: "2026-08-23T10:00:00Z", size: "1234", appProperties: { showmewayTripId: "p1", contentHash: "h1" } },
                    { id: "f2", name: "京都散策.yml", modifiedTime: "2026-08-22T10:00:00Z", size: "2345" },
                ],
            });

            const trips = await listCloudTrips("token");
            expect(trips).toEqual([
                { id: "f1", name: "東京五日", modifiedTime: "2026-08-23T10:00:00Z", size: 1234, tripId: "p1", contentHash: "h1" },
                { id: "f2", name: "京都散策", modifiedTime: "2026-08-22T10:00:00Z", size: 2345, tripId: undefined },
            ]);
            expect(decodeURIComponent(drive.find(c => decodeURIComponent(c.url).includes("in parents and mimeType = 'application")).url)).toContain("'folder-root' in parents");
            expect(decodeURIComponent(drive.find(c => c.url.includes("text%2Fyaml")).url)).toContain("q=('folder-a' in parents or 'folder-b' in parents) and mimeType = 'text/yaml' and trashed = false");
        });

        it("lists nothing, without asking for YAML, while ShowMeWay holds no trip folder", async () => {
            const drive = stubDrive();

            expect(await listCloudTrips("token")).toEqual([]);
            expect(() => drive.find(c => c.url.includes("text%2Fyaml"))).toThrow("no such request");
        });

        it("creates a new trip file inside a folder of its own, named by its month", async () => {
            const drive = stubDrive();

            const result = await uploadOrUpdateCloudTrip("token", "福岡四日", "trip:\n  name: 福岡四日\ndays:\n  - date: '2026-11-03'\n", {
                tripId: "p-fukuoka",
            });

            expect(JSON.parse(drive.find(c => c.url.endsWith("/drive/v3/files") && c.method === "POST").body)).toEqual({
                name: "202611 福岡四日",
                mimeType: "application/vnd.google-apps.folder",
                parents: ["folder-root"],
                appProperties: { showmewayTripId: "p-fukuoka" },
            });
            const req = drive.find(c => c.url.includes("uploadType=multipart"));
            expect(req.method).toBe("POST");
            expect(req.url).toContain("md5Checksum");
            expect(req.headers["Content-Type"]).toMatch(/^multipart\/related; boundary=/);
            // Both parts, in order, with the trip id that binds the file back to a profile.
            const boundary = req.headers["Content-Type"]!.split("boundary=")[1];
            const parts = req.body.split(`--${boundary}`);
            expect(parts[1]).toContain('"parents":["folder-trip"]');
            expect(parts[1]).toContain('"showmewayTripId":"p-fukuoka"');
            expect(parts[2]).toContain("name: 福岡四日");
            expect(req.body.endsWith(`--${boundary}--`)).toBe(true);

            expect(result.id).toBe("file-x");
            // The API client writes no local state: the record belongs to the caller,
            // the only side that knows the upload is the copy the user is looking at.
            expect(loadTripSyncMap()).toEqual({});
        });

        it("updates an existing trip file in place, leaving its folder alone", async () => {
            const drive = stubDrive({ tripFolder: { id: "folder-trip", name: "202611 福岡" } });

            await uploadOrUpdateCloudTrip("token", "福岡五日", "trip:\n  name: 福岡五日\ndays:\n  - date: '2026-11-03'\n", {
                fileId: "file-existing",
                tripId: "p-fukuoka",
            });

            const req = drive.find(c => c.url.includes("uploadType=multipart"));
            // PATCH the existing id, and no `parents`: sending one would move the file.
            expect(req.method).toBe("PATCH");
            expect(req.url).toContain("/upload/drive/v3/files/file-existing");
            expect(req.body).not.toContain('"parents"');
            // The folder is named once, at creation; a name the user gave it in Drive stays.
            expect(globalThis.fetch).toHaveBeenCalledTimes(1);
        });

        it("puts a new file into the trip's existing folder rather than minting another", async () => {
            const drive = stubDrive({ tripFolder: { id: "folder-trip", name: "202611 福岡" } });

            await uploadOrUpdateCloudTrip("token", "福岡五日", "trip:\n  name: 福岡五日\n", { tripId: "p-fukuoka" });

            expect(drive.find(c => c.url.includes("uploadType=multipart")).body).toContain('"parents":["folder-trip"]');
            expect(() => drive.find(c => c.url.endsWith("/drive/v3/files") && c.method === "POST")).toThrow("no such request");
        });

        it("writes the startDate appProperty the trip list sorts on", async () => {
            const drive = stubDrive();

            const yaml = "days:\n  - date: '2026-10-05'\n  - date: '2026-10-01'\n";
            const result = await uploadOrUpdateCloudTrip("token", "東京", yaml, { tripId: "p-1" });

            // The earliest day, not the first listed one.
            expect(drive.find(c => c.url.includes("uploadType=multipart")).body).toContain('"startDate":"2026-10-01"');
            expect(result.startDate).toBe("2026-10-01");
        });

        it("publishes the content fingerprint alongside the bytes it describes", async () => {
            const drive = stubDrive();

            const yaml = "trip:\n  name: 東京\n";
            const result = await uploadOrUpdateCloudTrip("token", "東京", yaml, { tripId: "p-1" });

            // One request, so a reader can never see the hash without the content it names.
            expect(drive.find(c => c.url.includes("uploadType=multipart")).body).toContain(`"contentHash":"${yamlFingerprint(yaml)}"`);
            expect(result.contentHash).toBe(yamlFingerprint(yaml));
        });

        it("uploads an attachment into the trip's folder as YYMMDD 名稱", async () => {
            const drive = stubDrive({ tripFolder: { id: "folder-trip", name: "202610 義大利" } });
            const content = new Blob(["%PDF-1.7"], { type: "application/pdf" });

            const result = await uploadAttachment("token", { id: "p-it", name: "義大利", start: "2026-10-01" }, {
                date: "2026-10-05",
                sourceName: "e-ticket-8823.pdf",
                content,
                label: "梵蒂岡電子票",
            });

            expect(result).toEqual({ fileId: "file-attached", label: "梵蒂岡電子票", fileName: "261005 梵蒂岡電子票.pdf" });
            const session = drive.find(c => c.url.includes("uploadType=resumable") && c.method === "POST");
            expect(JSON.parse(session.body)).toEqual({ name: "261005 梵蒂岡電子票.pdf", parents: ["folder-trip"] });
            expect(session.headers["X-Upload-Content-Type"]).toBe("application/pdf");
            // The bytes go to the session Drive handed back, not to the endpoint that opened it.
            const put = drive.find(c => c.method === "PUT");
            expect(put.url).toContain("upload_id=session-1");
            expect(put.rawBody).toBe(content);
        });

        it("labels an attachment after its source file when no label is given", async () => {
            stubDrive({ tripFolder: { id: "folder-trip", name: "202610 義大利" } });

            const result = await uploadAttachment("token", { id: "p-it", name: "義大利", start: "2026-10-01" }, {
                date: "2026-10-07",
                sourceName: "IMG_0001.HEIC",
                content: new Blob(["x"]),
            });

            expect(result.label).toBe("IMG_0001");
            expect(result.fileName).toBe("261007 IMG_0001.HEIC");
        });

        it("refuses a YAML attachment, which the trip listing would take for a trip", async () => {
            stubDrive();

            await expect(uploadAttachment("token", { id: "p-it", name: "義大利", start: "2026-10-01" }, {
                date: "2026-10-05",
                sourceName: "notes.yaml",
                content: new Blob(["a: 1"]),
            })).rejects.toThrow("YAML 檔不能當附件");
            expect(globalThis.fetch).not.toHaveBeenCalled();
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

        it("moves a trip file to the trash instead of deleting it", async () => {
            vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200 }));

            await expect(trashDriveFile("token", "file-123")).resolves.toBeUndefined();
            const req = fetchCall(0);
            expect(req.method).toBe("PATCH");
            expect(req.url).toBe("https://www.googleapis.com/drive/v3/files/file-123");
            expect(JSON.parse(req.body)).toEqual({ trashed: true });
        });

        it("counts a file that is already gone as trashed", async () => {
            vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 404 }));

            await expect(trashDriveFile("token", "file-123")).resolves.toBeUndefined();
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
