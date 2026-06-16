import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from "vitest";
import {
    EXCHANGE_CACHE_TTL as CACHE_TTL,
    type ExchangeRates,
    loadExchangeRates,
} from "./exchange";
const NOW = new Date("2026-06-11T08:00:00Z").getTime();
const KEY = "showmeway_exchange_rates_usd";

function createLocalStorageStub() {
    const store = new Map<string, string>();
    return {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => void store.set(key, value),
        removeItem: (key: string) => void store.delete(key),
        clear: () => store.clear(),
    };
}

function ratesOf(twd: number): ExchangeRates {
    return { date: "2026-06-11", usd: { twd } };
}

function cacheMeta(fetchedAt: number) {
    return { fromCache: true, fetchedAt };
}

function networkMeta(fetchedAt: number) {
    return { fromCache: false, fetchedAt };
}

function stubFetchWith(rates: ExchangeRates) {
    const fetchMock = vi.fn(() =>
        Promise.resolve({
            ok: true,
            json: () => Promise.resolve(rates),
        })
    );
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
}

// loadExchangeRates fires fetch without exposing its promise; drain the microtask queue instead.
async function flushAsync() {
    for (let i = 0; i < 10; i++) await Promise.resolve();
}

describe("loadExchangeRates", () => {
    let storage: ReturnType<typeof createLocalStorageStub>;

    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(NOW);
        storage = createLocalStorageStub();
        vi.stubGlobal("localStorage", storage);
        vi.spyOn(console, "warn").mockImplementation(() => {});
        vi.spyOn(console, "error").mockImplementation(() => {});
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it("serves a fresh cache without fetching", async () => {
        storage.setItem(KEY, JSON.stringify({ timestamp: NOW - 1000, rates: ratesOf(31) }));
        const fetchMock = stubFetchWith(ratesOf(99));
        const onUpdate = vi.fn();

        loadExchangeRates("USD", onUpdate);
        await flushAsync();

        expect(onUpdate).toHaveBeenCalledTimes(1);
        expect(onUpdate).toHaveBeenCalledWith(ratesOf(31), cacheMeta(NOW - 1000));
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("serves the stale value first, then the fetched value", async () => {
        storage.setItem(KEY, JSON.stringify({ timestamp: NOW - CACHE_TTL, rates: ratesOf(31) }));
        const fetchMock = stubFetchWith(ratesOf(32));
        const onUpdate = vi.fn();

        loadExchangeRates("USD", onUpdate);
        expect(onUpdate).toHaveBeenCalledTimes(1);
        expect(onUpdate).toHaveBeenNthCalledWith(1, ratesOf(31), cacheMeta(NOW - CACHE_TTL));

        await flushAsync();
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(onUpdate).toHaveBeenCalledTimes(2);
        expect(onUpdate).toHaveBeenNthCalledWith(2, ratesOf(32), networkMeta(NOW));
        expect(JSON.parse(storage.getItem(KEY)!)).toEqual({ timestamp: NOW, rates: ratesOf(32) });
    });

    it("treats corrupted JSON as a miss, clears it, and refetches", async () => {
        storage.setItem(KEY, "{not json");
        const fetchMock = stubFetchWith(ratesOf(32));
        const onUpdate = vi.fn();

        loadExchangeRates("USD", onUpdate);
        expect(storage.getItem(KEY)).toBeNull();

        await flushAsync();
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(onUpdate).toHaveBeenCalledTimes(1);
        expect(onUpdate).toHaveBeenCalledWith(ratesOf(32), networkMeta(NOW));
    });

    it("does not call onUpdate again when the refresh fails", async () => {
        storage.setItem(KEY, JSON.stringify({ timestamp: NOW - CACHE_TTL, rates: ratesOf(31) }));
        const fetchMock = vi.fn(() => Promise.reject(new Error("offline")));
        vi.stubGlobal("fetch", fetchMock);
        const onUpdate = vi.fn();

        loadExchangeRates("USD", onUpdate);
        await flushAsync();

        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(onUpdate).toHaveBeenCalledTimes(1);
        expect(onUpdate).toHaveBeenCalledWith(ratesOf(31), cacheMeta(NOW - CACHE_TTL));
    });

    it("treats a non-numeric timestamp as a miss, clears it, and refetches", async () => {
        storage.setItem(KEY, JSON.stringify({ timestamp: "yesterday", rates: ratesOf(31) }));
        const fetchMock = stubFetchWith(ratesOf(32));
        const onUpdate = vi.fn();

        loadExchangeRates("USD", onUpdate);
        expect(storage.getItem(KEY)).toBeNull();

        await flushAsync();
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(onUpdate).toHaveBeenCalledTimes(1);
        expect(onUpdate).toHaveBeenCalledWith(ratesOf(32), networkMeta(NOW));
    });

    it("treats non-object rates as a miss, clears it, and refetches", async () => {
        storage.setItem(KEY, JSON.stringify({ timestamp: NOW - 1000, rates: "31" }));
        const fetchMock = stubFetchWith(ratesOf(32));
        const onUpdate = vi.fn();

        loadExchangeRates("USD", onUpdate);
        expect(storage.getItem(KEY)).toBeNull();

        await flushAsync();
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(onUpdate).toHaveBeenCalledTimes(1);
        expect(onUpdate).toHaveBeenCalledWith(ratesOf(32), networkMeta(NOW));
    });

    it("treats a future timestamp as stale and refreshes", async () => {
        storage.setItem(KEY, JSON.stringify({ timestamp: NOW + CACHE_TTL, rates: ratesOf(31) }));
        const fetchMock = stubFetchWith(ratesOf(32));
        const onUpdate = vi.fn();

        loadExchangeRates("USD", onUpdate);
        await flushAsync();

        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(onUpdate).toHaveBeenCalledTimes(2);
        expect(onUpdate).toHaveBeenNthCalledWith(1, ratesOf(31), cacheMeta(NOW + CACHE_TTL));
        expect(onUpdate).toHaveBeenNthCalledWith(2, ratesOf(32), networkMeta(NOW));
    });

    it("still delivers the fetched rates when the cache write throws (quota/private mode)", async () => {
        storage.setItem = () => {
            throw new DOMException("QuotaExceededError");
        };
        const fetchMock = stubFetchWith(ratesOf(32));
        const onUpdate = vi.fn();

        loadExchangeRates("USD", onUpdate);
        await flushAsync();

        // The network result must not be discarded just because caching failed.
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(onUpdate).toHaveBeenCalledTimes(1);
        expect(onUpdate).toHaveBeenCalledWith(ratesOf(32), networkMeta(NOW));
    });
});
