/**
 * Itinerary sharing via the URL hash.
 *
 * The whole itinerary YAML is compressed and packed into the URL fragment
 * (after `#`), so a link is fully self-contained with no backend: the receiver
 * decodes it entirely client-side. Because the payload lives in the fragment it
 * is never sent to the server (GitHub Pages) — it stays on the device.
 *
 * Pipeline: UTF-8 bytes -> raw DEFLATE -> base64url. Decoding reverses it.
 * `deflate-raw` (no zlib header) keeps the token a few bytes shorter, and
 * base64url avoids `+ / =` which would otherwise need percent-encoding in a URL.
 *
 * Note: a full itinerary produces a long token (several thousand chars). Such
 * links open fine when clicked or pasted into chat/email, but are too long for
 * QR codes. If short/updatable links are ever needed, swap the encode/decode
 * here for a backend call — the App only depends on this module's surface.
 */

/** Hash parameter name carrying the share token, e.g. `#s=<token>`. */
export const SHARE_HASH_PARAM = "s";

/**
 * Whether this browser can build/read share links. Requires the Compression
 * Streams API (Chrome 80+, Safari 16.4+, Firefox 113+).
 */
export function isShareSupported(): boolean {
    return typeof CompressionStream !== "undefined"
        && typeof DecompressionStream !== "undefined";
}

// Run bytes through a (De)CompressionStream and collect the result.
async function pipeThrough(
    data: Uint8Array,
    stream: CompressionStream | DecompressionStream,
): Promise<Uint8Array> {
    const writer = stream.writable.getWriter();
    // Cast: the lib.dom typing wants `ArrayBuffer`-backed views, but a plain
    // Uint8Array is `ArrayBufferLike` and is accepted at runtime.
    void writer.write(data as BufferSource);
    void writer.close();
    const buffer = await new Response(stream.readable).arrayBuffer();
    return new Uint8Array(buffer);
}

function bytesToBase64url(bytes: Uint8Array): string {
    let binary = "";
    // Chunk to avoid blowing the argument limit of String.fromCharCode on large payloads.
    const CHUNK = 0x8000;
    for (let i = 0; i < bytes.length; i += CHUNK) {
        binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
    }
    return btoa(binary)
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");
}

function base64urlToBytes(token: string): Uint8Array {
    const base64 = token.replace(/-/g, "+").replace(/_/g, "/");
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
}

/** Compress a YAML string into a URL-safe share token. */
export async function encodeShareToken(yaml: string): Promise<string> {
    const input = new TextEncoder().encode(yaml);
    const compressed = await pipeThrough(input, new CompressionStream("deflate-raw"));
    return bytesToBase64url(compressed);
}

/** Decompress a share token back into the original YAML string. */
export async function decodeShareToken(token: string): Promise<string> {
    const bytes = base64urlToBytes(token);
    const decompressed = await pipeThrough(bytes, new DecompressionStream("deflate-raw"));
    return new TextDecoder().decode(decompressed);
}

/** Build an absolute share URL carrying the itinerary in its hash fragment. */
export async function buildShareUrl(yaml: string): Promise<string> {
    const token = await encodeShareToken(yaml);
    const base = `${location.origin}${location.pathname}`;
    return `${base}#${SHARE_HASH_PARAM}=${token}`;
}

/**
 * Extract a share token from an arbitrary pasted string that may be a full
 * share URL (`https://…/#s=<token>`) or a bare `#s=<token>` fragment. Returns
 * null if no token is found. Shortened links (e.g. picsee) only redirect and
 * carry no token, so they can't be expanded here — paste the full link.
 */
export function parseShareToken(input: string): string | null {
    const hashIndex = input.indexOf("#");
    if (hashIndex === -1) return null;
    const fragment = input.slice(hashIndex + 1).trim();
    if (!fragment) return null;
    const token = new URLSearchParams(fragment).get(SHARE_HASH_PARAM);
    // Tokens are base64url. Anything else is a false sniff — e.g. a pasted
    // export YAML whose modeline `#` plus an `&s=` inside a mapLink would
    // otherwise be mistaken for a share link and fail to save.
    return token && /^[A-Za-z0-9_-]+$/.test(token) ? token : null;
}

/** Read the share token from the current URL hash, or null if none present. */
export function readShareTokenFromHash(): string | null {
    return parseShareToken(location.hash);
}

/**
 * Strip the share token from the URL without reloading or adding a history
 * entry, so a refresh won't re-trigger the import prompt and the URL stays clean.
 */
export function clearShareHash(): void {
    history.replaceState(null, "", location.pathname + location.search);
}
