// The branching a share link goes through before anything is written. Both entry points
// (the `#s=` hash on startup, and pasting the link into the YAML editor) run this, and the
// property under test throughout is that the incoming trip never silently inherits the
// outgoing one's identity — that is what binds a stranger's trip to this device's Drive file.

import {
    serializeToYaml,
    type TripData,
    validateYaml,
} from "$lib/domain/trip";
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
    getActiveProfileId,
    listProfiles,
    tripIdFromYaml,
} from "./profiles";
import { importSharedTrip } from "./share-import";
import {
    listYamlBackups,
    USER_YAML_KEY,
} from "./yaml-storage";

function createLocalStorageStub() {
    const store = new Map<string, string>();
    return {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => void store.set(key, value),
        removeItem: (key: string) => void store.delete(key),
        clear: () => store.clear(),
    };
}

function trip(name: string, id?: string): TripData {
    return validateYaml([
        "trip:",
        `  name: '${name}'`,
        ...(id ? [`  id: '${id}'`] : []),
        "  hotels: []",
        "days:",
        "  - date: '2026-10-01'",
        "    title: '市區'",
        "    timeline: []",
    ].join("\n"));
}

/** Seeds an active trip the way one actually reaches storage. */
function seedActive(name: string, id: string, profileId = "p-active"): void {
    localStorage.setItem(USER_YAML_KEY, serializeToYaml(trip(name, id)));
    localStorage.setItem(ACTIVE_PROFILE_KEY, profileId);
}

describe("importSharedTrip", () => {
    let storage: ReturnType<typeof createLocalStorageStub>;

    beforeEach(() => {
        storage = createLocalStorageStub();
        vi.stubGlobal("localStorage", storage);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it("lands straight into an empty install without asking", () => {
        const ask = vi.fn(() => true);
        vi.stubGlobal("confirm", ask);

        const outcome = importSharedTrip(trip("東京", "t-tokyo"));

        expect(outcome.kind).toBe("imported");
        expect(ask).not.toHaveBeenCalled();
        expect(tripIdFromYaml(storage.getItem(USER_YAML_KEY)!)).toBe("t-tokyo");
    });

    it("parks the current trip rather than overwriting it when the link is a different trip", () => {
        seedActive("京都", "t-kyoto");
        vi.stubGlobal("confirm", vi.fn(() => true));

        const outcome = importSharedTrip(trip("東京", "t-tokyo"));

        expect(outcome.kind).toBe("imported");
        expect(listProfiles().map(p => p.name)).toEqual(["京都"]);
        expect(getActiveProfileId()).not.toBe("p-active");
        if (outcome.kind !== "imported") throw new Error("expected an import");
        expect(getActiveProfileId()).toBe(outcome.profileId);
    });

    it("writes nothing when the user declines the import", () => {
        seedActive("京都", "t-kyoto");
        const before = storage.getItem(USER_YAML_KEY);
        vi.stubGlobal("confirm", vi.fn(() => false));

        expect(importSharedTrip(trip("東京", "t-tokyo")).kind).toBe("declined");

        expect(storage.getItem(USER_YAML_KEY)).toBe(before);
        expect(listProfiles()).toEqual([]);
    });

    it("replaces the device's own copy in place, keeping the slot that holds its Drive binding", () => {
        seedActive("東京", "t-tokyo");
        vi.stubGlobal("confirm", vi.fn(() => true));

        const outcome = importSharedTrip(trip("東京改", "t-tokyo"));

        expect(outcome).toMatchObject({ kind: "overwritten", profileId: "p-active" });
        // Same slot and same id, so the binding still names the file this trip came from.
        expect(getActiveProfileId()).toBe("p-active");
        expect(tripIdFromYaml(storage.getItem(USER_YAML_KEY)!)).toBe("t-tokyo");
        expect(listProfiles()).toEqual([]);
        // Recoverable: the copy it replaced went into the backup ring first.
        expect(listYamlBackups().length).toBe(1);
    });

    it("switches to the trip being replaced when the link names a parked one", () => {
        seedActive("京都", "t-kyoto");
        vi.stubGlobal("confirm", vi.fn(() => true));
        importSharedTrip(trip("東京", "t-tokyo"));
        const tokyoSlot = getActiveProfileId();
        // Park Tokyo again by making Kyoto active, so the incoming link targets a parked trip.
        importSharedTrip(trip("大阪", "t-osaka"));

        const outcome = importSharedTrip(trip("東京改", "t-tokyo"));

        expect(outcome).toMatchObject({ kind: "overwritten", profileId: tokyoSlot });
        expect(getActiveProfileId()).toBe(tokyoSlot);
        expect(tripIdFromYaml(storage.getItem(USER_YAML_KEY)!)).toBe("t-tokyo");
    });

    it("gives a copy its own identity when the user keeps both", () => {
        // Two trips sharing an id would compete for one Drive file.
        seedActive("東京", "t-tokyo");
        // Declines the overwrite, accepts the copy.
        vi.stubGlobal("confirm", vi.fn().mockReturnValueOnce(false).mockReturnValue(true));

        const outcome = importSharedTrip(trip("東京", "t-tokyo"));

        expect(outcome.kind).toBe("imported");
        expect(tripIdFromYaml(storage.getItem(USER_YAML_KEY)!)).not.toBe("t-tokyo");
        expect(listProfiles().length).toBe(1);
    });

    it("writes nothing when the user declines both the overwrite and the copy", () => {
        seedActive("東京", "t-tokyo");
        const before = storage.getItem(USER_YAML_KEY);
        vi.stubGlobal("confirm", vi.fn(() => false));

        expect(importSharedTrip(trip("東京改", "t-tokyo")).kind).toBe("declined");

        expect(storage.getItem(USER_YAML_KEY)).toBe(before);
        expect(listProfiles()).toEqual([]);
    });

    it("canonicalizes what it stores, so a hand-edited link cannot persist runtime fields", () => {
        vi.stubGlobal("confirm", vi.fn(() => true));

        const outcome = importSharedTrip(trip("東京", "t-tokyo"));

        if (outcome.kind === "declined") throw new Error("expected a write");
        expect(outcome.yaml).toBe(storage.getItem(USER_YAML_KEY));
        expect(outcome.yaml).toContain("$schema");
    });
});
