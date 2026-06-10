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

const GEOCODE_CACHE_KEY = "showmeway_geocode";
const FORECAST_CACHE_KEY = "showmeway_weather";
// Source models refresh every ~3-6 hours, so refetching sooner buys nothing.
const FORECAST_TTL = 1000 * 60 * 60 * 3;

interface GeoPoint {
    lat: number;
    lon: number;
}

interface ForecastCacheEntry {
    timestamp: number;
    byDate: DailyWeatherByDate;
}

function cityKey(city: string): string {
    return city.trim().toLowerCase();
}

function readJson<T>(key: string): T | null {
    const cached = localStorage.getItem(key);
    if (!cached) return null;
    try {
        return JSON.parse(cached) as T;
    } catch (e) {
        console.warn("Failed to parse cached weather data", e);
        return null;
    }
}

// A failed cache write (quota, private mode) must not discard fetched data.
function writeJson(key: string, value: unknown): void {
    try {
        localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
        console.warn("Failed to cache weather data", e);
    }
}

/**
 * Resolve a city name to coordinates via the Open-Meteo geocoding API.
 * Successful lookups are cached forever (a city doesn't move); failures are
 * not cached, so a typo costs one request per app load until corrected.
 */
async function geocodeCity(city: string): Promise<GeoPoint | null> {
    const key = `${GEOCODE_CACHE_KEY}_${cityKey(city)}`;
    const cached = readJson<GeoPoint>(key);
    if (cached) return cached;

    try {
        const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city.trim())}&count=1`;
        const res = await fetch(url);
        if (!res.ok) {
            throw new Error(`Failed to geocode city: ${res.status} ${res.statusText}`);
        }
        const data = await res.json() as { results?: { latitude: number; longitude: number; }[]; };
        const top = data.results?.[0];
        if (!top) return null;
        const point: GeoPoint = { lat: top.latitude, lon: top.longitude };
        writeJson(key, point);
        return point;
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
        // trip dates beyond that horizon simply get no entry.
        const url = `https://api.open-meteo.com/v1/forecast?latitude=${point.lat}&longitude=${point.lon}`
            + "&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max"
            + "&timezone=auto&forecast_days=16";
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
 * follows when stale, so `onUpdate` may fire 0, 1, or 2 times.
 */
export function loadDailyWeather(
    city: string,
    onUpdate: (byDate: DailyWeatherByDate) => void,
): void {
    const cached = readJson<ForecastCacheEntry>(`${FORECAST_CACHE_KEY}_${cityKey(city)}`);
    if (cached) onUpdate(cached.byDate);

    const stale = !cached || Date.now() - cached.timestamp >= FORECAST_TTL;
    if (!stale) return;

    void fetchForecast(city).then(byDate => {
        if (byDate) onUpdate(byDate);
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
