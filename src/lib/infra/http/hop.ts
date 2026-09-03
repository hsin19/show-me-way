/**
 * Client for hop (hop.hsin19.com), the short-link + encrypted blob service.
 *
 * It only ever handles ciphertext produced by `domain/share-crypto.ts`. The
 * decryption key must never appear in a URL, header or body here — hop holding
 * both an id and its key would make the payload readable, which is the one thing
 * this whole design exists to prevent. The `editToken` is a different secret: it
 * only authorizes replacing or deleting the ciphertext, and hop minted it, so it
 * may travel back to hop.
 */

import { MAX_TOKEN_CHARS } from "$lib/domain/share";

const DEFAULT_BASE_URL = "https://hop.hsin19.com";

// Read per call, not at import: vitest stubs the env per test, and a blank
// `VITE_HOP_BASE_URL=` in someone's .env must fall back rather than turn every
// request into a same-origin `/api/v1/blobs` that 404s (the same trim-and-fall-back
// `getGdriveClientId` does).
function hopBaseUrl(): string {
    const configured = import.meta.env.VITE_HOP_BASE_URL?.trim();
    return configured ? configured.replace(/\/+$/, "") : DEFAULT_BASE_URL;
}

// The only fetch in the app that blocks first paint: opening a share link runs
// before the itinerary loads, so a hung request is a blank screen rather than a
// background feature quietly failing. Every other fetch here is unbounded on purpose.
const TIMEOUT_MS = 10_000;

export type HopFetchResult =
    | { ok: true; cipher: string; }
    /**
     * `gone` is terminal — the caller may drop the link. It is an allowlist (404 and
     * 410 only), because the caller acts on it by clearing the URL hash that holds
     * the only copy of the decryption key: anything not proven dead is `network`,
     * worth a retry, and must leave the link alone.
     */
    | { ok: false; reason: "gone" | "network"; };

export type HopCreateResult =
    /** `expiresAt` is epoch ms, or null when hop did not say. */
    | { ok: true; id: string; editToken: string; expiresAt: number | null; }
    | { ok: false; };

export type HopUpdateResult =
    | { ok: true; expiresAt: number | null; }
    /**
     * `gone` and `unauthorized` both mean this id can never be updated again by us —
     * the blob expired or was deleted, or the token we hold is not its token — so the
     * caller should mint a new link. `network` is worth a retry with the same link.
     */
    | { ok: false; reason: "gone" | "unauthorized" | "network"; };

export type HopDeleteResult = { ok: true; } | { ok: false; reason: "gone" | "unauthorized" | "network"; };

/**
 * Upload ciphertext, returning the short id and the `editToken` that later authorizes
 * `updateHopBlob` / `deleteHopBlob`. `ttlSeconds` overrides hop's default lifetime;
 * hop clamps it to its own range.
 */
