import { vi } from "vitest";

// Test-only stand-ins for the browser globals vitest's node environment lacks.
// Not measured by coverage (see vitest.config.ts) and never imported by app code.

/** A `Map`-backed `Storage`. Superset of what every test needs, so one shape serves them all. */
export function createLocalStorageStub() {
    const store = new Map<string, string>();
    return {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => void store.set(key, value),
        removeItem: (key: string) => void store.delete(key),
        clear: () => store.clear(),
        key: (i: number) => [...store.keys()][i] ?? null,
        get length() {
            return store.size;
        },
    };
}

/**
 * Installs a `window` whose timers delegate to the globals at call time, so
 * `vi.useFakeTimers()` controls code that schedules via `window.setTimeout`.
 * Call it after `vi.useFakeTimers()`; the delegation is lazy, so order only
 * matters if a test swaps the global timers later.
 */
export function stubWindowTimers(): void {
    vi.stubGlobal("window", {
        setInterval: (handler: () => void, timeout?: number) => setInterval(handler, timeout),
        setTimeout: (handler: () => void, timeout?: number) => setTimeout(handler, timeout),
    });
}
