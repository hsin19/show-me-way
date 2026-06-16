import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from "vitest";
import {
    type DailyWeatherByDate,
    loadDailyWeather,
    resetWeatherCacheForTests,
    weatherCodeInfo,
} from "./weather";

describe("weatherCodeInfo", () => {
    it("maps the main WMO codes to icons and zh-TW labels", () => {
        expect(weatherCodeInfo(0)).toEqual({ icon: "sun", label: "晴朗" });
        expect(weatherCodeInfo(2)).toEqual({ icon: "cloud-sun", label: "多雲時晴" });
        expect(weatherCodeInfo(3)).toEqual({ icon: "cloud", label: "陰天" });
        expect(weatherCodeInfo(45).icon).toBe("fog");
        expect(weatherCodeInfo(55).icon).toBe("drizzle");
        expect(weatherCodeInfo(63)).toEqual({ icon: "rain", label: "中雨" });
        expect(weatherCodeInfo(75)).toEqual({ icon: "snow", label: "大雪" });
        expect(weatherCodeInfo(82)).toEqual({ icon: "rain", label: "強陣雨" });
        expect(weatherCodeInfo(95).icon).toBe("thunder");
        expect(weatherCodeInfo(99).icon).toBe("thunder");
    });

    it("falls back to a cloud for unknown codes", () => {
        expect(weatherCodeInfo(42).icon).toBe("cloud");
        expect(weatherCodeInfo(-1).icon).toBe("cloud");
    });
});

const FORECAST_TTL = 1000 * 60 * 60 * 3;
const GEOCODE_TTL = 1000 * 60 * 60 * 24 * 30;
const NOW = new Date("2026-06-11T08:00:00Z").getTime();
const FORECAST_KEY = "showmeway_weather_tokyo";
const GEOCODE_KEY = "showmeway_geocode_v1_tokyo";

function createLocalStorageStub() {
    const store = new Map<string, string>();
    return {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => void store.set(key, value),
        removeItem: (key: string) => void store.delete(key),
        clear: () => store.clear(),
    };
}

function forecastOf(tempMax: number): DailyWeatherByDate {
    return { "2026-06-11": { code: 0, tempMax, tempMin: 20, precipProb: 10 } };
}

function geocodeEntryOf(cachedAt: number) {
    return { lat: 35.68, lon: 139.69, name: "東京", country_code: "JP", cachedAt };
}

// Answers both API hops: geocoding first, then the forecast for one day.
function stubFetchWith(tempMax: number) {
    const fetchMock = vi.fn((url: string) => {
        if (url.includes("geocoding-api")) {
            return Promise.resolve({
                ok: true,
                json: () =>
                    Promise.resolve({
                        results: [{ latitude: 35.68, longitude: 139.69, name: "東京", country_code: "JP" }],
                    }),
            });
        }
        return Promise.resolve({
            ok: true,
            json: () =>
                Promise.resolve({
                    daily: {
                        time: ["2026-06-11"],
                        weather_code: [0],
                        temperature_2m_max: [tempMax],
                        temperature_2m_min: [20],
                        precipitation_probability_max: [10],
                    },
                }),
        });
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
}

function stubFetchWithNoResults() {
    const fetchMock = vi.fn(() =>
        Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ results: [] }),
        })
    );
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
}

// loadDailyWeather fires fetch without exposing its promise; drain the microtask queue instead.
async function flushAsync() {
    for (let i = 0; i < 10; i++) await Promise.resolve();
}

