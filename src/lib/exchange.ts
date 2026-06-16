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
    const key = cacheKeyFor(baseCurrency);
    const cached = localStorage.getItem(key);
    if (!cached) return null;
    try {
        const parsed: unknown = JSON.parse(cached);
        if (isValidCacheEntry(parsed)) return parsed;
    } catch (e) {
        console.warn("Failed to parse cached exchange rates", e);
    }
    // A successful fetch is the only other write path, so drop bad entries here
    // or they would shadow the cache forever.
    localStorage.removeItem(key);
    return null;
}

// A failed cache write (quota, private mode) must not discard the fetched data —
// mirrors weather.ts writeJson. Kept separate from the fetch try so a storage
// error can't masquerade as a network failure and drop a successful result.
function writeCache(baseCurrency: string, rates: ExchangeRates): void {
    try {
        localStorage.setItem(
            cacheKeyFor(baseCurrency),
            JSON.stringify({ timestamp: Date.now(), rates } satisfies CacheEntry),
        );
    } catch (e) {
        console.warn("Failed to cache exchange rates", e);
    }
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

    // A future timestamp (left behind by a clock rollback) would never expire by TTL.
    const now = Date.now();
    const stale = !cached || cached.timestamp > now || now - cached.timestamp >= EXCHANGE_CACHE_TTL;
    if (!stale) return;

    void fetchFromNetwork(baseCurrency).then(rates => {
        if (rates) onUpdate(rates, { fromCache: false, fetchedAt: Date.now() });
    });
}
