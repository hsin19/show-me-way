// Leaf-level localStorage cache helpers shared by `exchange.ts` and `weather.ts`.
// Three concerns that were near-duplicated across both (and had drifted once):
//   - read:  mem-mirror → parse → validate → drop-bad-entry
//   - write: mem-mirror + guarded setItem (quota / private mode only warns)
//   - fresh: clock-rollback-aware TTL check
// Deliberately NOT a generic SWR engine — the two consumers' fetch/refresh
// shapes differ enough that parameterising would cost more than it saves
// (see tech-debt.md). These are plain leaf functions, nothing more.

// Mirror of localStorage so a failed write (quota, private mode) degrades to
// per-session caching instead of refetching on every foreground return.
const memCache = new Map<string, unknown>();

/** Test-only: drop the in-memory mirror so cases don't leak cached values. */
export function clearStorageCacheMemory(): void {
    memCache.clear();
}

/**
 * Read a cached JSON value: serve the in-memory mirror if present, else parse
 * localStorage. A successful fetch is the only other write path, so an entry
 * that fails validation (corrupt or stale-shape) is dropped here — otherwise it
 * would shadow the cache forever.
 */
export function readCachedJson<T>(key: string, isValid: (value: unknown) => value is T): T | null {
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
        console.warn("Failed to parse cached data", e);
    }
    localStorage.removeItem(key);
    return null;
}

/**
 * Write a cached JSON value. The mem-mirror is always updated; a failed
 * localStorage write (quota, private mode) only warns so the freshly-fetched
 * data is never discarded just because caching failed.
 */
export function writeCachedJson(key: string, value: unknown): void {
    memCache.set(key, value);
    try {
        localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
        console.warn("Failed to cache data", e);
    }
}

/**
 * TTL freshness check that also rejects a future timestamp left behind by a
 * clock rollback (which would otherwise never expire by elapsed time).
 */
export function isFresh(timestamp: number, ttl: number, now: number): boolean {
    return timestamp <= now && now - timestamp < ttl;
}
