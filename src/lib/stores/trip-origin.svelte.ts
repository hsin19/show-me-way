// Which trips on this device arrived from someone else's share link. Nothing in the trip
// itself records that — an imported copy keeps the sender's `trip.id` and is otherwise a
// trip like any other — so the receiving end is remembered here, keyed by profile slot
// like the Drive binding and the sender-side share link are.
//
// Only a trip that landed in a slot of its own is marked. Reopening a persistent link for
// a trip this device already holds is taking an update to your own trip, not being handed
// someone else's, and `importSharedTrip` reports those as `overwritten` / `unchanged`.
//
// A rune rather than a plain module read, because an import lands while 行程管理 is already
// on screen and the badge has to appear without a remount.

export const TRIP_ORIGINS_KEY = "showmeway_trip_origins";

/** profile slot → ISO date-time the shared trip landed. */
type TripOriginMap = Record<string, string>;

function loadOrigins(): TripOriginMap {
    try {
        const raw = localStorage.getItem(TRIP_ORIGINS_KEY);
        if (!raw) return {};
        const parsed: unknown = JSON.parse(raw);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
        const out: TripOriginMap = {};
        for (const [profileId, value] of Object.entries(parsed as Record<string, unknown>)) {
            if (typeof value === "string") out[profileId] = value;
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

    markShared(profileId: string): void {
        this.write({ ...this.origins, [profileId]: new Date().toISOString() });
    }

    /** For a slot that is being deleted or refilled — the mark describes the trip, not the slot. */
    forget(profileId: string): void {
        if (!this.isShared(profileId)) return;
        const next = { ...this.origins };
        delete next[profileId];
        this.write(next);
    }

    // A badge is not worth failing an import over, so a refused write costs the mark and
    // nothing else — unlike the share-link record, nothing here can be re-derived, but
    // nothing depends on it either.
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
