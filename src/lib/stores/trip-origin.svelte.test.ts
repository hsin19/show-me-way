import { yamlFingerprint } from "$lib/domain/utils";
import { createLocalStorageStub } from "$lib/testing/stubs";
import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from "vitest";
import { TRIP_ORIGINS_KEY } from "./trip-origin.svelte";

// The store reads storage when its module is evaluated, so each test rebuilds the module
// graph and imports a fresh instance — the pattern share-link.svelte.test.ts uses.
async function freshStore() {
    vi.resetModules();
    return (await import("./trip-origin.svelte")).tripOrigins;
}

const LINK = { id: "abc123", key: "k-abc" };
const YAML = "trip:\n  name: 東京\n";

describe("tripOrigins", () => {
    beforeEach(() => {
        vi.stubGlobal("localStorage", createLocalStorageStub());
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it("marks a slot, persists it, and reports it after a reload", async () => {
        const store = await freshStore();
        expect(store.isShared("p1")).toBe(false);

        store.markShared("p1", LINK, YAML);

        expect(store.isShared("p1")).toBe(true);
        expect(store.linkFor("p1")).toEqual(LINK);
        expect(store.takenHash("p1")).toBe(yamlFingerprint(YAML));
        expect(Object.keys(JSON.parse(localStorage.getItem(TRIP_ORIGINS_KEY)!) as object)).toEqual(["p1"]);

        // The link and the version taken both have to survive a reload, or the next
        // background check either cannot ask or cannot tell what moved.
        const reloaded = await freshStore();
        expect(reloaded.linkFor("p1")).toEqual(LINK);
        expect(reloaded.takenHash("p1")).toBe(yamlFingerprint(YAML));
    });

    it("marks an inline link as received but keeps nothing to re-read it with", async () => {
        const store = await freshStore();

        store.markShared("p1", null, YAML);

        expect(store.isShared("p1")).toBe(true);
        // No server holds an inline `#s=` payload, so there is no later version to fetch.
        expect(store.linkFor("p1")).toBeNull();
    });

    it("records the version taken, including the one that was declined", async () => {
        const store = await freshStore();
        store.markShared("p1", LINK, YAML);

        store.recordTaken("p1", "trip:\n  name: 大阪\n");

        expect(store.takenHash("p1")).toBe(yamlFingerprint("trip:\n  name: 大阪\n"));
        // Nothing to record against for a slot that never came from a link.
        store.recordTaken("p2", YAML);
        expect(store.isShared("p2")).toBe(false);
    });

    it("forgets a slot and drops the key once nothing is marked", async () => {
        const store = await freshStore();
        store.markShared("p1", LINK, YAML);
        store.markShared("p2", LINK, YAML);

        store.forget("p1");
        expect(store.isShared("p1")).toBe(false);
        expect(store.isShared("p2")).toBe(true);

        store.forget("p2");
        expect(localStorage.getItem(TRIP_ORIGINS_KEY)).toBeNull();
    });

    it("survives unreadable storage and drops malformed entries rather than the map", async () => {
        localStorage.setItem(
            TRIP_ORIGINS_KEY,
            JSON.stringify({ p1: { receivedAt: "2026-01-01T00:00:00.000Z" }, p2: 7, p3: { id: "x" } }),
        );
        const store = await freshStore();

        expect(store.isShared("p1")).toBe(true);
        // A record with no `receivedAt` is not one this store wrote.
        expect(store.isShared("p2")).toBe(false);
        expect(store.isShared("p3")).toBe(false);
        // Marked but not watchable: an older mark that predates the stored link.
        expect(store.linkFor("p1")).toBeNull();

        localStorage.setItem(TRIP_ORIGINS_KEY, "not json");
        expect((await freshStore()).isShared("p1")).toBe(false);
    });

    it("keeps the mark in memory when the write is refused", async () => {
        const store = await freshStore();
        vi.spyOn(console, "error").mockImplementation(() => {});
        vi.spyOn(localStorage, "setItem").mockImplementation(() => {
            throw new DOMException("quota", "QuotaExceededError");
        });

        store.markShared("p1", LINK, YAML);

        expect(store.isShared("p1")).toBe(true);
    });
});
