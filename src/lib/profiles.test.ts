import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from "vitest";
import {
    serializeToYaml,
    USER_YAML_KEY,
    validateYaml,
} from "./api";
import {
    ACTIVE_PROFILE_KEY,
    createProfile,
    deleteProfile,
    ensureActiveProfileId,
    ensureUniqueTripId,
    getActiveProfileId,
    listProfiles,
    PROFILES_KEY,
    switchToProfile,
    tripIdFromYaml,
    tripNameFromYaml,
    tripStartDateFromYaml,
} from "./profiles";

// Minimal YAML carrying just a trip.name — tripNameFromYaml parses the raw YAML
// directly (no full-structure validation), so this is all the swap logic needs.
function yamlNamed(name: string): string {
    return `trip:\n  name: '${name}'\n`;
}

/** A full trip the way one reaches storage: validated, then serialized. */
function savedYaml(id?: string): string {
    const source = [
        "trip:",
        "  name: '東京'",
        ...(id ? [`  id: '${id}'`] : []),
        "  hotels: []",
        "days:",
        "  - date: '2026-10-01'",
        "    title: '市區'",
        "    timeline: []",
    ].join("\n");
    return serializeToYaml(validateYaml(source));
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

    describe("tripStartDateFromYaml", () => {
        it("reads start date from days[0].date", () => {
            expect(tripStartDateFromYaml("days:\n  - date: '2026-06-11'\n")).toBe("2026-06-11");
        });
        it("reads start date from trip.start fallback", () => {
            expect(tripStartDateFromYaml("trip:\n  start: '2025-10-01'\n")).toBe("2025-10-01");
        });
        it("returns null when no date is present", () => {
            expect(tripStartDateFromYaml("trip:\n  name: '東京'\n")).toBeNull();
            expect(tripStartDateFromYaml("invalid: [yaml")).toBeNull();
        });
    });

    describe("tripIdFromYaml", () => {
        it("reads the id out of raw YAML without normalizing it", () => {
            expect(tripIdFromYaml(savedYaml("t-1"))).toBe("t-1");
        });

        it("reports the gap rather than filling it", () => {
            // Only `normalizeTripData` mints, so a reader must never invent one on the side.
            expect(tripIdFromYaml(yamlNamed("東京"))).toBeNull();
            expect(tripIdFromYaml("not: [valid")).toBeNull();
        });
    });

    describe("ensureUniqueTripId", () => {
        it("keeps the id of a trip this device does not hold", () => {
            storage.setItem(USER_YAML_KEY, savedYaml("t-mine"));
            const incoming = validateYaml(savedYaml("t-theirs"));

            expect(ensureUniqueTripId(incoming)).toBe(false);
            // Keeping it is the whole point: it is what lets two devices recognise one
            // Drive file as the same trip.
            expect(incoming.trip.id).toBe("t-theirs");
        });

        it("re-mints when the active trip is already that trip", () => {
            storage.setItem(USER_YAML_KEY, savedYaml("t-1"));
            const incoming = validateYaml(savedYaml("t-1"));

            expect(ensureUniqueTripId(incoming)).toBe(true);
            expect(incoming.trip.id).not.toBe("t-1");
            expect(incoming.trip.id).toBeTruthy();
        });

        it("re-mints when a parked profile is already that trip", () => {
            storage.setItem(USER_YAML_KEY, savedYaml("t-active"));
            storage.setItem(
                PROFILES_KEY,
                JSON.stringify([{ id: "p-1", yaml: savedYaml("t-parked"), savedAt: "2026-08-01T00:00:00Z" }]),
            );
            const incoming = validateYaml(savedYaml("t-parked"));

            expect(ensureUniqueTripId(incoming)).toBe(true);
            expect(incoming.trip.id).not.toBe("t-parked");
        });

        it("survives storage holding trips written before ids existed", () => {
            storage.setItem(USER_YAML_KEY, yamlNamed("東京"));
            const incoming = validateYaml(savedYaml("t-1"));

            expect(ensureUniqueTripId(incoming)).toBe(false);
            expect(incoming.trip.id).toBe("t-1");
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
