// Which trips on this device arrived from someone else's share link, and how to read that
// link again. Nothing in the trip itself records it — an imported copy keeps the sender's
// `trip.id` and is otherwise a trip like any other — so the receiving end is remembered
// here, keyed by profile slot like the Drive binding and the sender-side share link are.
//
// Only a trip that landed in a slot of its own, keeping the link's own identity, is
// marked. Reopening a persistent link for a trip this device already holds is taking an
// update to your own trip rather than being handed someone else's, and a copy that had to
// be re-identified (`ensureUniqueTripId`) deliberately forked away from the link.
//
// The record holds the link's id next to its key, which is what lets a background check
// ask the sender for a newer version without the URL being reopened. The privacy rule is
// unchanged: the pair never meets off the device. This device already holds the plaintext
// trip the key protects, so keeping the pair locally gives away nothing an attacker with
// this device did not already have — the same reasoning as the sender's own record in
// `infra/storage/share-links.ts`. An `editToken` is never part of this: a recipient has
// no authority over the sender's blob and must never be handed any.
//
// A rune rather than a plain module read, because an import lands while 行程管理 is already
// on screen and the badge has to appear without a remount.

import { yamlFingerprint } from "$lib/domain/utils";

export const TRIP_ORIGINS_KEY = "showmeway_trip_origins";

/** What a slot remembers about the link its trip came from. */
export interface TripOrigin {
    /** ISO date-time the shared trip landed. */
    receivedAt: string;
    /**
     * hop blob id and its AES key. Absent for an inline `#s=` link, which no server holds
     * and which therefore can never be re-read — such a trip is marked, but not watched.
     */
    id?: string;
    key?: string;
    /**
     * `yamlFingerprint` of the version last taken from this link, canonicalized. Both
     * questions a background check asks are measured against it: the sender moved when the
     * link no longer matches it, and this device moved when the local copy does not.
     */
    takenHash?: string;
}

type TripOriginMap = Record<string, TripOrigin>;

function isOrigin(value: unknown): value is TripOrigin {
    if (!value || typeof value !== "object") return false;
    const o = value as TripOrigin;
    return typeof o.receivedAt === "string"
        && (o.id === undefined || typeof o.id === "string")
        && (o.key === undefined || typeof o.key === "string")
        && (o.takenHash === undefined || typeof o.takenHash === "string");
}

/** Unreadable or malformed storage yields {}; a malformed entry is dropped, not the map. */
function loadOrigins(): TripOriginMap {
    try {
        const raw = localStorage.getItem(TRIP_ORIGINS_KEY);
        if (!raw) return {};
        const parsed: unknown = JSON.parse(raw);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
        const out: TripOriginMap = {};
        for (const [profileId, value] of Object.entries(parsed as Record<string, unknown>)) {
            if (isOrigin(value)) out[profileId] = value;
        }
        return out;
    } catch {
        return {};
    }
}

class TripOriginStore {
    // Read at construction like the share links are; the loader swallows a blocked
    // localStorage, so import stays safe under vitest.
    private origins = $state<TripOriginMap>(loadOrigins());

    /** Whether the trip in this slot came from someone else's share link. */
    isShared(profileId: string): boolean {
        return profileId in this.origins;
    }

    /** The link to re-read for updates, or null for a slot that has none to re-read. */
    linkFor(profileId: string): { id: string; key: string; } | null {
        const origin = this.origins[profileId];
        return origin?.id && origin.key ? { id: origin.id, key: origin.key } : null;
    }

    /** The version last taken from this slot's link, or null when nothing has been taken. */
    takenHash(profileId: string): string | null {
        return this.origins[profileId]?.takenHash ?? null;
    }

    /**
     * Record that this slot's trip arrived from `link`, holding `yaml` as what was taken.
     * `yaml` must be the canonical form that gets compared later, not the bytes off the
     * wire — a fingerprint of anything else would report a change nobody made.
     */
    markShared(profileId: string, link: { id: string; key: string; } | null, yaml: string): void {
        this.write({
            ...this.origins,
            [profileId]: {
                receivedAt: new Date().toISOString(),
                ...(link ?? {}),
                takenHash: yamlFingerprint(yaml),
            },
        });
    }

    /**
     * Record `yaml` as the version this slot has now taken from its link — after landing an
     * update, and equally after declining one, which settles that offer without taking it.
     * A no-op for a slot that is not tracking a link. `link`, when given, replaces the one
     * being watched: a reopened link may be one the sender recreated under a new id.
     */
    recordTaken(profileId: string, yaml: string, link?: { id: string; key: string; }): void {
        const origin = this.origins[profileId];
        if (!origin) return;
        this.write({ ...this.origins, [profileId]: { ...origin, ...(link ?? {}), takenHash: yamlFingerprint(yaml) } });
    }

    /** For a slot that is being deleted or refilled — the mark describes the trip, not the slot. */
    forget(profileId: string): void {
        if (!this.isShared(profileId)) return;
        const next = { ...this.origins };
        delete next[profileId];
        this.write(next);
    }

    // Losing this costs the badge and the update check, not the trip, so a refused write is
    // reported and swallowed rather than failing the import that was landing.
    private write(next: TripOriginMap): void {
        this.origins = next;
        try {
            if (Object.keys(next).length === 0) localStorage.removeItem(TRIP_ORIGINS_KEY);
            else localStorage.setItem(TRIP_ORIGINS_KEY, JSON.stringify(next));
        } catch (err) {
            console.error("Failed to record trip origin:", err);
        }
    }
}

export const tripOrigins = new TripOriginStore();
