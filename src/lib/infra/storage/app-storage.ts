/*
 * The app's key-value store. Callers name what they keep ("user_yaml", "gdrive_trips") and
 * never see what backs it — localStorage under a namespace by default, which is Web Storage
 * in the browser and the stub in unit tests, and a file of its own under `trip:sync`, which
 * swaps it in with `useAppStorage`. The namespace exists because production is a GitHub
 * Pages project site: the origin is shared with every other project on the account, and
 * `showmeway_` is what tells this app's keys from theirs. It is written here and nowhere else in the app's source — index.html's
 * pre-paint script holds the one literal copy, for `theme`; tests and e2e spell physical
 * keys out on purpose, since those are what installed phones already hold.
 *
 * A leaf, so every owner of a key can import it — `storage-admin` included, which sizes and
 * clears what it holds.
 */

/**
 * Failure behaves as Web Storage does: a read can throw where site data is blocked, a write
 * can throw on quota. Callers that must not fail catch it themselves.
 */
export interface AppStorage {
    get(name: string): string | null;
    set(name: string, value: string): void;
    remove(name: string): void;
    /** A snapshot of the names held, so a caller can remove while walking it. */
    names(): string[];
    /** What an entry costs against the quota, in bytes: UTF-16 code units of key and value, which is how browsers bill it. */
    sizeOf(name: string): number;
}

// `localStorage` is read on every call rather than captured: tests stub the global per
// case, and nothing may touch it at import time.
function namespacedWebStorage(namespace: string): AppStorage {
    return {
        get: name => localStorage.getItem(namespace + name),
        set: (name, value) => localStorage.setItem(namespace + name, value),
        remove: name => localStorage.removeItem(namespace + name),
        names: () => {
            const names: string[] = [];
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                if (key?.startsWith(namespace)) names.push(key.slice(namespace.length));
            }
            return names;
        },
        sizeOf: name => ((namespace + name).length + (localStorage.getItem(namespace + name) ?? "").length) * 2,
    };
}

let backend: AppStorage = namespacedWebStorage("showmeway_");

// A fixed object that looks the backend up on every call, so a caller that keeps a copy of it
// still reaches whatever `useAppStorage` installs.
export const appStorage: AppStorage = {
    get: name => backend.get(name),
    set: (name, value) => backend.set(name, value),
    remove: name => backend.remove(name),
    names: () => backend.names(),
    sizeOf: name => backend.sizeOf(name),
};

/** Replace what backs `appStorage`, for a host that is not a browser. Call it before anything reads storage. */
export function useAppStorage(storage: AppStorage): void {
    backend = storage;
}
