// Daily weather via Open-Meteo (https://open-meteo.com, key-less, CC BY 4.0 —
// the UI must show an attribution link wherever forecasts are displayed).
// Mirrors the exchange-rate pattern in `lib/exchange.ts`: localStorage cache,
// serve stale data first, refresh in the background, never surface errors.

export interface DailyWeather {
    /** WMO weather interpretation code — see `weatherCodeInfo`. */
    code: number;
    tempMax: number;
    tempMin: number;
    /** Daily max precipitation probability in %, null when the model omits it. */
    precipProb: number | null;
}

/** Forecast keyed by local date (YYYY-MM-DD, aggregated in the city's timezone). */
export type DailyWeatherByDate = Record<string, DailyWeather>;

const GEOCODE_CACHE_KEY = "showmeway_geocode_v1";
const FORECAST_CACHE_KEY = "showmeway_weather";
// Source models refresh every ~3-6 hours, so refetching sooner buys nothing.
const FORECAST_TTL = 1000 * 60 * 60 * 3;
const GEOCODE_TTL = 1000 * 60 * 60 * 24 * 30;
const GEOCODE_MISS_TTL = FORECAST_TTL;

// Zero-result lookups live in memory only: module state outlasts
// visibilitychange retries, while a full reload retries once per app load.
const GEOCODE_MISSES = new Map<string, number>();
const inFlightForecasts = new Map<string, Promise<DailyWeatherByDate | null>>();
// Mirror of localStorage so a failed write (quota, private mode) degrades to
// per-session caching instead of refetching on every foreground return.
const memCache = new Map<string, unknown>();

export function resetWeatherCacheForTests(): void {
    GEOCODE_MISSES.clear();
    inFlightForecasts.clear();
    memCache.clear();
}

interface GeoPoint {
    lat: number;
    lon: number;
}

interface GeocodeCacheEntry extends GeoPoint {
    name: string;
    country_code: string;
    cachedAt: number;
}

interface ForecastCacheEntry {
    timestamp: number;
    byDate: DailyWeatherByDate;
}

function cityKey(city: string): string {
    return city.trim().toLowerCase();
}

function isValidGeocodeEntry(value: unknown): value is GeocodeCacheEntry {
    if (typeof value !== "object" || value === null) return false;
    const entry = value as Partial<GeocodeCacheEntry>;
    return Number.isFinite(entry.lat)
        && Number.isFinite(entry.lon)
        && typeof entry.name === "string"
        && typeof entry.country_code === "string"
        && Number.isFinite(entry.cachedAt);
}

function isValidForecastCacheEntry(value: unknown): value is ForecastCacheEntry {
    if (typeof value !== "object" || value === null) return false;
    const entry = value as Partial<ForecastCacheEntry>;
    return Number.isFinite(entry.timestamp)
        && typeof entry.byDate === "object"
        && entry.byDate !== null
        && !Array.isArray(entry.byDate);
}

function readJson<T>(key: string, isValid: (value: unknown) => value is T): T | null {
    if (memCache.has(key)) {
        const mirrored = memCache.get(key);
        if (isValid(mirrored)) return mirrored;
        memCache.delete(key);
    }
    const cached = localStorage.getItem(key);
    if (!cached) return null;
    try {
        const parsed: unknown = JSON.parse(cached);
        if (isValid(parsed)) {
            memCache.set(key, parsed);
            return parsed;
        }
    } catch (e) {
        console.warn("Failed to parse cached weather data", e);
    }
    // A successful fetch is the only other write path, so drop bad entries here
    // or they would shadow the cache forever.
    localStorage.removeItem(key);
    return null;
}

function writeJson(key: string, value: unknown): void {
    memCache.set(key, value);
    try {
        localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
        console.warn("Failed to cache weather data", e);
    }
}

// A ", XX" ISO country suffix ("Springfield, US") disambiguates common names
// via the API's countryCode filter — exact-match heuristics proved unreliable.
function parseCityQuery(city: string): { name: string; countryCode: string | null; } {
    const match = city.trim().match(/^(.*\S)\s*,\s*([A-Za-z]{2})$/);
    if (match) return { name: match[1], countryCode: match[2].toUpperCase() };
    return { name: city.trim(), countryCode: null };
}

