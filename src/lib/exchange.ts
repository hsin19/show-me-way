export interface ExchangeRates {
    date: string;
    [baseCurrency: string]: Record<string, number> | string | undefined;
}

const CACHE_KEY = "showmeway_exchange_rates";
const CACHE_TTL = 1000 * 60 * 60 * 12; // 12 hours

interface CacheEntry {
    timestamp: number;
    rates: ExchangeRates;
}

function cacheKeyFor(baseCurrency: string): string {
    return `${CACHE_KEY}_${baseCurrency.toLowerCase()}`;
}

function readCache(baseCurrency: string): CacheEntry | null {
    const cached = localStorage.getItem(cacheKeyFor(baseCurrency));
    if (!cached) return null;
    try {
        return JSON.parse(cached) as CacheEntry;
    } catch (e) {
        console.warn("Failed to parse cached exchange rates", e);
        return null;
    }
}

async function fetchFromNetwork(baseCurrency: string): Promise<ExchangeRates | null> {
    try {
        const url = `https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/${baseCurrency.toLowerCase()}.json`;
        const res = await fetch(url);
        if (!res.ok) {
            throw new Error(`Failed to fetch exchange rates: ${res.status} ${res.statusText}`);
        }
        const data: ExchangeRates = await res.json();
        localStorage.setItem(
            cacheKeyFor(baseCurrency),
            JSON.stringify({ timestamp: Date.now(), rates: data } satisfies CacheEntry),
        );
        return data;
    } catch (error) {
        console.error("Error fetching exchange rates:", error);
        return null;
    }
}

export function loadExchangeRates(
    baseCurrency: string,
    onUpdate: (rates: ExchangeRates) => void,
): void {
    const cached = readCache(baseCurrency);
    if (cached) onUpdate(cached.rates);

    const stale = !cached || Date.now() - cached.timestamp >= CACHE_TTL;
    if (!stale) return;

    void fetchFromNetwork(baseCurrency).then(rates => {
        if (rates) onUpdate(rates);
    });
}
