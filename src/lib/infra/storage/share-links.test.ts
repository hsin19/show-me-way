import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from "vitest";
import {
    loadShareLinkMap,
    saveShareLinkMap,
    SHARE_LINKS_KEY,
    type ShareLinkRecord,
} from "./share-links";

function createLocalStorageStub() {
    const store = new Map<string, string>();
    return {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => void store.set(key, value),
        removeItem: (key: string) => void store.delete(key),
    };
}

const RECORD: ShareLinkRecord = {
    id: "abcd1234",
    key: "A".repeat(22),
    editToken: "tok",
    createdAt: "2026-09-04T00:00:00.000Z",
    updatedAt: "2026-09-04T00:00:00.000Z",
    expiresAt: null,
};

describe("share-links storage", () => {
    beforeEach(() => {
        vi.stubGlobal("localStorage", createLocalStorageStub());
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it("round-trips a map under the app-prefixed key", () => {
        saveShareLinkMap({ "p-1": RECORD });
        expect(SHARE_LINKS_KEY.startsWith("showmeway_")).toBe(true);
        expect(loadShareLinkMap()).toEqual({ "p-1": RECORD });
    });

    it("removes the key rather than storing an empty map", () => {
        saveShareLinkMap({ "p-1": RECORD });
        saveShareLinkMap({});
        expect(localStorage.getItem(SHARE_LINKS_KEY)).toBeNull();
    });

    // A record missing its token or key can only mislead the next publish into a PUT
    // that 401s, or into a link nobody can open.
    it("drops a malformed entry but keeps the rest", () => {
        localStorage.setItem(SHARE_LINKS_KEY, JSON.stringify({ "p-1": RECORD, "p-2": { id: "x" }, "p-3": "nope" }));
        expect(loadShareLinkMap()).toEqual({ "p-1": RECORD });
    });

    it("yields an empty map for garbage, an array, or blocked storage", () => {
        localStorage.setItem(SHARE_LINKS_KEY, "{not json");
        expect(loadShareLinkMap()).toEqual({});
        localStorage.setItem(SHARE_LINKS_KEY, "[]");
        expect(loadShareLinkMap()).toEqual({});
        vi.stubGlobal("localStorage", {
            getItem: () => {
                throw new Error("blocked");
            },
        });
        expect(loadShareLinkMap()).toEqual({});
    });
});
