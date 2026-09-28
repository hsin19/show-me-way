import { createLocalStorageStub } from "$lib/testing/stubs";
// The branching an arriving trip goes through before anything is written. The property
// under test throughout is that the incoming trip never silently inherits the outgoing
// one's identity — that is what binds a stranger's trip to this device's Drive file.

import {
    serializeToYaml,
    validateYaml,
} from "$lib/domain/trip";
import { appStorage } from "$lib/infra/storage/app-storage";
import {
    ACTIVE_PROFILE_KEY,
    getActiveProfileId,
    listProfiles,
    tripIdFromYaml,
} from "$lib/infra/storage/profiles";
import {
    listYamlBackups,
    USER_YAML_KEY,
} from "$lib/infra/storage/yaml-storage";
import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from "vitest";
import {
    type PlaceQuestion,
    placeTrip,
} from "./place-trip";

function tripYaml(name: string, id?: string): string {
    return [
        "trip:",
        `  name: '${name}'`,
        ...(id ? [`  id: '${id}'`] : []),
        "  hotels: []",
        "days:",
        "  - date: '2026-10-01'",
        "    title: '市區'",
        "    timeline: []",
    ].join("\n");
}

/** Seeds an active trip the way one actually reaches storage. */
function seedActive(name: string, id: string, profileId = "p-active"): void {
    appStorage.set(USER_YAML_KEY, serializeToYaml(validateYaml(tripYaml(name, id))));
    appStorage.set(ACTIVE_PROFILE_KEY, profileId);
}

const yes = () => true;
const no = () => false;

