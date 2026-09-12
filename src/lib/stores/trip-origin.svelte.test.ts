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

        store.markShared("p1");

        expect(store.isShared("p1")).toBe(true);
        expect(Object.keys(JSON.parse(localStorage.getItem(TRIP_ORIGINS_KEY)!) as object)).toEqual(["p1"]);
        expect((await freshStore()).isShared("p1")).toBe(true);
    });

    it("forgets a slot and drops the key once nothing is marked", async () => {
        const store = await freshStore();
        store.markShared("p1");
        store.markShared("p2");

        store.forget("p1");
        expect(store.isShared("p1")).toBe(false);
        expect(store.isShared("p2")).toBe(true);

        store.forget("p2");
        expect(localStorage.getItem(TRIP_ORIGINS_KEY)).toBeNull();
    });

    it("survives unreadable storage and drops malformed entries rather than the map", async () => {
        localStorage.setItem(TRIP_ORIGINS_KEY, JSON.stringify({ p1: "2026-01-01T00:00:00.000Z", p2: 7 }));
        const store = await freshStore();

        expect(store.isShared("p1")).toBe(true);
        expect(store.isShared("p2")).toBe(false);

        localStorage.setItem(TRIP_ORIGINS_KEY, "not json");
        expect((await freshStore()).isShared("p1")).toBe(false);
    });

    it("keeps the mark in memory when the write is refused", async () => {
        const store = await freshStore();
        vi.spyOn(console, "error").mockImplementation(() => {});
        vi.spyOn(localStorage, "setItem").mockImplementation(() => {
            throw new DOMException("quota", "QuotaExceededError");
        });

        store.markShared("p1");

        expect(store.isShared("p1")).toBe(true);
    });
});
