// Backing logic for the 本機儲存與快取 section of App 設定: what this app has
// parked in localStorage, and how to clear it one category at a time.
//
// Deliberately NOT part of `storage-cache.ts`. That module is the leaf the
// caches import; this one composes the other direction, asking each module that
// owns storage which keys it occupies (`weatherCacheKeys`, `exchangeCacheKeys`,
// `yamlBackupKeys`) and delegating removal back to it. No key string is
// restated here, and nothing imports this back, so the direction stays acyclic.
//
// The one thing this module does know is the app's key prefix, for the hard
// reset — which is scoped on purpose and never `localStorage.clear()`. The
// production build is a GitHub Pages *project* site, so the origin
// (hsin19.github.io) is shared with every other project on the same account;
// a blanket clear would take their data with it.

import { yamlBackupKeys } from "./api";
import {
    clearExchangeCache,
    exchangeCacheKeys,
} from "./exchange";
import { MANUAL_RATE_KEY_PREFIX } from "./ledger";
import { clearStorageCacheMemory } from "./storage-cache";
import {
    clearWeatherCache,
    weatherCacheKeys,
} from "./weather";

// Re-exported so the storage panel has one import for the whole surface, while
// the removal itself still lives with the backup ring's owner.
export { clearYamlBackups } from "./api";

/** Every key this app writes carries this prefix, except the two cases below. */
const APP_KEY_PREFIX = "showmeway_";

/**
 * Pre-migration keys `App.svelte` folds into the itinerary YAML on boot and then
 * removes. Swept as well, so a copy that outlived a failed migration cannot sit
 * in storage forever with nothing left to read it.
 */
const LEGACY_KEYS = ["todo_state", "packing_state", "ledger_expenses"];

export interface CategoryStorageStats {
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

/**
 * Approximate stored size. Browsers bill localStorage per UTF-16 code unit, not
 * per UTF-8 byte — for a Chinese itinerary the two differ by ~50%, and this
 * number is only worth showing if it tracks the quota the user can actually hit.
 */
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

/** Snapshot of the app's own keys, taken before any removal so the live index cannot shift under us. */
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

/**
 * Drop every refetchable network response. Each owner clears its own entries
 * (mem-mirror included), so nothing here needs to know their key shapes.
 */
export function clearApiCache(): number {
    return clearWeatherCache() + clearExchangeCache();
}

/**
 * Hard reset: every key this app owns, and nothing else on the origin. The
 * caller is expected to reload afterwards — components still hold the cleared
 * data in memory and would otherwise write parts of it straight back.
 */
export function clearAppLocalStorage(): void {
    appKeys().forEach(key => localStorage.removeItem(key));
    clearStorageCacheMemory();
}
