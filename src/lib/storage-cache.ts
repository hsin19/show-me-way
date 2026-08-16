// Leaf helpers shared by `exchange.ts` and `weather.ts`, extracted after the two
// near-identical copies drifted apart once. Deliberately NOT a generic SWR
// engine: the consumers' fetch and refresh shapes differ enough that
// parameterising them would cost more than it saves (see tech-debt.md).

// Mirrors localStorage so a failed write (quota, private mode) degrades to
// per-session caching instead of a refetch on every foreground return.
const memCache = new Map<string, unknown>();

/** Test-only: without this, a cached value leaks into the next case. */
export function clearStorageCacheMemory(): void {
    memCache.clear();
}

/**
 * The cached value, or null. An entry that fails `isValid` — corrupt, or written
 * by an older shape — is deleted rather than ignored: nothing else would ever
 * clear it, and it would shadow the cache forever.
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

/** Never throws: freshly fetched data must not be lost just because caching it failed. */
export function writeCachedJson(key: string, value: unknown): void {
    memCache.set(key, value);
    try {
        localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
        console.warn("Failed to cache data", e);
    }
}

/** A snapshot, so the caller can remove keys while walking the result. */
export function cachedKeysWithPrefix(prefix: string): string[] {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key?.startsWith(prefix)) keys.push(key);
    }
    return keys;
}

/** Clears the mirror too — remove only the localStorage side and it keeps serving what storage no longer has. */
export function removeCachedKeys(keys: readonly string[]): void {
    for (const key of keys) {
        memCache.delete(key);
        localStorage.removeItem(key);
    }
}

/** A future timestamp counts as stale: after a clock rollback it would otherwise never expire. */
export function isFresh(timestamp: number, ttl: number, now: number): boolean {
    return timestamp <= now && now - timestamp < ttl;
}