export async function createHopBlob(payload: string, ttlSeconds?: number): Promise<HopCreateResult> {
    // Refuse locally rather than letting the server answer 413: the caller can offer
    // the inline link instead, which is a real fallback, not an error message.
    if (!payload || payload.length > MAX_TOKEN_CHARS) return { ok: false };

    try {
        const res = await fetch(`${hopBaseUrl()}/api/v1/blobs${ttlQuery(ttlSeconds)}`, {
            method: "POST",
            // text/plain keeps this a CORS-simple request, so there is no preflight
            // OPTIONS between the user tapping share and seeing a link.
            headers: { "Content-Type": "text/plain" },
            body: payload,
            signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        if (!res.ok) return { ok: false };

        const data = await res.json() as { id?: unknown; editToken?: unknown; expiresAt?: unknown; };
        if (typeof data.id !== "string" || !data.id) return { ok: false };
        return {
            ok: true,
            id: data.id,
            editToken: typeof data.editToken === "string" ? data.editToken : "",
            expiresAt: typeof data.expiresAt === "number" ? data.expiresAt : null,
        };
    } catch {
        return { ok: false };
    }
}

function ttlQuery(ttlSeconds: number | undefined): string {
    return ttlSeconds === undefined ? "" : `?ttl=${Math.floor(ttlSeconds)}`;
}

// Bearer auth costs a preflight, unlike the create path — acceptable here, since
// updating or revoking a link never sits between a tap and the first link appearing.
function ownerHeaders(editToken: string): Record<string, string> {
    return { Authorization: `Bearer ${editToken}` };
}

function ownerFailure(status: number): "gone" | "unauthorized" | "network" {
    if (status === 404 || status === 410) return "gone";
    if (status === 401) return "unauthorized";
    return "network";
}

/**
 * Replace the ciphertext behind an existing id so the link already in circulation
 * points at the new version. The payload must have been sealed under that link's
 * own key (`resealShareToken`) or every holder of the link loses the ability to open
 * it. Only the ciphertext and the editToken travel; the key is never an argument here.
 */
export async function updateHopBlob(id: string, editToken: string, payload: string, ttlSeconds?: number): Promise<HopUpdateResult> {
    if (!payload || payload.length > MAX_TOKEN_CHARS || !editToken) return { ok: false, reason: "network" };

    try {
        const res = await fetch(`${hopBaseUrl()}/api/v1/blobs/${encodeURIComponent(id)}${ttlQuery(ttlSeconds)}`, {
            method: "PUT",
            headers: { "Content-Type": "text/plain", ...ownerHeaders(editToken) },
            body: payload,
            signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        if (!res.ok) return { ok: false, reason: ownerFailure(res.status) };

        const data = await res.json() as { expiresAt?: unknown; };
        return { ok: true, expiresAt: typeof data.expiresAt === "number" ? data.expiresAt : null };
    } catch {
        return { ok: false, reason: "network" };
    }
}

/** Delete the blob so the link stops resolving. `gone` means it already had. */
export async function deleteHopBlob(id: string, editToken: string): Promise<HopDeleteResult> {
    if (!editToken) return { ok: false, reason: "unauthorized" };
    try {
        const res = await fetch(`${hopBaseUrl()}/api/v1/blobs/${encodeURIComponent(id)}`, {
            method: "DELETE",
            headers: ownerHeaders(editToken),
            signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        if (!res.ok) return { ok: false, reason: ownerFailure(res.status) };
        return { ok: true };
    } catch {
        return { ok: false, reason: "network" };
    }
}

export async function fetchHopBlob(id: string): Promise<HopFetchResult> {
    try {
        const res = await fetch(`${hopBaseUrl()}/api/v1/blobs/${encodeURIComponent(id)}`, {
            signal: AbortSignal.timeout(TIMEOUT_MS),
        });

        if (!res.ok) {
            // Only what hop itself defines as "this id will never resolve". A 401/403
            // from a proxy rule or a WAF, a 429, a 5xx — none of those prove the blob
            // is gone, and the cost of guessing wrong is a dead QR on that device.
            const gone = res.status === 404 || res.status === 410;
            return { ok: false, reason: gone ? "gone" : "network" };
        }

        // Cap the body before parsing: crypto.subtle.decrypt has no streaming form,
        // so whatever arrives here is held whole in memory. This is the trust
        // boundary against a host we do not control. An oversized, non-JSON or
        // payload-less body is still `network`: a misrouted deploy serving HTML with
        // permissive CORS looks exactly like this, and a refresh later may well work.
        const text = await res.text();
        if (text.length > MAX_TOKEN_CHARS * 2) return { ok: false, reason: "network" };

        const data = JSON.parse(text) as { payload?: unknown; };
        if (typeof data.payload !== "string" || !data.payload) {
            return { ok: false, reason: "network" };
        }
        return { ok: true, cipher: data.payload };
    } catch {
        return { ok: false, reason: "network" };
    }
}
