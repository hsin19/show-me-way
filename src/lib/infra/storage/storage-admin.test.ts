import { createLocalStorageStub } from "$lib/testing/stubs";
import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from "vitest";
import {
    clearApiCache,
    clearAppLocalStorage,
    clearYamlBackups,
    formatBytes,
    getStorageSummary,
} from "./storage-admin";
import {
    clearStorageCacheMemory,
    readCachedJson,
    writeCachedJson,
} from "./storage-cache";

interface Entry {
    n: number;
}
function isEntry(value: unknown): value is Entry {
    return typeof value === "object" && value !== null && Number.isFinite((value as Entry).n);
}

let storage: ReturnType<typeof createLocalStorageStub>;

beforeEach(() => {
    clearStorageCacheMemory();
    storage = createLocalStorageStub();
    vi.stubGlobal("localStorage", storage);
});

afterEach(() => {
    vi.unstubAllGlobals();
});

describe("getStorageSummary", () => {
    it("groups the app's keys by what clearing them costs", () => {
        storage.setItem("showmeway_weather_tokyo", '{"temp":25}');
        storage.setItem("showmeway_geocode_v1_tokyo", '{"lat":35}');
        storage.setItem("showmeway_exchange_rates_twd", '{"jpy":4.5}');
        storage.setItem("showmeway_yaml_backups", '[{"id":1}]');
        storage.setItem("showmeway_user_yaml", "title: test trip");
        storage.setItem("showmeway_gemini_api_key", "test-key");
        storage.setItem("exchange_rate_JPY", "0.21");

        const summary = getStorageSummary();
        expect(summary.apiCache.keyCount).toBe(3);
        expect(summary.backups.keyCount).toBe(1);
        // itinerary YAML + Gemini key + manual rate
        expect(summary.other.keyCount).toBe(3);
        expect(summary.totalBytes).toBe(
            summary.apiCache.sizeBytes + summary.backups.sizeBytes + summary.other.sizeBytes,
        );
    });

    it("sizes entries in UTF-16 code units, matching how browsers bill the quota", () => {
        // Each of these characters is 3 bytes in UTF-8 but 2 in UTF-16.
        storage.setItem("showmeway_user_yaml", "台北行");
        const chars = "showmeway_user_yaml".length + 3;
        expect(getStorageSummary().totalBytes).toBe(chars * 2);
    });

    it("ignores keys belonging to other apps on the same origin", () => {
        storage.setItem("some_other_app_state", "not ours");
        const summary = getStorageSummary();
        expect(summary.totalBytes).toBe(0);
        expect(summary.other.keyCount).toBe(0);
    });
});

describe("clearApiCache", () => {
    it("removes cached responses and purges the in-memory mirror", () => {
        storage.setItem("showmeway_user_yaml", "keep me");
        writeCachedJson("showmeway_weather_tokyo", { n: 1 } satisfies Entry);

        expect(clearApiCache()).toBe(1);
        expect(storage.getItem("showmeway_weather_tokyo")).toBeNull();
        expect(readCachedJson("showmeway_weather_tokyo", isEntry)).toBeNull();
        expect(storage.getItem("showmeway_user_yaml")).toBe("keep me");
    });

    it("covers weather, geocode and exchange entries alike", () => {
        storage.setItem("showmeway_weather_tokyo", "{}");
        storage.setItem("showmeway_geocode_v1_tokyo", "{}");
        storage.setItem("showmeway_exchange_rates_twd", "{}");

        expect(clearApiCache()).toBe(3);
        expect(storage.length).toBe(0);
    });

    it("leaves backups and trip data alone", () => {
        storage.setItem("showmeway_exchange_rates_twd", "{}");
        storage.setItem("showmeway_yaml_backups", '[{"id":1}]');

        expect(clearApiCache()).toBe(1);
        expect(storage.getItem("showmeway_yaml_backups")).toBe('[{"id":1}]');
    });
});

describe("clearYamlBackups", () => {
    it("removes the backup ring and reports whether one existed", () => {
        storage.setItem("showmeway_yaml_backups", '[{"id":1}]');
        expect(clearYamlBackups()).toBe(true);
        expect(storage.getItem("showmeway_yaml_backups")).toBeNull();
        expect(clearYamlBackups()).toBe(false);
    });
});

describe("clearAppLocalStorage", () => {
    it("removes every key this app owns, including legacy and unprefixed ones", () => {
        storage.setItem("showmeway_user_yaml", "my trip");
        storage.setItem("showmeway_profiles", "[]");
        storage.setItem("showmeway_theme", "dark");
        storage.setItem("showmeway_weather_tokyo", "data");
        storage.setItem("exchange_rate_JPY", "0.21");
        storage.setItem("ledger_expenses", "[]");

        clearAppLocalStorage();
        expect(storage.length).toBe(0);
    });

    it("never touches another app's keys on the shared origin", () => {
        storage.setItem("showmeway_user_yaml", "my trip");
        storage.setItem("other_project_token", "keep me");

        clearAppLocalStorage();
        expect(storage.getItem("showmeway_user_yaml")).toBeNull();
        expect(storage.getItem("other_project_token")).toBe("keep me");
    });

    it("purges the in-memory cache mirror too", () => {
        writeCachedJson("showmeway_weather_tokyo", { n: 1 } satisfies Entry);
        clearAppLocalStorage();
        expect(readCachedJson("showmeway_weather_tokyo", isEntry)).toBeNull();
    });
});

describe("formatBytes", () => {
    it("formats zero and negative bytes as 0 B", () => {
        expect(formatBytes(0)).toBe("0 B");
        expect(formatBytes(-100)).toBe("0 B");
    });

    it("formats bytes under 1 KB", () => {
        expect(formatBytes(512)).toBe("512 B");
    });

    it("formats KB", () => {
        expect(formatBytes(1024)).toBe("1.0 KB");
        expect(formatBytes(1536)).toBe("1.5 KB");
    });

    it("formats MB", () => {
        expect(formatBytes(1048576)).toBe("1.0 MB");
        expect(formatBytes(5242880)).toBe("5.0 MB");
    });
});
