// The refcount and sentinel are module-level and deliberately never reset, so
// each test rebuilds the module graph via `vi.resetModules()` + a fresh import —
// same pattern as pwa-install.svelte.test.ts.
import {
    afterEach,
    describe,
    expect,
    it,
    vi,
} from "vitest";

function createSentinel() {
    const sentinel = {
        released: false,
        release: vi.fn(() => {
            sentinel.released = true;
            return Promise.resolve();
        }),
    };
    return sentinel;
}

function createDocumentStub() {
    const listeners = new Set<() => void>();
    return {
        visibilityState: "visible" as DocumentVisibilityState,
        addEventListener: vi.fn((type: string, fn: () => void) => {
            if (type === "visibilitychange") listeners.add(fn);
        }),
        removeEventListener: vi.fn((type: string, fn: () => void) => {
            listeners.delete(fn);
        }),
        fireVisibilityChange() {
            for (const fn of [...listeners]) fn();
        },
        get listenerCount() {
            return listeners.size;
        },
    };
}

// A macrotask, not `await Promise.resolve()`: the request path chains several
// microtasks (await + finally), and counting them here would couple the test to
// the implementation's exact await depth.
function settle(): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, 0));
}

async function setup(options: { supported?: boolean; } = {}) {
    const doc = createDocumentStub();
    vi.stubGlobal("document", doc);
    const sentinels: ReturnType<typeof createSentinel>[] = [];
    const request = vi.fn(() => {
        const sentinel = createSentinel();
        sentinels.push(sentinel);
        return Promise.resolve(sentinel);
    });
    vi.stubGlobal("navigator", options.supported === false ? {} : { wakeLock: { request } });
    vi.resetModules();
    const mod = await import("./wakelock");
    return { doc, request, sentinels, ...mod };
}

afterEach(() => {
    vi.unstubAllGlobals();
});

describe("acquireScreenWakeLock", () => {
    it("no-ops where the Wake Lock API is missing", async () => {
        const { doc, acquireScreenWakeLock } = await setup({ supported: false });
        const release = acquireScreenWakeLock();
        await settle();
        release();
        expect(doc.addEventListener).not.toHaveBeenCalled();
    });

    it("requests a screen lock for the first holder and listens for visibilitychange", async () => {
        const { doc, request, acquireScreenWakeLock } = await setup();
        acquireScreenWakeLock();
        await settle();
        expect(request).toHaveBeenCalledExactlyOnceWith("screen");
        expect(doc.listenerCount).toBe(1);
    });

    it("shares one lock across overlapping holders and releases with the last", async () => {
        const { doc, request, sentinels, acquireScreenWakeLock } = await setup();
        const releaseFirst = acquireScreenWakeLock();
        await settle();
        const releaseSecond = acquireScreenWakeLock();
        await settle();
        expect(request).toHaveBeenCalledTimes(1);

        releaseFirst();
        expect(sentinels[0].release).not.toHaveBeenCalled();
        expect(doc.listenerCount).toBe(1);

        releaseSecond();
        await settle();
        expect(sentinels[0].release).toHaveBeenCalledTimes(1);
        expect(doc.listenerCount).toBe(0);
    });

    it("ignores a second call of the same release", async () => {
        const { sentinels, acquireScreenWakeLock } = await setup();
        const releaseFirst = acquireScreenWakeLock();
        acquireScreenWakeLock();
        await settle();

        releaseFirst();
        releaseFirst();
        expect(sentinels[0].release).not.toHaveBeenCalled();
    });

    it("re-requests on visibilitychange after the browser dropped the lock", async () => {
        const { doc, request, sentinels, acquireScreenWakeLock } = await setup();
        acquireScreenWakeLock();
        await settle();

        // The browser releases the sentinel itself when the page is hidden.
        sentinels[0].released = true;
        doc.fireVisibilityChange();
        await settle();
        expect(request).toHaveBeenCalledTimes(2);
    });

    it("does not re-request while the lock is still held", async () => {
        const { doc, request, acquireScreenWakeLock } = await setup();
        acquireScreenWakeLock();
        await settle();

        doc.fireVisibilityChange();
        await settle();
        expect(request).toHaveBeenCalledTimes(1);
    });

    it("does not request while the page is hidden", async () => {
        const { doc, request, sentinels, acquireScreenWakeLock } = await setup();
        acquireScreenWakeLock();
        await settle();

        sentinels[0].released = true;
        doc.visibilityState = "hidden";
        doc.fireVisibilityChange();
        await settle();
        expect(request).toHaveBeenCalledTimes(1);
    });

    it("degrades silently on a denied request and retries on the next visibilitychange", async () => {
        const { doc, request, sentinels, acquireScreenWakeLock } = await setup();
        request.mockImplementationOnce(() => Promise.reject(new Error("denied")));
        const release = acquireScreenWakeLock();
        await settle();
        expect(sentinels).toHaveLength(0);

        doc.fireVisibilityChange();
        await settle();
        expect(request).toHaveBeenCalledTimes(2);

        release();
        await settle();
        expect(sentinels[0].release).toHaveBeenCalledTimes(1);
    });

    it("releases a lock that resolved after the last holder already left", async () => {
        const { request, acquireScreenWakeLock } = await setup();
        const sentinel = createSentinel();
        let grant!: () => void;
        request.mockImplementationOnce(() => new Promise(resolve => (grant = () => resolve(sentinel))));

        const release = acquireScreenWakeLock();
        release();
        grant();
        await settle();
        expect(sentinel.release).toHaveBeenCalledTimes(1);
    });
});
