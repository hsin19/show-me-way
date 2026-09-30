// What backs the 本機儲存與快取 section of App 設定.
//
// Deliberately NOT part of `storage-cache.ts`: that module is the leaf the caches
// import, while this one composes the other direction — it asks each owner which
// keys it occupies and delegates removal back to it, so no key string is restated
// here and nothing imports this back.
//
// What the app holds comes from appStorage, so the hard reset is scoped by construction
// and never `localStorage.clear()`, which on the shared origin would take every other
// project's data too.

import {
    clearWeatherCache,
    weatherCacheKeys,
} from "$lib/infra/http/weather";
import { appStorage } from "./app-storage";
import { clearStorageCacheMemory } from "./storage-cache";
import { yamlBackupKeys } from "./yaml-storage";

// Re-exported so the panel has one import for the whole surface, while the
// removal itself stays with the backup ring's owner.
export { clearYamlBackups } from "./yaml-storage";

interface CategoryStorageStats {
    keyCount: number;
    sizeBytes: number;
}

export interface StorageSummary {
    /** App-owned bytes only — see the module comment on the shared origin. */
    totalBytes: number;
    apiCache: CategoryStorageStats;
    backups: CategoryStorageStats;
    /** The rest: itinerary YAML, trip profiles, theme, AI settings. */
    other: CategoryStorageStats;
}

/** Renders a `StorageSummary` byte count for display, e.g. in App 設定. */
export function formatBytes(bytes: number): string {
    if (bytes <= 0) return "0 B";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function statsFor(names: readonly string[]): CategoryStorageStats {
    return {
        keyCount: names.length,
        sizeBytes: names.reduce((sum, name) => sum + appStorage.sizeOf(name), 0),
    };
}

/** localStorage usage of this app, grouped by what clearing each group costs. */
export function getStorageSummary(): StorageSummary {
    const apiCacheNames = weatherCacheKeys();
    const backupNames = yamlBackupKeys();
    const claimed = new Set([...apiCacheNames, ...backupNames]);
    const otherNames = appStorage.names().filter(name => !claimed.has(name));

    const apiCache = statsFor(apiCacheNames);
    const backups = statsFor(backupNames);
    const other = statsFor(otherNames);
    return {
        totalBytes: apiCache.sizeBytes + backups.sizeBytes + other.sizeBytes,
        apiCache,
        backups,
        other,
    };
}

/** Drops everything refetchable; returns how many keys went. Costs the user only a re-fetch. */
export function clearApiCache(): number {
    return clearWeatherCache();
}

/**
 * Every key this app owns, and nothing else on the origin. The caller must reload
 * afterwards: components still hold the cleared data in memory and would write
 * parts of it straight back.
 */
export function clearAppLocalStorage(): void {
    appStorage.names().forEach(name => appStorage.remove(name));
    clearStorageCacheMemory();
}
