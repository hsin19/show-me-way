// The only way trip bytes reach a slot. Both functions take a validated `TripData` and
// store its `serializeToYaml`, so storage never holds anything but the canonical form: what
// a pull downloaded, what the editor was handed and what a backup kept are all re-serialized
// on the way in. A Drive file this app did not write therefore lands as different bytes
// than its sync record hashed, reads as a local edit, and the upload prompt that follows
// is what brings the file back to canonical.

import {
    serializeToYaml,
    type TripData,
} from "$lib/domain/trip";
import { appStorage } from "$lib/infra/storage/app-storage";
import {
    createProfile,
    ensureActiveProfileId,
} from "$lib/infra/storage/profiles";
import {
    backupCurrentYaml,
    USER_YAML_KEY,
} from "$lib/infra/storage/yaml-storage";

/** What a write left in storage: the slot and the exact bytes it now holds. */
export interface Written {
    profileId: string;
    yaml: string;
}

/**
 * Overwrite the active slot with `data`. `backup` puts the bytes being replaced in the
 * backup ring first — for a whole-document replacement, not a per-field edit, which would
 * push a real backup out of a ring every trip shares. Throws when storage refuses.
 */
export function writeActiveTrip(data: TripData, { backup }: { backup: boolean; }): Written {
    const yaml = serializeToYaml(data);
    if (backup) backupCurrentYaml();
    appStorage.set(USER_YAML_KEY, yaml);
    return { profileId: ensureActiveProfileId(), yaml };
}

/**
 * Start a new slot holding `data`, parking the active trip. A trip that must not share an
 * identity with one already here needs its `trip.id` replaced before this call. Throws
 * when storage refuses, with no trip lost.
 */
export function addTrip(data: TripData): Written {
    const yaml = serializeToYaml(data);
    return { profileId: createProfile(yaml), yaml };
}