describe("placeTrip", () => {
    beforeEach(() => {
        vi.stubGlobal("localStorage", createLocalStorageStub());
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    // After a reset the slot keeps its id; staying in it is what lets the editor's cloud
    // button go on to upload what was just saved there.
    it("lands straight into an empty slot without asking, keeping the slot", () => {
        appStorage.set(ACTIVE_PROFILE_KEY, "p-empty");
        const ask = vi.fn(yes);

        const outcome = placeTrip(tripYaml("東京", "t-tokyo"), ask);

        expect(outcome).toMatchObject({ kind: "added", profileId: "p-empty", copy: false });
        expect(ask).not.toHaveBeenCalled();
        expect(tripIdFromYaml(appStorage.get(USER_YAML_KEY)!)).toBe("t-tokyo");
        expect(listProfiles()).toEqual([]);
    });

    it("parks the current trip rather than overwriting it when the arrival is a different trip", () => {
        seedActive("京都", "t-kyoto");
        const ask = vi.fn(yes);

        const outcome = placeTrip(tripYaml("東京", "t-tokyo"), ask);

        expect(ask).toHaveBeenCalledExactlyOnceWith({ kind: "add" } satisfies PlaceQuestion);
        expect(outcome).toMatchObject({ kind: "added", copy: false });
        expect(listProfiles().map(p => p.name)).toEqual(["京都"]);
        if (outcome.kind !== "added") throw new Error("expected an addition");
        expect(getActiveProfileId()).not.toBe("p-active");
        expect(getActiveProfileId()).toBe(outcome.profileId);
    });

    it("writes nothing when the user declines the addition", () => {
        seedActive("京都", "t-kyoto");
        const before = appStorage.get(USER_YAML_KEY);

        expect(placeTrip(tripYaml("東京", "t-tokyo"), no).kind).toBe("declined");

        expect(appStorage.get(USER_YAML_KEY)).toBe(before);
        expect(listProfiles()).toEqual([]);
    });

    it("writes nothing when the arrival does not validate", () => {
        seedActive("京都", "t-kyoto");
        const before = appStorage.get(USER_YAML_KEY);
        const ask = vi.fn(yes);

        expect(placeTrip("trip: [", ask).kind).toBe("invalid");

        expect(ask).not.toHaveBeenCalled();
        expect(appStorage.get(USER_YAML_KEY)).toBe(before);
    });

    it("replaces the device's own copy in place, keeping the slot that holds its Drive binding", () => {
        seedActive("東京", "t-tokyo");
        const ask = vi.fn(yes);

        const outcome = placeTrip(tripYaml("東京改", "t-tokyo"), ask);

        expect(ask).toHaveBeenCalledExactlyOnceWith({ kind: "replace", name: "東京改", active: true } satisfies PlaceQuestion);
        expect(outcome).toMatchObject({ kind: "replaced", profileId: "p-active" });
        // Same slot and same id, so the binding still names the file this trip came from.
        expect(getActiveProfileId()).toBe("p-active");
        expect(tripIdFromYaml(appStorage.get(USER_YAML_KEY)!)).toBe("t-tokyo");
        expect(listProfiles()).toEqual([]);
        // Recoverable: the copy it replaced went into the backup ring first.
        expect(listYamlBackups().length).toBe(1);
    });

    it("switches to the trip being replaced when the arrival names a parked one", () => {
        seedActive("京都", "t-kyoto");
        placeTrip(tripYaml("東京", "t-tokyo"), yes);
        const tokyoSlot = getActiveProfileId();
        // Park Tokyo again, so the arrival targets a parked trip.
        placeTrip(tripYaml("大阪", "t-osaka"), yes);

        const outcome = placeTrip(tripYaml("東京改", "t-tokyo"), yes);

        expect(outcome).toMatchObject({ kind: "replaced", profileId: tokyoSlot });
        expect(getActiveProfileId()).toBe(tokyoSlot);
        expect(tripIdFromYaml(appStorage.get(USER_YAML_KEY)!)).toBe("t-tokyo");
    });

    it("gives a copy its own identity when the user keeps both", () => {
        // Two trips sharing an id would compete for one Drive file.
        seedActive("東京", "t-tokyo");
        const ask = vi.fn((question: PlaceQuestion) => question.kind === "copy");

        const outcome = placeTrip(tripYaml("東京改", "t-tokyo"), ask);

        expect(outcome).toMatchObject({ kind: "added", copy: true });
        expect(tripIdFromYaml(appStorage.get(USER_YAML_KEY)!)).not.toBe("t-tokyo");
        expect(listProfiles().length).toBe(1);
    });

    // A persistent link gets reopened to check for updates, so "nothing changed" is the
    // common case — and a replace prompt for identical content only teaches dismissal.
    it("asks nothing and writes nothing when the arrival is the version already held", () => {
        seedActive("東京", "t-tokyo");
        const before = appStorage.get(USER_YAML_KEY);
        const ask = vi.fn(yes);

        const outcome = placeTrip(tripYaml("東京", "t-tokyo"), ask);

        expect(outcome).toEqual({ kind: "unchanged", profileId: "p-active" });
        expect(ask).not.toHaveBeenCalled();
        expect(appStorage.get(USER_YAML_KEY)).toBe(before);
        expect(listYamlBackups()).toEqual([]);
    });

    it("switches to a parked trip the arrival turns out to match exactly", () => {
        seedActive("京都", "t-kyoto");
        placeTrip(tripYaml("東京", "t-tokyo"), yes);
        const tokyoSlot = getActiveProfileId();
        placeTrip(tripYaml("大阪", "t-osaka"), yes);

        const outcome = placeTrip(tripYaml("東京", "t-tokyo"), yes);

        expect(outcome).toEqual({ kind: "unchanged", profileId: tokyoSlot });
        expect(getActiveProfileId()).toBe(tokyoSlot);
        expect(tripIdFromYaml(appStorage.get(USER_YAML_KEY)!)).toBe("t-tokyo");
    });

    it("writes nothing when the user declines both the replacement and the copy", () => {
        seedActive("東京", "t-tokyo");
        const before = appStorage.get(USER_YAML_KEY);

        expect(placeTrip(tripYaml("東京改", "t-tokyo"), no).kind).toBe("declined");

        expect(appStorage.get(USER_YAML_KEY)).toBe(before);
        expect(listProfiles()).toEqual([]);
    });

    it("canonicalizes what it stores, so a hand-edited arrival cannot persist runtime fields", () => {
        const outcome = placeTrip(tripYaml("東京", "t-tokyo"), yes);

        if (outcome.kind !== "added") throw new Error("expected a write");
        expect(outcome.yaml).toBe(appStorage.get(USER_YAML_KEY));
        expect(outcome.yaml).toContain("$schema");
    });
});