describe("loadDailyWeather", () => {
    let storage: ReturnType<typeof createLocalStorageStub>;

    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(NOW);
        resetWeatherCacheForTests();
        storage = createLocalStorageStub();
        vi.stubGlobal("localStorage", storage);
        vi.spyOn(console, "info").mockImplementation(() => {});
        vi.spyOn(console, "warn").mockImplementation(() => {});
        vi.spyOn(console, "error").mockImplementation(() => {});
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it("serves a fresh cache without fetching", async () => {
        storage.setItem(FORECAST_KEY, JSON.stringify({ timestamp: NOW - 1000, byDate: forecastOf(31) }));
        const fetchMock = stubFetchWith(99);
        const onUpdate = vi.fn();

        loadDailyWeather("Tokyo", onUpdate);
        await flushAsync();

        expect(onUpdate).toHaveBeenCalledTimes(1);
        expect(onUpdate).toHaveBeenCalledWith(forecastOf(31), NOW - 1000);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("treats a malformed cache entry as a miss, clears it, and refetches", async () => {
        storage.setItem(FORECAST_KEY, JSON.stringify({ timestamp: "now", byDate: forecastOf(31) }));
        const fetchMock = stubFetchWith(32);
        const onUpdate = vi.fn();

        loadDailyWeather("Tokyo", onUpdate);
        expect(storage.getItem(FORECAST_KEY)).toBeNull();

        await flushAsync();
        expect(fetchMock).toHaveBeenCalledTimes(2); // geocode + forecast
        expect(onUpdate).toHaveBeenCalledTimes(1);
        expect(onUpdate).toHaveBeenCalledWith(forecastOf(32), NOW);
        expect(JSON.parse(storage.getItem(FORECAST_KEY)!)).toEqual({ timestamp: NOW, byDate: forecastOf(32) });
    });

    it("treats an array byDate as a miss and refetches", async () => {
        storage.setItem(FORECAST_KEY, JSON.stringify({ timestamp: NOW - 1000, byDate: [] }));
        stubFetchWith(32);
        const onUpdate = vi.fn();

        loadDailyWeather("Tokyo", onUpdate);
        expect(storage.getItem(FORECAST_KEY)).toBeNull();

        await flushAsync();
        expect(onUpdate).toHaveBeenCalledTimes(1);
        expect(onUpdate).toHaveBeenCalledWith(forecastOf(32), NOW);
    });

    it("treats a future timestamp as stale and refreshes", async () => {
        storage.setItem(FORECAST_KEY, JSON.stringify({ timestamp: NOW + FORECAST_TTL, byDate: forecastOf(31) }));
        stubFetchWith(32);
        const onUpdate = vi.fn();

        loadDailyWeather("Tokyo", onUpdate);
        await flushAsync();

        expect(onUpdate).toHaveBeenCalledTimes(2);
        expect(onUpdate).toHaveBeenNthCalledWith(1, forecastOf(31), NOW + FORECAST_TTL);
        expect(onUpdate).toHaveBeenNthCalledWith(2, forecastOf(32), NOW);
    });

    it("clears a malformed geocode cache and re-resolves the city", async () => {
        storage.setItem(FORECAST_KEY, JSON.stringify({ timestamp: NOW - FORECAST_TTL, byDate: forecastOf(31) }));
        storage.setItem(GEOCODE_KEY, JSON.stringify({}));
        const fetchMock = stubFetchWith(32);
        const onUpdate = vi.fn();

        loadDailyWeather("Tokyo", onUpdate);
        await flushAsync();

        expect(storage.getItem(GEOCODE_KEY)).not.toBeNull();
        expect(JSON.parse(storage.getItem(GEOCODE_KEY)!)).toEqual(geocodeEntryOf(NOW));
        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(onUpdate).toHaveBeenNthCalledWith(2, forecastOf(32), NOW);
    });

    it("dedupes concurrent loads for the same city into one request pair", async () => {
        const fetchMock = stubFetchWith(32);
        const first = vi.fn();
        const second = vi.fn();

        loadDailyWeather("Tokyo", first);
        loadDailyWeather("Tokyo", second);
        await flushAsync();

        expect(fetchMock).toHaveBeenCalledTimes(2); // geocode + forecast, not doubled
        expect(first).toHaveBeenCalledTimes(1);
        expect(first).toHaveBeenCalledWith(forecastOf(32), NOW);
        expect(second).toHaveBeenCalledTimes(1);
        expect(second).toHaveBeenCalledWith(forecastOf(32), NOW);
    });

    it("fetches again once the in-flight request has settled", async () => {
        const fetchMock = stubFetchWith(32);
        const onUpdate = vi.fn();

        loadDailyWeather("Tokyo", onUpdate);
        await flushAsync();
        vi.setSystemTime(NOW + FORECAST_TTL); // first result is now stale
        loadDailyWeather("Tokyo", onUpdate);
        await flushAsync();

        expect(fetchMock).toHaveBeenCalledTimes(3); // geocode cached; forecast refetched
    });

    it("remembers a zero-result geocode in memory and skips retries within the cooldown", async () => {
        const fetchMock = stubFetchWithNoResults();
        const onUpdate = vi.fn();

        loadDailyWeather("Atlantis", onUpdate);
        await flushAsync();
        loadDailyWeather("Atlantis", onUpdate);
        await flushAsync();

        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(onUpdate).not.toHaveBeenCalled();
        expect(storage.getItem("showmeway_geocode_v1_atlantis")).toBeNull();

        vi.setSystemTime(NOW + FORECAST_TTL);
        loadDailyWeather("Atlantis", onUpdate);
        await flushAsync();
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("queries with language=zh and turns a ', US' suffix into a countryCode filter", async () => {
        const fetchMock = stubFetchWith(32);
        const onUpdate = vi.fn();

        loadDailyWeather("Springfield, US", onUpdate);
        await flushAsync();

        const geocodeUrl = fetchMock.mock.calls[0][0];
        expect(geocodeUrl).toContain("name=Springfield&");
        expect(geocodeUrl).toContain("&language=zh");
        expect(geocodeUrl).toContain("&countryCode=US");
        expect(onUpdate).toHaveBeenCalledWith(forecastOf(32), NOW);
    });

    it("reuses a fresh geocode entry without re-resolving", async () => {
        storage.setItem(GEOCODE_KEY, JSON.stringify(geocodeEntryOf(NOW - 1000)));
        const fetchMock = stubFetchWith(32);

        loadDailyWeather("Tokyo", vi.fn());
        await flushAsync();

        expect(fetchMock).toHaveBeenCalledTimes(1); // forecast only
        expect(fetchMock.mock.calls[0][0]).toContain("api.open-meteo.com");
    });

    it("re-resolves a geocode entry past its 30-day TTL", async () => {
        storage.setItem(GEOCODE_KEY, JSON.stringify({ lat: 1, lon: 2, name: "舊", country_code: "??", cachedAt: NOW - GEOCODE_TTL }));
        const fetchMock = stubFetchWith(32);

        loadDailyWeather("Tokyo", vi.fn());
        await flushAsync();

        expect(fetchMock).toHaveBeenCalledTimes(2); // geocode + forecast
        expect(JSON.parse(storage.getItem(GEOCODE_KEY)!)).toEqual(geocodeEntryOf(NOW));
    });

    it("serves from the in-memory mirror when localStorage writes always throw", async () => {
        storage.setItem = () => {
            throw new Error("QuotaExceededError");
        };
        const fetchMock = stubFetchWith(32);
        const onUpdate = vi.fn();

        loadDailyWeather("Tokyo", onUpdate);
        await flushAsync();
        expect(fetchMock).toHaveBeenCalledTimes(2);

        loadDailyWeather("Tokyo", onUpdate);
        await flushAsync();

        expect(fetchMock).toHaveBeenCalledTimes(2); // second load within TTL: no fetch
        expect(onUpdate).toHaveBeenCalledTimes(2);
        expect(onUpdate).toHaveBeenNthCalledWith(2, forecastOf(32), NOW);
    });
});
