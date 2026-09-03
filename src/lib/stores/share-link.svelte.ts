// Publishing a trip's share link: mint it the first time, replace the ciphertext behind
// the same id every time after. This sits between the pure sealing in domain/share-crypto,
// the hop client and the per-trip record in infra/storage/share-links because the
// decision — update, recreate, fall back, or refuse — needs all three at once, and
// TripStore is already the orchestration seam most likely to be stretched.

import {
    buildShareUrl,
    buildShortShareUrl,
} from "$lib/domain/share";
import {
    isEncryptedShareSupported,
    resealShareToken,
    sealShareToken,
} from "$lib/domain/share-crypto";
import {
    createHopBlob,
    deleteHopBlob,
    updateHopBlob,
} from "$lib/infra/http/hop";
import {
    loadShareLinkMap,
    saveShareLinkMap,
    type ShareLinkMap,
    type ShareLinkRecord,
} from "$lib/infra/storage/share-links";

/**
 * hop's maximum. A persistent link gets printed and pinned to a fridge months before a
 * trip; hop's 90-day default was chosen for one-shot links. Every update restarts it.
 */
export const PERSISTENT_LINK_TTL_SECONDS = 365 * 86400;

export type PublishOutcome =
    /** First link for this trip. */
    | { kind: "created"; url: string; }
    /** Same id and key as before; whoever holds the old link now gets this version. */
    | { kind: "updated"; url: string; }
    /** The old link had expired or been revoked, so a new one was minted — the old QR is dead. */
    | { kind: "recreated"; url: string; }
    /** No crypto, or hop unreachable with nothing to update: the inline `#s=` link, which reaches no server. */
    | { kind: "inline"; url: string; }
    /**
     * A link exists but hop could not be reached to update it. Nothing was minted: a
     * fresh link here would fork the audience across two ids, and the inline fallback
     * would hand the user a different URL than the one they already sent around.
     */
    | { kind: "unreachable"; };

export type RevokeOutcome = "revoked" | "unreachable";

function isoOrNull(epochMs: number | null): string | null {
    return epochMs === null ? null : new Date(epochMs).toISOString();
}

class ShareLinkStore {
    // Loaded at construction like the Drive bindings are; the loader swallows a blocked
    // localStorage, so import stays safe under vitest.
    links = $state<ShareLinkMap>(loadShareLinkMap());

    /** The persistent link this profile slot already has, or null. */
    forTrip(profileId: string): ShareLinkRecord | null {
        return this.links[profileId] ?? null;
    }

    private remember(profileId: string, record: ShareLinkRecord | null) {
        const next = { ...this.links };
        if (record) next[profileId] = record;
        else delete next[profileId];
        this.links = next;
        saveShareLinkMap(next);
    }

    /**
     * Publish `yaml` under this trip's link, minting one if it has none. See
     * `PublishOutcome` for what each result means for the URL the user already holds.
     */
    async publish(profileId: string, yaml: string): Promise<PublishOutcome> {
        if (!isEncryptedShareSupported()) return { kind: "inline", url: await buildShareUrl(yaml) };

        const existing = this.forTrip(profileId);
        let recreated = false;
        if (existing) {
            const payload = await resealShareToken(yaml, existing.key);
            const updated = await updateHopBlob(existing.id, existing.editToken, payload, PERSISTENT_LINK_TTL_SECONDS);
            if (updated.ok) {
                const url = buildShortShareUrl(existing.id, existing.key);
                if (url) {
                    this.remember(profileId, { ...existing, updatedAt: new Date().toISOString(), expiresAt: isoOrNull(updated.expiresAt) });
                    return { kind: "updated", url };
                }
            } else if (updated.reason === "network") {
                return { kind: "unreachable" };
            }
            // gone / unauthorized: that id will never take our updates again. Forget it and
            // mint a new one — telling the user, since their printed QR just died.
            this.remember(profileId, null);
            recreated = true;
        }

        const sealed = await sealShareToken(yaml);
        const created = await createHopBlob(sealed.payload, PERSISTENT_LINK_TTL_SECONDS);
        const url = created.ok ? buildShortShareUrl(created.id, sealed.key) : null;
        if (!created.ok || !url) return { kind: "inline", url: await buildShareUrl(yaml) };

        const now = new Date().toISOString();
        // A link without an editToken can be minted but never updated: hop always returns
        // one, so an empty string means a hop this build does not understand. Do not
        // remember it — the next tap would find a record it cannot use and recreate anyway.
        if (created.editToken) {
            this.remember(profileId, { id: created.id, key: sealed.key, editToken: created.editToken, createdAt: now, updatedAt: now, expiresAt: isoOrNull(created.expiresAt) });
        }
        return { kind: recreated ? "recreated" : "created", url };
    }

    /**
     * Delete the ciphertext behind this trip's link and forget the link. An already-gone
     * blob counts as revoked; a token hop rejects does too, since we could never use it
     * anyway. Only an unreachable hop keeps the record, so a retry stays possible.
     */
    async revoke(profileId: string): Promise<RevokeOutcome> {
        const existing = this.forTrip(profileId);
        if (!existing) return "revoked";
        const res = await deleteHopBlob(existing.id, existing.editToken);
        if (!res.ok && res.reason === "network") return "unreachable";
        this.remember(profileId, null);
        return "revoked";
    }

    /** Drop the record without touching hop — for a deleted profile, whose blob is left to expire. */
    forget(profileId: string) {
        if (this.forTrip(profileId)) this.remember(profileId, null);
    }
}

export const shareLinks = new ShareLinkStore();
