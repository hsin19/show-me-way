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

// A real trip compresses to a few KB. The caps below exist because decoding is
// zero-click (App decodes a share link in onMount, before any confirm) and
// deflate reaches ~1000:1 — without them a crafted link is a client-side OOM.
const MAX_TOKEN_CHARS = 100_000;
const MAX_DECOMPRESSED_BYTES = 4 * 1024 * 1024;

async function pipeThrough(
    data: Uint8Array,
    stream: CompressionStream | DecompressionStream,
    maxBytes = Infinity,
): Promise<Uint8Array> {
    const writer = stream.writable.getWriter();
    // The cast is a lib.dom quirk: it wants an `ArrayBuffer`-backed view, while a
    // plain Uint8Array is `ArrayBufferLike` and works fine at runtime. Rejections
    // are swallowed here because they re-surface on the reader side.
    writer.write(data as BufferSource).catch(() => {});
    writer.close().catch(() => {});
    // Read chunk by chunk instead of Response.arrayBuffer(), so an oversized
    // payload is cancelled at the cap rather than buffered whole.
    const reader = stream.readable.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.length;
        if (total > maxBytes) {
            await reader.cancel();
            throw new Error("分享連結的內容過大，已停止解析");
        }
        chunks.push(value);
    }
    const out = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
        out.set(chunk, offset);
        offset += chunk.length;
    }
    return out;
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

/** Rejects on a corrupt or oversized token, so callers must be ready for a link that was truncated in transit. */
export async function decodeShareToken(token: string): Promise<string> {
    if (token.length > MAX_TOKEN_CHARS) {
        throw new Error("分享連結的內容過大，已停止解析");
    }
    const bytes = base64urlToBytes(token);
    const decompressed = await pipeThrough(bytes, new DecompressionStream("deflate-raw"), MAX_DECOMPRESSED_BYTES);
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
    // share link and refuse to save. The length cap matches decodeShareToken's.
    return token && token.length <= MAX_TOKEN_CHARS && /^[A-Za-z0-9_-]+$/.test(token) ? token : null;
}

export function readShareTokenFromHash(): string | null {
    return parseShareToken(location.hash);
}

/** `replaceState`, so no reload and no history entry — a refresh must not re-prompt. */
export function clearShareHash(): void {
    history.replaceState(null, "", location.pathname + location.search);
}
