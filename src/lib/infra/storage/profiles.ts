// The active trip deliberately stays in USER_YAML_KEY, with the others parked as
// snapshots in PROFILES_KEY, so multi-trip support left every existing read/write
// path untouched. Unlike the backup ring this list is user-managed and never
// auto-evicted. Only the itinerary travels with a profile — per-trip state outside
// the YAML (the ledger's working rate, say) is not swapped.

import {
    genTripId,
    parseYaml,
    type TripData,
} from "$lib/domain/trip";
import {
    readJsonArray,
    USER_YAML_KEY,
} from "./yaml-storage";

export const PROFILES_KEY = "showmeway_profiles";
export const ACTIVE_PROFILE_KEY = "showmeway_active_profile";

interface StoredProfile {
    id: string;
    yaml: string;
    savedAt: string; // ISO date-time the trip was last parked
}

export interface ProfileInfo {
    id: string;
    /** Derived from the stored YAML on every read, so it cannot go stale against a renamed trip. */
    name: string;
    savedAt: string;
    startDate?: string;
}

/** Newest first. Unreadable or malformed storage yields []. */
function readStoredProfiles(): StoredProfile[] {
    return readJsonArray(PROFILES_KEY, (p): p is StoredProfile =>
        !!p && typeof p === "object"
        && typeof (p as StoredProfile).id === "string"
        && typeof (p as StoredProfile).yaml === "string"
        && typeof (p as StoredProfile).savedAt === "string");
}

function writeStoredProfiles(list: StoredProfile[]): void {
    localStorage.setItem(PROFILES_KEY, JSON.stringify(list));
}

export function getActiveProfileId(): string | null {
    return localStorage.getItem(ACTIVE_PROFILE_KEY);
}

/**
 * Whether `id` is still the active trip. For guarding a callback that resolves after an
 * await (an undo toast, a pulled sync result) against writing over a trip the user has
 * since switched away from — those closures keep running after their owning component
 * unmounts, so nothing else stops them from persisting against the wrong trip.
 */
export function isActiveProfile(id: string): boolean {
    return getActiveProfileId() === id;
}

/** The active trip's id, minted and persisted on first call (an install predating profiles has none). */
export function ensureActiveProfileId(): string {
    let id = getActiveProfileId();
    if (!id) {
        id = genTripId();
        localStorage.setItem(ACTIVE_PROFILE_KEY, id);
    }
    return id;
}

function nameFromParsed(data: Partial<TripData> | null): string {
    const name = data?.trip?.name;
    if (typeof name === "string" && name.trim()) return name.trim();
    return "未命名行程";
}

/**
 * Takes the earliest `days[].date` rather than the first listed one: `normalizeTripData`
 * sorts before every save, so persisted trips are already in order, but an unsaved editor
 * draft is not — and this value becomes a sort key and the Drive file's `startDate`.
 */
function startDateFromParsed(data: Partial<TripData> | null): string | null {
    if (data?.days && Array.isArray(data.days) && data.days.length > 0) {
        const dates = data.days
            .map(day => day?.date)
            .filter((date): date is string => typeof date === "string" && !!date.trim())
            .map(date => date.trim());
        if (dates.length > 0) {
            return dates.reduce((earliest, date) => (date < earliest ? date : earliest));
        }
    }
    if (data?.trip && typeof (data.trip as { start?: string; }).start === "string") {
        return (data.trip as { start: string; }).start.trim();
    }
    return null;
}

/** Display label for a stored trip. Falls back to 未命名行程 rather than throwing, so an unparseable profile is still listable. */
export function tripNameFromYaml(yaml: string): string {
    try {
        return nameFromParsed(parseYaml(yaml) as Partial<TripData> | null);
    } catch {
        return "未命名行程";
    }
}

/** The trip's first day, read straight from raw YAML without normalizing it. */
export function tripStartDateFromYaml(yaml: string): string | null {
    try {
        return startDateFromParsed(parseYaml(yaml) as Partial<TripData> | null);
    } catch {
        return null;
    }
}

/**
 * The trip's own id, read straight from raw YAML. Null for a document written before ids
 * existed — `normalizeTripData` mints one the next time it is loaded, so this only ever
 * reports the gap, never fills it.
 */
export function tripIdFromYaml(yaml: string): string | null {
    try {
        const id = (parseYaml(yaml) as Partial<TripData> | null)?.trip?.id;
        return typeof id === "string" && id.trim() ? id.trim() : null;
    } catch {
        return null;
    }
}

