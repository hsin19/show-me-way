// Where a whole trip arriving on this device lands. It carries its own identity, `trip.id`,
// while every slot still wears the Drive binding and share link of the trip already in it —
// so an arrival is matched to a slot by that id instead of being written over the active
// one, which would hand it the outgoing trip's cloud file and the audience of its link.
// The one decision every such arrival goes through: the caller supplies the words for the
// questions and whatever follows the landing, never where it lands.

import {
    genTripId,
    serializeToYaml,
    type TripData,
    validateYaml,
} from "$lib/domain/trip";
import { appStorage } from "$lib/infra/storage/app-storage";
import {
    findLocalTripByTripId,
    getActiveProfileId,
    switchToProfile,
} from "$lib/infra/storage/profiles";
import { USER_YAML_KEY } from "$lib/infra/storage/yaml-storage";
import {
    addTrip,
    writeActiveTrip,
} from "./save-trip";

/** What `placeTrip` needs the user to decide; the caller puts it into words for its own source. */
export type PlaceQuestion =
    /** This device holds another version of the same trip, `name` — the active one or a parked one. Replace it? */
    | { kind: "replace"; name: string; active: boolean; }
    /** Asked once the replacement was turned down: keep both, the arrival as a copy? */
    | { kind: "copy"; }
    /** A trip this device does not hold, while another one is active. Add it as a trip of its own? */
    | { kind: "add"; };

export type Placement =
    /** Replaced this device's copy of that same trip, keeping its slot, id and Drive binding. */
    | { kind: "replaced"; profileId: string; yaml: string; }
    /** Exactly the version this device already holds; switched to it, wrote nothing. */
    | { kind: "unchanged"; profileId: string; }
    /**
     * Landed as a trip of its own, with the previously active one parked. `copy` when it had
     * to be re-identified to sit beside the trip it came from, which makes it no longer that
     * trip: nothing that follows the original — its cloud file, its link — may follow this.
     */
    | { kind: "added"; profileId: string; yaml: string; copy: boolean; }
    /** The user turned down every offer; nothing was written. */
    | { kind: "declined"; }
    /** Did not validate; nothing was written. */
    | { kind: "invalid"; error: string; };

/**
 * Land `yaml`, asking before anything is replaced or added. Writes storage, so the caller
 * only has to reload and report; a storage failure throws, with no trip lost.
 *
 * `profileId` names the slot the trip now occupies — pass it, not whatever id the caller
 * captured earlier, to anything keyed by trip: a placement can move the active slot, so a
 * stale id would bind the new trip to the old one's cloud file.
 */
export function placeTrip(yaml: string, ask: (question: PlaceQuestion) => boolean): Placement {
    let incoming: TripData;
    try {
        incoming = validateYaml(yaml);
    } catch (err) {
        return { kind: "invalid", error: err instanceof Error ? err.message : "YAML 格式錯誤，請檢查縮排！" };
    }
    let copy = false;
    // Same id means the same trip, not a similar one, so replacing this device's copy is a
    // real option — and usually the wanted one. A copy stays available behind it for the
    // case where the two are meant to diverge from here.
    const existing = findLocalTripByTripId(incoming.trip.id);
    if (existing !== null) {
        // A persistent link is reopened to pick up updates, so the common case is that
        // nothing changed since last time — asking to replace it with identical content
        // would only teach the user to dismiss the prompt. Storage holds only canonical
        // bytes, so comparing against the arrival's canonical form judges content alone.
        if (existing.yaml === serializeToYaml(incoming)) {
            if (existing.profileId !== getActiveProfileId()) switchToProfile(existing.profileId);
            return { kind: "unchanged", profileId: existing.profileId };
        }
        const active = existing.profileId === getActiveProfileId();
        if (ask({ kind: "replace", name: incoming.trip.name, active })) {
            // Switching first is both what the user asked for and what puts the copy being
            // replaced in the backup ring, rather than whichever trip happened to be active.
            if (!active) switchToProfile(existing.profileId);
            return { kind: "replaced", ...writeActiveTrip(incoming, { backup: true }) };
        }
        if (!ask({ kind: "copy" })) return { kind: "declined" };
        // Two trips sharing an id would fight over one Drive file.
        incoming.trip.id = genTripId();
        copy = true;
    } else if (appStorage.get(USER_YAML_KEY) && !ask({ kind: "add" })) {
        return { kind: "declined" };
    }
    return { kind: "added", ...addTrip(incoming), copy };
}
