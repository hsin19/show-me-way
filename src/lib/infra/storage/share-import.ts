// Landing a shared trip is branching on identity, not writing bytes into the active slot:
// a link carries a whole trip, `trip.id` included, and the slot it would land in is still
// wearing the outgoing trip's Drive binding. Shared by the `#s=` hash on startup and by
// pasting the link into the YAML editor — the two used to disagree, and the editor's copy
// was the one that overwrote a stranger's cloud file.

import {
    serializeToYaml,
    type TripData,
    validateYaml,
} from "$lib/domain/trip";
import {
    createProfile,
    ensureUniqueTripId,
    findLocalTripByTripId,
    getActiveProfileId,
    switchToProfile,
} from "./profiles";
import {
    backupCurrentYaml,
    saveTripData,
    USER_YAML_KEY,
} from "./yaml-storage";

export type ShareImportOutcome =
    /** Replaced this device's copy of that same trip, keeping its profile slot, id, and Drive binding. */
    | { kind: "overwritten"; profileId: string; yaml: string; }
    /** The link carries exactly the version this device already holds; switched to it, wrote nothing. */
    | { kind: "unchanged"; profileId: string; }
    /** Landed as a trip of its own, with the previously active one parked. */
    | { kind: "imported"; profileId: string; yaml: string; }
    /** The user turned down every offer; nothing was written. */
    | { kind: "declined"; };

/**
 * Land a decoded share link, asking before anything is replaced. Mutates `incoming` (it
 * may be re-identified) and writes storage, so the caller only has to reload and report.
 *
 * `profileId` names the slot the trip now occupies — pass it, not whatever id the caller
 * captured earlier, to anything keyed by trip: an import moves the active slot, so a
 * stale id would bind the new trip to the old one's cloud file.
 */
function canonical(yaml: string): string | null {
    try {
        return serializeToYaml(validateYaml(yaml));
    } catch {
        // A stored copy that no longer validates is by definition not this version.
        return null;
    }
}

export function importSharedTrip(incoming: TripData): ShareImportOutcome {
    // Same id means the same trip, not a similar one, so replacing this device's copy is a
    // real option — and usually the wanted one. A copy stays available behind it for the
    // case where the two are meant to diverge from here.
    const existing = findLocalTripByTripId(incoming.trip.id);
    if (existing !== null) {
        // A persistent link is reopened to pick up updates, so the common case is that
        // nothing changed since last time — asking to "overwrite" with identical bytes
        // would only teach the user to dismiss the prompt. Compared canonically: the
        // stored copy went through serializeToYaml too, so any difference is real.
        if (canonical(existing.yaml) === serializeToYaml(incoming)) {
            if (existing.profileId !== getActiveProfileId()) switchToProfile(existing.profileId);
            return { kind: "unchanged", profileId: existing.profileId };
        }
        if (confirm(`「${incoming.trip.name}」你已經有這趟行程了。要用連結裡的版本覆蓋原本那份嗎？（可以復原）`)) {
            // Switching first is both what the user asked for and what puts the copy being
            // replaced in the backup ring, rather than whichever trip happened to be active.
            if (existing.profileId !== getActiveProfileId()) switchToProfile(existing.profileId);
            backupCurrentYaml();
            const yaml = serializeToYaml(incoming);
            saveTripData(incoming, yaml);
            return { kind: "overwritten", profileId: existing.profileId, yaml };
        }
        if (!confirm("那要另外匯入成一份副本嗎？原本那份會保留。")) return { kind: "declined" };
    } else if (
        localStorage.getItem(USER_YAML_KEY)
        && !confirm("偵測到分享的行程，要匯入為新行程嗎？（目前行程會保留，可隨時切回）")
    ) {
        return { kind: "declined" };
    }
    // Two trips sharing an id would fight over one Drive file, so a copy of a trip this
    // device holds gets its own identity.
    ensureUniqueTripId(incoming);
    // Re-serialized rather than stored raw, so a hand-edited share link is canonicalized
    // (runtime ids out, schema modeline back in).
    const yaml = serializeToYaml(incoming);
    return { kind: "imported", profileId: createProfile(yaml), yaml };
}
