import {
    cachedKeysWithPrefix,
    clearStorageCacheMemory,
    isFresh,
    readCachedJson,
    removeCachedKeys,
    writeCachedJson,
} from "./storage-cache";

export interface ExchangeRates {
    date: string;
    [baseCurrency: string]: Record<string, number> | string | undefined;
}

export interface ExchangeRatesMeta {
    fromCache: boolean;
    fetchedAt: number;
}

const CACHE_KEY = "showmeway_exchange_rates";
export const EXCHANGE_CACHE_TTL = 1000 * 60 * 60 * 12; // 12 hours

/** The keys this cache occupies right now, so App 設定 can size it without knowing their shape. */
export function exchangeCacheKeys(): string[] {
    return cachedKeysWithPrefix(`${CACHE_KEY}_`);
}

/**
 * Drop every cached rate table; returns how many keys went. Safe at any time —
 * the next load refetches — and it leaves the user's manual rate alone, which is
 * Ledger's key, not this cache's.
 */
export function clearExchangeCache(): number {
    const keys = exchangeCacheKeys();
    removeCachedKeys(keys);
    return keys.length;
}

interface CacheEntry {
    timestamp: number;
    rates: ExchangeRates;
}

// Overlapping stale loads (visibilitychange bursts) share one request — same shape as weather.ts.
const inFlightRates = new Map<string, Promise<ExchangeRates | null>>();

export function resetExchangeCacheForTests(): void {
    inFlightRates.clear();
    clearStorageCacheMemory();
}

function cacheKeyFor(baseCurrency: string): string {
    return `${CACHE_KEY}_${baseCurrency.toLowerCase()}`;
}

function isValidCacheEntry(value: unknown): value is CacheEntry {
    if (typeof value !== "object" || value === null) return false;
    const entry = value as Partial<CacheEntry>;
    return Number.isFinite(entry.timestamp)
        && typeof entry.rates === "object"
        && entry.rates !== null
        && !Array.isArray(entry.rates);
}

function readCache(baseCurrency: string): CacheEntry | null {
    return readCachedJson(cacheKeyFor(baseCurrency), isValidCacheEntry);
}

function writeCache(baseCurrency: string, rates: ExchangeRates): void {
    writeCachedJson(cacheKeyFor(baseCurrency), { timestamp: Date.now(), rates } satisfies CacheEntry);
}

async function fetchFromNetwork(baseCurrency: string): Promise<ExchangeRates | null> {
    try {
        const url = `https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/${baseCurrency.toLowerCase()}.json`;
        const res = await fetch(url);
        if (!res.ok) {
            throw new Error(`Failed to fetch exchange rates: ${res.status} ${res.statusText}`);
        }
        const payload: unknown = await res.json();
        if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
            throw new Error("Unexpected exchange rates payload");
        }
        const data = payload as ExchangeRates;
        writeCache(baseCurrency, data);
        return data;
    } catch (error) {
        console.error("Error fetching exchange rates:", error);
        return null;
    }
}

/**
 * Whether a rate handed to `onUpdate` is stale enough to flag in the UI. Twice
 * the TTL, not the TTL itself: a routine stale replay while a background
 * refresh is in flight (anything under 2x) would otherwise flash the badge.
 */
export function isExchangeRateStale(meta: ExchangeRatesMeta): boolean {
    return meta.fromCache && !isFresh(meta.fetchedAt, EXCHANGE_CACHE_TTL * 2, Date.now());
}

export function loadExchangeRates(
    baseCurrency: string,
    onUpdate: (rates: ExchangeRates, meta: ExchangeRatesMeta) => void,
): void {
    const cached = readCache(baseCurrency);
    if (cached) onUpdate(cached.rates, { fromCache: true, fetchedAt: cached.timestamp });

    const stale = !cached || !isFresh(cached.timestamp, EXCHANGE_CACHE_TTL, Date.now());
    if (!stale) return;

    const key = baseCurrency.toLowerCase();
    let pending = inFlightRates.get(key);
    if (!pending) {
        pending = fetchFromNetwork(baseCurrency).finally(() => inFlightRates.delete(key));
        inFlightRates.set(key, pending);
    }
    void pending.then(rates => {
        if (rates) onUpdate(rates, { fromCache: false, fetchedAt: Date.now() });
    });
}