/**
 * Resolve a city name to coordinates via the Open-Meteo geocoding API.
 * Hits are cached for 30 days; zero-result lookups are remembered in memory
 * for 3 hours, so a typo costs one request per app load plus one per cooldown
 * window. Network errors are never cached.
 */
async function geocodeCity(city: string): Promise<GeoPoint | null> {
    const key = `${GEOCODE_CACHE_KEY}_${cityKey(city)}`;
    // Pre-v1 entries ({lat, lon}, no TTL) are unreadable now — clear, don't migrate.
    localStorage.removeItem(`showmeway_geocode_${cityKey(city)}`);
    const cached = readJson(key, isValidGeocodeEntry);
    const now = Date.now();
    // A future cachedAt (clock rollback) would otherwise never expire by TTL.
    if (cached && cached.cachedAt <= now && now - cached.cachedAt < GEOCODE_TTL) {
        console.info(`Weather location for "${city}": ${cached.name}, ${cached.country_code}`);
        return { lat: cached.lat, lon: cached.lon };
    }

    const missedAt = GEOCODE_MISSES.get(cityKey(city));
    if (missedAt !== undefined && now - missedAt < GEOCODE_MISS_TTL) return null;

    try {
        const { name, countryCode } = parseCityQuery(city);
        // language=zh lets CJK names like 東京/京都 match (zero results without it).
        const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(name)}&count=1&language=zh`
            + (countryCode ? `&countryCode=${countryCode}` : "");
        const res = await fetch(url);
        if (!res.ok) {
            throw new Error(`Failed to geocode city: ${res.status} ${res.statusText}`);
        }
        const data = await res.json() as {
            results?: { latitude: number; longitude: number; name?: string; country_code?: string; }[];
        };
        const top = data.results?.[0];
        if (!top) {
            GEOCODE_MISSES.set(cityKey(city), Date.now());
            return null;
        }
        GEOCODE_MISSES.delete(cityKey(city));
        const entry: GeocodeCacheEntry = {
            lat: top.latitude,
            lon: top.longitude,
            name: top.name ?? name,
            country_code: top.country_code ?? "",
            cachedAt: Date.now(),
        };
        writeJson(key, entry);
        console.info(`Weather location for "${city}": ${entry.name}, ${entry.country_code}`);
        return { lat: entry.lat, lon: entry.lon };
    } catch (error) {
        console.error("Error geocoding city:", error);
        return null;
    }
}

interface ForecastResponse {
    daily?: {
        time: string[];
        weather_code?: (number | null)[];
        temperature_2m_max?: (number | null)[];
        temperature_2m_min?: (number | null)[];
        precipitation_probability_max?: (number | null)[];
    };
}

async function fetchForecast(city: string): Promise<DailyWeatherByDate | null> {
    const point = await geocodeCity(city);
    if (!point) return null;

    try {
        // timezone=auto aggregates each day in the city's local time, matching
        // how this app treats YYYY-MM-DD dates. 16 days is the API maximum;
        // trip dates beyond that horizon simply get no entry. past_days keeps
        // badges on the last two days after a mid-trip date rollover.
        const url = `https://api.open-meteo.com/v1/forecast?latitude=${point.lat}&longitude=${point.lon}`
            + "&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max"
            + "&timezone=auto&forecast_days=16&past_days=2";
        const res = await fetch(url);
        if (!res.ok) {
            throw new Error(`Failed to fetch forecast: ${res.status} ${res.statusText}`);
        }
        const data = await res.json() as ForecastResponse;
        const daily = data.daily;
        if (!daily) return null;

        const byDate: DailyWeatherByDate = {};
        daily.time.forEach((date, i) => {
            const code = daily.weather_code?.[i];
            const tempMax = daily.temperature_2m_max?.[i];
            const tempMin = daily.temperature_2m_min?.[i];
            if (code == null || tempMax == null || tempMin == null) return;
            byDate[date] = {
                code,
                tempMax,
                tempMin,
                precipProb: daily.precipitation_probability_max?.[i] ?? null,
            };
        });

        // An all-null payload (model gap/outage) is a failure, not fresh data —
        // don't clobber the offline-fallback cache or the displayed forecast.
        if (Object.keys(byDate).length === 0) return null;

        writeJson(
            `${FORECAST_CACHE_KEY}_${cityKey(city)}`,
            { timestamp: Date.now(), byDate } satisfies ForecastCacheEntry,
        );
        return byDate;
    } catch (error) {
        console.error("Error fetching weather forecast:", error);
        return null;
    }
}

