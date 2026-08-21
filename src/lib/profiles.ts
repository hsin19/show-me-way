// The active trip deliberately stays in USER_YAML_KEY, with the others parked as
// snapshots in PROFILES_KEY, so multi-trip support left every existing read/write
// path untouched. Unlike the backup ring this list is user-managed and never
// auto-evicted. Only the itinerary travels with a profile — per-trip state outside
// the YAML (the ledger's working rate, say) is not swapped.

import {
    parseYaml,
    type TripData,
    USER_YAML_KEY,
} from "./api";

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
}

function genProfileId(): string {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
        return crypto.randomUUID();
    }
    return `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Newest first. Unreadable or malformed storage yields []. */
function readStoredProfiles(): StoredProfile[] {
    try {
        const raw = localStorage.getItem(PROFILES_KEY);
        if (!raw) return [];
        const parsed: unknown = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];
        return parsed.filter((p): p is StoredProfile =>
            !!p && typeof p === "object"
            && typeof (p as StoredProfile).id === "string"
            && typeof (p as StoredProfile).yaml === "string"
            && typeof (p as StoredProfile).savedAt === "string"
        );
    } catch {
        return [];
    }
}

function writeStoredProfiles(list: StoredProfile[]): void {
    localStorage.setItem(PROFILES_KEY, JSON.stringify(list));
}

export function getActiveProfileId(): string | null {
    return localStorage.getItem(ACTIVE_PROFILE_KEY);
}

/** The active trip's id, minted and persisted on first call (an install predating profiles has none). */
export function ensureActiveProfileId(): string {
    let id = getActiveProfileId();
    if (!id) {
        id = genProfileId();
        localStorage.setItem(ACTIVE_PROFILE_KEY, id);
    }
    return id;
}

/** Display label for a stored trip. Falls back to 未命名行程 rather than throwing, so an unparseable profile is still listable. */
export function tripNameFromYaml(yaml: string): string {
    try {
        const data = parseYaml(yaml) as Partial<TripData> | null;
        const name = data?.trip?.name;
        if (typeof name === "string" && name.trim()) return name.trim();
    } catch {
        // fall through to the placeholder
    }
    return "未命名行程";
}

/** Parked trips only, newest first — the active one lives in USER_YAML_KEY. */
export function listProfiles(): ProfileInfo[] {
    return readStoredProfiles().map(p => ({
        id: p.id,
        name: tripNameFromYaml(p.yaml),
        savedAt: p.savedAt,
    }));
}

/**
 * Make a parked trip the active one and park the current trip in its place.
 * Whatever sits in USER_YAML_KEY is what gets parked, so the caller must persist
 * the live trip first, and must reload trip data afterwards. Throws if `targetId`
 * is unknown.
 */
export function switchToProfile(targetId: string): void {
    const list = readStoredProfiles();
    const target = list.find(p => p.id === targetId);
    if (!target) throw new Error("找不到要切換的行程");
    const activeId = ensureActiveProfileId();
    const activeYaml = localStorage.getItem(USER_YAML_KEY);
    const rest = list.filter(p => p.id !== targetId);
    if (activeYaml != null) {
        rest.unshift({ id: activeId, yaml: activeYaml, savedAt: new Date().toISOString() });
    }
    writeStoredProfiles(rest);
    localStorage.setItem(USER_YAML_KEY, target.yaml);
    localStorage.setItem(ACTIVE_PROFILE_KEY, target.id);
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
    const id = genProfileId();
    localStorage.setItem(USER_YAML_KEY, yaml);
    localStorage.setItem(ACTIVE_PROFILE_KEY, id);
    return id;
}

/** Parked profiles only; the active trip is not in this list and cannot be deleted here. */
export function deleteProfile(id: string): void {
    writeStoredProfiles(readStoredProfiles().filter(p => p.id !== id));
}
