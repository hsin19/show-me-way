// What backs the 本機儲存與快取 section of App 設定.
//
// Deliberately NOT part of `storage-cache.ts`: that module is the leaf the caches
// import, while this one composes the other direction — it asks each owner which
// keys it occupies and delegates removal back to it, so no key string is restated
// here and nothing imports this back.
//
// The one thing it does know is the app's key prefix, for the hard reset. That
// reset is scoped and never `localStorage.clear()`: production is a GitHub Pages
// *project* site, so the origin is shared with every other project on the
// account and a blanket clear would take their data too.

import { yamlBackupKeys } from "./api";
import {
    clearExchangeCache,
    exchangeCacheKeys,
} from "./exchange";
import { clearCachedAccessToken } from "./gdrive";
import { MANUAL_RATE_KEY_PREFIX } from "./ledger";
import { clearStorageCacheMemory } from "./storage-cache";
import {
    clearWeatherCache,
    weatherCacheKeys,
} from "./weather";

// Re-exported so the panel has one import for the whole surface, while the
// removal itself stays with the backup ring's owner.
export { clearYamlBackups } from "./api";

/** Every key this app writes carries this prefix, except the two cases below. */
const APP_KEY_PREFIX = "showmeway_";

/** Swept too, so a copy that outlived a failed migration cannot sit there with nothing left to read it. */
const LEGACY_KEYS = ["todo_state", "packing_state", "ledger_expenses"];

interface CategoryStorageStats {
    keyCount: number;
    sizeBytes: number;
}

export interface StorageSummary {
    /** App-owned bytes only — see the module comment on the shared origin. */
    totalBytes: number;
    apiCache: CategoryStorageStats;
    backups: CategoryStorageStats;
    /** The rest: itinerary YAML, trip profiles, theme, AI settings, manual rates. */
    other: CategoryStorageStats;
}

// UTF-16 code units, not UTF-8 bytes: that is how browsers bill the quota, and for
// a Chinese itinerary the two differ by roughly half.
function storedBytes(key: string): number {
    return (key.length + (localStorage.getItem(key) ?? "").length) * 2;
}

function isAppKey(key: string): boolean {
    return (
        key.startsWith(APP_KEY_PREFIX)
        || key.startsWith(MANUAL_RATE_KEY_PREFIX)
        || LEGACY_KEYS.includes(key)
    );
}

/** A snapshot: removing while walking the live index would skip entries. */
function appKeys(): string[] {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && isAppKey(key)) keys.push(key);
    }
    return keys;
}

function statsFor(keys: readonly string[]): CategoryStorageStats {
    return {
        keyCount: keys.length,
        sizeBytes: keys.reduce((sum, key) => sum + storedBytes(key), 0),
    };
}

/** localStorage usage of this app, grouped by what clearing each group costs. */
export function getStorageSummary(): StorageSummary {
    const apiCacheKeys = [...weatherCacheKeys(), ...exchangeCacheKeys()];
    const backupKeys = yamlBackupKeys();
    const claimed = new Set([...apiCacheKeys, ...backupKeys]);
    const otherKeys = appKeys().filter(key => !claimed.has(key));

    const apiCache = statsFor(apiCacheKeys);
    const backups = statsFor(backupKeys);
    const other = statsFor(otherKeys);
    return {
        totalBytes: apiCache.sizeBytes + backups.sizeBytes + other.sizeBytes,
        apiCache,
        backups,
        other,
    };
}

/** Drops everything refetchable; returns how many keys went. Costs the user only a re-fetch. */
export function clearApiCache(): number {
    return clearWeatherCache() + clearExchangeCache();
}

/**
 * Every key this app owns, and nothing else on the origin. The caller must reload
 * afterwards: components still hold the cleared data in memory and would write
 * parts of it straight back.
 */
export function clearAppLocalStorage(): void {
    appKeys().forEach(key => localStorage.removeItem(key));
    clearStorageCacheMemory();
    clearCachedAccessToken();
}
