/**
 * Itinerary sharing with no backend: the whole YAML is compressed into the URL
 * fragment and decoded on the receiver's device. The fragment, never a query
 * param — that is what keeps the payload from reaching GitHub Pages, and that
 * privacy property is the point of the design.
 *
 * `deflate-raw` skips the zlib header, and base64url avoids the `+ / =` that
 * would need percent-encoding. Even so a full itinerary runs to several thousand
 * characters: fine to click or paste, too long for a QR code. Short or updatable
 * links would mean a backend behind this module's surface.
 */

/** Hash parameter name carrying the share token, e.g. `#s=<token>`. */
export const SHARE_HASH_PARAM = "s";

/** Gate every share entry point on this: Compression Streams needs Safari 16.4+. */
export function isShareSupported(): boolean {
    return typeof CompressionStream !== "undefined"
        && typeof DecompressionStream !== "undefined";
}

async function pipeThrough(
    data: Uint8Array,
    stream: CompressionStream | DecompressionStream,
): Promise<Uint8Array> {
    const writer = stream.writable.getWriter();
    // The cast is a lib.dom quirk: it wants an `ArrayBuffer`-backed view, while a
    // plain Uint8Array is `ArrayBufferLike` and works fine at runtime.
    void writer.write(data as BufferSource);
    void writer.close();
    const buffer = await new Response(stream.readable).arrayBuffer();
    return new Uint8Array(buffer);
}

function bytesToBase64url(bytes: Uint8Array): string {
    let binary = "";
    // Chunked: a whole itinerary at once exceeds String.fromCharCode's argument limit.
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

export async function encodeShareToken(yaml: string): Promise<string> {
    const input = new TextEncoder().encode(yaml);
    const compressed = await pipeThrough(input, new CompressionStream("deflate-raw"));
    return bytesToBase64url(compressed);
}

/** Rejects on a corrupt token, so callers must be ready for a link that was truncated in transit. */
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
 * Sniff a share token out of arbitrary pasted text — a full URL or a bare
 * `#s=<token>` — or null if there is none. A shortened link only redirects and
 * carries no token, so it cannot be expanded here.
 */
export function parseShareToken(input: string): string | null {
    const hashIndex = input.indexOf("#");
    if (hashIndex === -1) return null;
    const fragment = input.slice(hashIndex + 1).trim();
    if (!fragment) return null;
    const token = new URLSearchParams(fragment).get(SHARE_HASH_PARAM);
    // The base64url check rejects a false sniff: a pasted export YAML carries a
    // `#` modeline, and an `&s=` inside some mapLink would otherwise read as a
    // share link and refuse to save.
    return token && /^[A-Za-z0-9_-]+$/.test(token) ? token : null;
}

export function readShareTokenFromHash(): string | null {
    return parseShareToken(location.hash);
}

/** `replaceState`, so no reload and no history entry — a refresh must not re-prompt. */
export function clearShareHash(): void {
    history.replaceState(null, "", location.pathname + location.search);
}
