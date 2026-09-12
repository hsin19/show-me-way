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
    decodeShareLinkProperties,
    encodeShareLinkProperties,
    loadShareLinkMap,
    saveShareLinkMap,
    SHARE_LINK_PROPERTY,
    SHARE_LINKS_KEY,
    type ShareLinkRecord,
} from "./share-links";

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

describe("share-link Drive properties", () => {
    it("round-trips a record through the property pair", () => {
        const record: ShareLinkRecord = { ...RECORD, expiresAt: "2027-09-04T00:00:00.000Z" };
        const encoded = encodeShareLinkProperties(record)!;

        expect(encoded.shareLink).toBe(`${record.id}.${record.key}.${record.editToken}`);
        expect(decodeShareLinkProperties(encoded.shareLink, encoded.shareLinkAt)).toEqual(record);
    });

    it("keeps each property inside Drive's 124-byte cap, and refuses a record that cannot", () => {
        const encoded = encodeShareLinkProperties({ ...RECORD, editToken: "t".repeat(64) })!;
        expect(new TextEncoder().encode(SHARE_LINK_PROPERTY + encoded.shareLink).length).toBeLessThanOrEqual(124);

        expect(encodeShareLinkProperties({ ...RECORD, editToken: "t".repeat(200) })).toBeNull();
        // A dot is the separator, so a secret carrying one could not be read back.
        expect(encodeShareLinkProperties({ ...RECORD, editToken: "to.ken" })).toBeNull();
    });

    it("refuses a half-written pair but still yields a link when only the times are missing", () => {
        expect(decodeShareLinkProperties(undefined, undefined)).toBeNull();
        expect(decodeShareLinkProperties("abcd1234.key", "")).toBeNull();

        const decoded = decodeShareLinkProperties("abcd1234.key.tok", undefined)!;
        expect(decoded.id).toBe("abcd1234");
        expect(decoded.editToken).toBe("tok");
        expect(decoded.expiresAt).toBeNull();
        expect(Date.parse(decoded.createdAt)).not.toBeNaN();
    });
});
