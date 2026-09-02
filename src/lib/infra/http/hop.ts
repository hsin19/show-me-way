/**
 * Client for hop (hop.hsin19.com), the short-link + encrypted blob service.
 *
 * It only ever handles ciphertext produced by `domain/share-crypto.ts`. The
 * decryption key must never appear in a URL, header or body here — hop holding
 * both an id and its key would make the payload readable, which is the one thing
 * this whole design exists to prevent.
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
    | { ok: true; id: string; editToken: string; }
    | { ok: false; };

/** Upload ciphertext, returning the short id. `editToken` is reserved for updatable links. */
export async function createHopBlob(payload: string): Promise<HopCreateResult> {
    // Refuse locally rather than letting the server answer 413: the caller can offer
    // the inline link instead, which is a real fallback, not an error message.
    if (!payload || payload.length > MAX_TOKEN_CHARS) return { ok: false };

    try {
        const res = await fetch(`${hopBaseUrl()}/api/v1/blobs`, {
            method: "POST",
            // text/plain keeps this a CORS-simple request, so there is no preflight
            // OPTIONS between the user tapping share and seeing a link.
            headers: { "Content-Type": "text/plain" },
            body: payload,
            signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        if (!res.ok) return { ok: false };

        const data = await res.json() as { id?: unknown; editToken?: unknown; };
        if (typeof data.id !== "string" || !data.id) return { ok: false };
        return {
            ok: true,
            id: data.id,
            editToken: typeof data.editToken === "string" ? data.editToken : "",
        };
    } catch {
        return { ok: false };
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
