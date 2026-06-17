import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from "vitest";
import {
    ACTIVE_PROFILE_KEY,
    createProfile,
    deleteProfile,
    ensureActiveProfileId,
    getActiveProfileId,
    listProfiles,
    PROFILES_KEY,
    switchToProfile,
    tripNameFromYaml,
    USER_YAML_KEY,
} from "./api";

// Minimal YAML carrying just a trip.name — tripNameFromYaml parses the raw YAML
// directly (no full-structure validation), so this is all the swap logic needs.
function yamlNamed(name: string): string {
    return `trip:\n  name: '${name}'\n`;
}

function createLocalStorageStub() {
    const store = new Map<string, string>();
    return {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => void store.set(key, value),
        removeItem: (key: string) => void store.delete(key),
        clear: () => store.clear(),
    };
}

describe("trip profiles", () => {
    let storage: ReturnType<typeof createLocalStorageStub>;

    beforeEach(() => {
        storage = createLocalStorageStub();
        vi.stubGlobal("localStorage", storage);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    describe("tripNameFromYaml", () => {
        it("reads trip.name", () => {
            expect(tripNameFromYaml(yamlNamed("東京五日"))).toBe("東京五日");
        });
        it("trims surrounding whitespace", () => {
            expect(tripNameFromYaml("trip:\n  name: '  首爾  '\n")).toBe("首爾");
        });
        it("falls back for malformed YAML", () => {
            expect(tripNameFromYaml("trip: [unclosed")).toBe("未命名行程");
        });
        it("falls back when trip.name is missing", () => {
            expect(tripNameFromYaml("trip:\n  start: '2026-06-11'\n")).toBe("未命名行程");
        });
    });

    describe("ensureActiveProfileId", () => {
        it("assigns an id once and is then idempotent", () => {
            const id = ensureActiveProfileId();
            expect(id).toBeTruthy();
            expect(ensureActiveProfileId()).toBe(id);
            expect(getActiveProfileId()).toBe(id);
        });
    });

    describe("createProfile", () => {
        it("parks the current active trip and makes the new YAML active", () => {
            storage.setItem(USER_YAML_KEY, yamlNamed("行程A"));
            const firstId = ensureActiveProfileId();

            const newId = createProfile(yamlNamed("行程B"));

            // The new trip is now the active one.
            expect(storage.getItem(USER_YAML_KEY)).toBe(yamlNamed("行程B"));
            expect(getActiveProfileId()).toBe(newId);
            expect(newId).not.toBe(firstId);

            // The previous active trip is parked under its original id.
            const parked = listProfiles();
            expect(parked).toHaveLength(1);
            expect(parked[0].id).toBe(firstId);
            expect(parked[0].name).toBe("行程A");
        });
    });

    describe("switchToProfile", () => {
        it("swaps the active trip with the chosen parked profile", () => {
            storage.setItem(USER_YAML_KEY, yamlNamed("行程A"));
            const idA = ensureActiveProfileId();
            createProfile(yamlNamed("行程B")); // parks A, B active
            const idB = getActiveProfileId();

            // A is the only parked profile; switch back to it.
            const parkedBefore = listProfiles();
            expect(parkedBefore).toHaveLength(1);
            switchToProfile(idA);

            // A is active again with its YAML restored.
            expect(getActiveProfileId()).toBe(idA);
            expect(storage.getItem(USER_YAML_KEY)).toBe(yamlNamed("行程A"));

            // B is now the parked one (it was pushed down on the way out).
            const parkedAfter = listProfiles();
            expect(parkedAfter).toHaveLength(1);
            expect(parkedAfter[0].id).toBe(idB);
            expect(parkedAfter[0].name).toBe("行程B");
        });

        it("throws on an unknown profile id and leaves storage untouched", () => {
            storage.setItem(USER_YAML_KEY, yamlNamed("行程A"));
            ensureActiveProfileId();
            expect(() => switchToProfile("nope")).toThrow();
            expect(storage.getItem(USER_YAML_KEY)).toBe(yamlNamed("行程A"));
        });
    });

    describe("deleteProfile", () => {
        it("removes a parked profile without touching the active trip", () => {
            storage.setItem(USER_YAML_KEY, yamlNamed("行程A"));
            const idA = ensureActiveProfileId();
            createProfile(yamlNamed("行程B")); // parks A
            const activeId = getActiveProfileId();

            deleteProfile(idA);

            expect(listProfiles()).toHaveLength(0);
            // Active trip is unaffected.
            expect(getActiveProfileId()).toBe(activeId);
            expect(storage.getItem(USER_YAML_KEY)).toBe(yamlNamed("行程B"));
        });
    });

    describe("storage keys", () => {
        it("persists profiles and the active id under the documented keys", () => {
            storage.setItem(USER_YAML_KEY, yamlNamed("行程A"));
            ensureActiveProfileId();
            createProfile(yamlNamed("行程B"));
            expect(storage.getItem(ACTIVE_PROFILE_KEY)).toBeTruthy();
            expect(JSON.parse(storage.getItem(PROFILES_KEY) ?? "[]")).toHaveLength(1);
        });
    });
});
