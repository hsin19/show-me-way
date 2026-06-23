import {
    isFresh,
    readCachedJson,
    writeCachedJson,
} from "./storage-cache";

export { clearStorageCacheMemory as resetExchangeCacheForTests } from "./storage-cache";

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

interface CacheEntry {
    timestamp: number;
    rates: ExchangeRates;
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

export function loadExchangeRates(
    baseCurrency: string,
    onUpdate: (rates: ExchangeRates, meta: ExchangeRatesMeta) => void,
): void {
    const cached = readCache(baseCurrency);
    if (cached) onUpdate(cached.rates, { fromCache: true, fetchedAt: cached.timestamp });

    const stale = !cached || !isFresh(cached.timestamp, EXCHANGE_CACHE_TTL, Date.now());
    if (!stale) return;

    void fetchFromNetwork(baseCurrency).then(rates => {
        if (rates) onUpdate(rates, { fromCache: false, fetchedAt: Date.now() });
    });
}
