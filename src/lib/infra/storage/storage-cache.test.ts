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
    clearStorageCacheMemory,
    isFresh,
    readCachedJson,
    writeCachedJson,
} from "./storage-cache";

interface Entry {
    n: number;
}
function isEntry(value: unknown): value is Entry {
    return typeof value === "object" && value !== null && Number.isFinite((value as Entry).n);
}

describe("isFresh", () => {
    const NOW = 1_000_000;
    const TTL = 1000;

    it("is fresh within the TTL window", () => {
        expect(isFresh(NOW - 1, TTL, NOW)).toBe(true);
        expect(isFresh(NOW, TTL, NOW)).toBe(true);
    });

    it("is stale at and beyond the TTL boundary", () => {
        expect(isFresh(NOW - TTL, TTL, NOW)).toBe(false);
        expect(isFresh(NOW - TTL - 1, TTL, NOW)).toBe(false);
    });

    it("rejects a future timestamp (clock rollback)", () => {
        expect(isFresh(NOW + 1, TTL, NOW)).toBe(false);
    });
});

describe("readCachedJson / writeCachedJson", () => {
    let storage: ReturnType<typeof createLocalStorageStub>;

    beforeEach(() => {
        clearStorageCacheMemory();
        storage = createLocalStorageStub();
        vi.stubGlobal("localStorage", storage);
        vi.spyOn(console, "warn").mockImplementation(() => {});
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it("round-trips a written value", () => {
        writeCachedJson("k", { n: 1 } satisfies Entry);
        expect(readCachedJson("k", isEntry)).toEqual({ n: 1 });
    });

    it("serves the mem-mirror even after localStorage loses the entry", () => {
        writeCachedJson("k", { n: 2 } satisfies Entry);
        storage.clear(); // mirror survives a wiped backing store
        expect(readCachedJson("k", isEntry)).toEqual({ n: 2 });
    });

    it("degrades to per-session caching when the write throws (quota/private mode)", () => {
        storage.setItem = () => {
            throw new DOMException("QuotaExceededError");
        };
        writeCachedJson("k", { n: 3 } satisfies Entry);
        // The value still reads back from the mem-mirror despite the failed write.
        expect(readCachedJson("k", isEntry)).toEqual({ n: 3 });
    });

    it("treats corrupt JSON as a miss and drops it", () => {
        storage.setItem("k", "{not json");
        expect(readCachedJson("k", isEntry)).toBeNull();
        expect(storage.getItem("k")).toBeNull();
    });

    it("treats a shape that fails validation as a miss and drops it", () => {
        storage.setItem("k", JSON.stringify({ n: "nope" }));
        expect(readCachedJson("k", isEntry)).toBeNull();
        expect(storage.getItem("k")).toBeNull();
    });

    it("returns null for an absent key", () => {
        expect(readCachedJson("missing", isEntry)).toBeNull();
    });

    it("degrades to a miss when the read itself throws (blocked site data)", () => {
        // Chrome's "block all cookies" and some embedded webviews throw on every access,
        // reads included. Callers run this from module-scope field initialisers, where a
        // throw takes the import graph — and the whole app — down with it.
        storage.getItem = () => {
            throw new DOMException("SecurityError");
        };
        expect(readCachedJson("k", isEntry)).toBeNull();
    });

    it("survives a removeItem that throws while dropping a corrupt entry", () => {
        storage.setItem("k", "{not json");
        storage.removeItem = () => {
            throw new DOMException("SecurityError");
        };
        expect(readCachedJson("k", isEntry)).toBeNull();
    });
});
