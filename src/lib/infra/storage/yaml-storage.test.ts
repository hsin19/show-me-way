// The backup ring behind the only undo in the app: every destructive overwrite of
// showmeway_user_yaml snapshots the outgoing copy here first, newest first, max 5.

import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from "vitest";
import {
    backupCurrentYaml,
    getYamlBackup,
    listYamlBackups,
    USER_YAML_KEY,
    YAML_BACKUPS_KEY,
} from "./yaml-storage";

function createLocalStorageStub() {
    const store = new Map<string, string>();
    return {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => void store.set(key, value),
        removeItem: (key: string) => void store.delete(key),
        clear: () => store.clear(),
        _store: store,
    };
}

describe("backupCurrentYaml / listYamlBackups / getYamlBackup", () => {
    let storage: ReturnType<typeof createLocalStorageStub>;

    beforeEach(() => {
        vi.useFakeTimers();
        storage = createLocalStorageStub();
        vi.stubGlobal("localStorage", storage);
        vi.spyOn(console, "warn").mockImplementation(() => {});
    });
    afterEach(() => {
        vi.unstubAllGlobals();
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it("does nothing when there is no current YAML to snapshot", () => {
        backupCurrentYaml();
        expect(listYamlBackups()).toEqual([]);
    });

    it("snapshots newest-first and looks one up by timestamp", () => {
        vi.setSystemTime(new Date("2026-06-11T00:00:00Z"));
        storage.setItem(USER_YAML_KEY, "trip: A");
        backupCurrentYaml();
        vi.setSystemTime(new Date("2026-06-12T00:00:00Z"));
        storage.setItem(USER_YAML_KEY, "trip: B");
        backupCurrentYaml();

        const backups = listYamlBackups();
        expect(backups.map(b => b.yaml)).toEqual(["trip: B", "trip: A"]);
        expect(getYamlBackup(backups[0].savedAt)).toBe("trip: B");
        expect(getYamlBackup("no-such-stamp")).toBeNull();
    });

    it("skips a snapshot identical to the latest", () => {
        storage.setItem(USER_YAML_KEY, "trip: same");
        backupCurrentYaml();
        vi.setSystemTime(new Date("2026-06-12T00:00:00Z"));
        backupCurrentYaml(); // USER_YAML_KEY unchanged
        expect(listYamlBackups()).toHaveLength(1);
    });

    it("keeps only the newest 5 (ring buffer)", () => {
        for (let i = 0; i < 7; i++) {
            vi.setSystemTime(new Date(2026, 5, 11, 0, i)); // distinct minutes
            storage.setItem(USER_YAML_KEY, `trip: ${i}`);
            backupCurrentYaml();
        }
        const backups = listYamlBackups();
        expect(backups).toHaveLength(5);
        expect(backups[0].yaml).toBe("trip: 6"); // newest
        expect(backups.at(-1)!.yaml).toBe("trip: 2"); // oldest two evicted
    });

    it("only warns (never throws) when the backup write fails", () => {
        storage.setItem(USER_YAML_KEY, "trip: A");
        storage.setItem = () => {
            throw new DOMException("QuotaExceededError");
        };
        expect(() => backupCurrentYaml()).not.toThrow();
    });

    it("treats a corrupt backups blob as empty", () => {
        storage.setItem(YAML_BACKUPS_KEY, "{not json");
        expect(listYamlBackups()).toEqual([]);
        storage.setItem(YAML_BACKUPS_KEY, JSON.stringify([{ savedAt: 1, yaml: null }, "x"]));
        expect(listYamlBackups()).toEqual([]); // malformed entries filtered out
    });
});