/**
 * Every trip on this device, the active one first: the profile slot holding it and its
 * raw YAML. For work that has to reach across all of them at once — matching them against
 * a cloud listing, say — rather than only the parked ones `listProfiles` reports.
 *
 * Mints the active profile id if this install never had one, since a caller keying
 * anything by slot needs it to exist.
 */
export function listLocalTrips(): { profileId: string; yaml: string; }[] {
    const activeYaml = localStorage.getItem(USER_YAML_KEY);
    return [
        ...(activeYaml == null ? [] : [{ profileId: ensureActiveProfileId(), yaml: activeYaml }]),
        ...readStoredProfiles().map(p => ({ profileId: p.id, yaml: p.yaml })),
    ];
}

/**
 * The profile slot holding the trip with this id, or null. A slot rather than the trip
 * itself, because that is what everything else here — switching, parking, the Drive
 * binding — is keyed by.
 */
export function findProfileByTripId(tripId: string): string | null {
    return listLocalTrips().find(trip => tripIdFromYaml(trip.yaml) === tripId)?.profileId ?? null;
}

/**
 * Re-mint `data.trip.id` if this device already holds that trip, and report whether it
 * did. An imported copy keeps its identity by default — that is what lets two devices
 * recognise the same trip in Drive — so this is only about the one case where keeping it
 * would be wrong: importing a trip alongside the copy it came from, where the two are
 * separate trips from here on and must not compete for one cloud file.
 *
 * Mutates `data` in place, so call it before serializing.
 */
export function ensureUniqueTripId(data: TripData): boolean {
    if (findProfileByTripId(data.trip.id) === null) return false;
    data.trip.id = genTripId();
    return true;
}

/** Parked trips only, newest first — the active one lives in USER_YAML_KEY. */
export function listProfiles(): ProfileInfo[] {
    return readStoredProfiles().map(p => {
        let data: Partial<TripData> | null = null;
        try {
            data = parseYaml(p.yaml) as Partial<TripData> | null;
        } catch {
            // fall through to defaults below
        }
        return {
            id: p.id,
            name: nameFromParsed(data),
            savedAt: p.savedAt,
            startDate: startDateFromParsed(data) ?? undefined,
        };
    });
}

/**
 * Make a parked trip the active one and park the current trip in its place.
 * Whatever sits in USER_YAML_KEY is what gets parked, so the caller must persist
 * the live trip first, and must reload trip data afterwards. Throws if `targetId`
 * is unknown, or if storage refuses a write — in which case no trip has been lost.
 */
export function switchToProfile(targetId: string): void {
    const list = readStoredProfiles();
    const target = list.find(p => p.id === targetId);
    if (!target) throw new Error("找不到要切換的行程");
    const activeId = ensureActiveProfileId();
    const activeYaml = localStorage.getItem(USER_YAML_KEY);
    // The target stays in the parked list until the active slot holds it: a quota
    // failure on any write then leaves a trip duplicated, never missing. Removing it
    // first and failing on the next write left the target in no key at all.
    const parked = activeYaml != null
        ? [{ id: activeId, yaml: activeYaml, savedAt: new Date().toISOString() }, ...list]
        : list;
    writeStoredProfiles(parked);
    localStorage.setItem(USER_YAML_KEY, target.yaml);
    localStorage.setItem(ACTIVE_PROFILE_KEY, target.id);
    writeStoredProfiles(parked.filter(p => p.id !== targetId));
}

/** Start a new trip from `yaml`, parking the current one. Same caller contract as `switchToProfile`; returns the new profile's id. */
export function createProfile(yaml: string): string {
    const activeId = ensureActiveProfileId();
    const activeYaml = localStorage.getItem(USER_YAML_KEY);
    if (activeYaml != null) {
        const list = readStoredProfiles();
        list.unshift({ id: activeId, yaml: activeYaml, savedAt: new Date().toISOString() });
        writeStoredProfiles(list);
    }
    const id = genTripId();
    localStorage.setItem(USER_YAML_KEY, yaml);
    localStorage.setItem(ACTIVE_PROFILE_KEY, id);
    return id;
}

/** Parked profiles only; the active trip is not in this list and cannot be deleted here. */
export function deleteProfile(id: string): void {
    writeStoredProfiles(readStoredProfiles().filter(p => p.id !== id));
}
