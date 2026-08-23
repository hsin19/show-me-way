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
    clearGdriveUser,
    deleteCloudTrip,
    downloadCloudTripYaml,
    fetchGoogleUserInfo,
    findOrCreateAppFolder,
    GDRIVE_FOLDER_NAME,
    GDRIVE_USER_STORAGE,
    getCachedAccessToken,
    getCloudFileIdForTrip,
    getGdriveClientId,
    listCloudTrips,
    loadGdriveAutoSync,
    loadGdriveUser,
    removeCloudFileIdForTrip,
    saveGdriveAutoSync,
    saveGdriveUser,
    setCachedAccessToken,
    setCloudFileIdForTrip,
    uploadOrUpdateCloudTrip,
} from "./gdrive";

function createLocalStorageStub() {
    const store = new Map<string, string>();
    return {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => void store.set(key, value),
        removeItem: (key: string) => void store.delete(key),
        clear: () => store.clear(),
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

        it("handles tripId to fileId mapping", () => {
            expect(getCloudFileIdForTrip("trip-1")).toBeNull();
            setCloudFileIdForTrip("trip-1", "file-abc");
            expect(getCloudFileIdForTrip("trip-1")).toBe("file-abc");
            removeCloudFileIdForTrip("trip-1");
            expect(getCloudFileIdForTrip("trip-1")).toBeNull();
        });

        it("handles in-memory token cache and expiry", () => {
            expect(getCachedAccessToken()).toBeNull();
            setCachedAccessToken("token-xyz", 3600);
            expect(getCachedAccessToken()).toBe("token-xyz");
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
                { id: "f1", name: "東京五日.yaml", modifiedTime: "2026-08-23T10:00:00Z", size: "1234", appProperties: { showmewayTripId: "p1" } },
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
                { id: "f1", name: "東京五日", modifiedTime: "2026-08-23T10:00:00Z", size: 1234, tripId: "p1" },
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

            expect(result.id).toBe("file-new");
            expect(result.name).toBe("福岡四日");
            expect(getCloudFileIdForTrip("p-fukuoka")).toBe("file-new");
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

            expect(result.id).toBe("file-existing");
            expect(result.name).toBe("福岡五日");
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
    });
});