/**
 * Load the daily forecast for a city. Cached data (even expired — the offline
 * fallback while traveling) is delivered synchronously; a background refresh
 * follows when stale, so `onUpdate` may fire 0, 1, or 2 times. `fetchedAt`
 * tells the caller how old the data is (cache timestamp vs. refresh time).
 */
export function loadDailyWeather(
    city: string,
    onUpdate: (byDate: DailyWeatherByDate, fetchedAt: number) => void,
): void {
    const key = cityKey(city);
    const cached = readJson(`${FORECAST_CACHE_KEY}_${key}`, isValidForecastCacheEntry);
    if (cached) onUpdate(cached.byDate, cached.timestamp);

    // A future timestamp (left behind by a clock rollback) would never expire by TTL.
    const now = Date.now();
    const stale = !cached || cached.timestamp > now || now - cached.timestamp >= FORECAST_TTL;
    if (!stale) return;

    // Overlapping stale loads (visibilitychange bursts) share one request.
    let pending = inFlightForecasts.get(key);
    if (!pending) {
        // fetchForecast catches internally and never rejects.
        pending = fetchForecast(city).finally(() => inFlightForecasts.delete(key));
        inFlightForecasts.set(key, pending);
    }
    void pending.then(byDate => {
        if (byDate) onUpdate(byDate, Date.now());
    });
}

export type WeatherIconKind =
    | "sun"
    | "cloud-sun"
    | "cloud"
    | "fog"
    | "drizzle"
    | "rain"
    | "snow"
    | "thunder";

export interface WeatherCodeInfo {
    icon: WeatherIconKind;
    label: string;
}

// WMO weather interpretation codes (the API returns only the number; the
// icon/label mapping is ours). Full table: https://open-meteo.com/en/docs
const WEATHER_CODES: Record<number, WeatherCodeInfo> = {
    0: { icon: "sun", label: "晴朗" },
    1: { icon: "sun", label: "大致晴朗" },
    2: { icon: "cloud-sun", label: "多雲時晴" },
    3: { icon: "cloud", label: "陰天" },
    45: { icon: "fog", label: "有霧" },
    48: { icon: "fog", label: "凍霧" },
    51: { icon: "drizzle", label: "毛毛雨" },
    53: { icon: "drizzle", label: "毛毛雨" },
    55: { icon: "drizzle", label: "毛毛雨" },
    56: { icon: "drizzle", label: "凍雨" },
    57: { icon: "drizzle", label: "凍雨" },
    61: { icon: "rain", label: "小雨" },
    63: { icon: "rain", label: "中雨" },
    65: { icon: "rain", label: "大雨" },
    66: { icon: "rain", label: "凍雨" },
    67: { icon: "rain", label: "凍雨" },
    71: { icon: "snow", label: "小雪" },
    73: { icon: "snow", label: "中雪" },
    75: { icon: "snow", label: "大雪" },
    77: { icon: "snow", label: "霰" },
    80: { icon: "rain", label: "陣雨" },
    81: { icon: "rain", label: "陣雨" },
    82: { icon: "rain", label: "強陣雨" },
    85: { icon: "snow", label: "陣雪" },
    86: { icon: "snow", label: "陣雪" },
    95: { icon: "thunder", label: "雷雨" },
    96: { icon: "thunder", label: "雷雨夾冰雹" },
    99: { icon: "thunder", label: "雷雨夾冰雹" },
};

export function weatherCodeInfo(code: number): WeatherCodeInfo {
    return WEATHER_CODES[code] ?? { icon: "cloud", label: "多雲" };
}
