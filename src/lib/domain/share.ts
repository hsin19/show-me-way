/**
 * Itinerary sharing, in two link shapes that share one fragment.
 *
 * `#s=<token>` carries the whole compressed itinerary and reaches no server at
 * all. `deflate-raw` skips the zlib header, and base64url avoids the `+ / =` that
 * would need percent-encoding. A full itinerary still runs to several thousand
 * characters: fine to click or paste, too long for a QR code.
 *
 * `#h=<id>.<key>` carries only a pointer plus its AES-GCM key: the ciphertext
 * lives on hop, and the key stays in the fragment for the same reason the inline
 * payload does — one log line holding both the id and the key is a plaintext
 * itinerary. Never move either into a query param, and never send the key to hop.
 *
 * This module knows the two shapes as strings only. Encryption lives in
 * `share-crypto.ts` and the network round trip in `infra/http/hop.ts`.
 */

/** Hash parameter name carrying the inline share token, e.g. `#s=<token>`. */
export const SHARE_HASH_PARAM = "s";

/** Hash parameter naming a hop-hosted encrypted blob, e.g. `#h=<id>.<key>`. */
export const SHORT_HASH_PARAM = "h";

export type ShareLink =
    | { kind: "inline"; token: string; }
    | { kind: "short"; id: string; key: string; };

/**
 * A share link the user can be told about: `message` is finished zh-TW copy, safe
 * to put on screen as-is. `retryable` says whether the same link may still work
 * later — a caller holding the only copy of a key (the URL hash) must not discard
 * the link on a retryable failure. Everything thrown from this module and from
 * `share-crypto.ts` for bad input is one of these, never a raw DOMException.
 */
export class ShareLinkError extends Error {
    readonly retryable: boolean;

    constructor(message: string, options: { retryable?: boolean; cause?: unknown; } = {}) {
        super(message, options.cause === undefined ? undefined : { cause: options.cause });
        this.name = "ShareLinkError";
        this.retryable = options.retryable ?? false;
    }
}

/** Wrap whatever the browser threw at a decode step so the caller never shows a raw DOMException. */
export function asShareLinkError(err: unknown): ShareLinkError {
    return err instanceof ShareLinkError ? err : new ShareLinkError("分享連結內容無效", { cause: err });
}

/** Gate every share entry point on this: Compression Streams needs Safari 16.4+. */
export function isShareSupported(): boolean {
    return typeof CompressionStream !== "undefined"
        && typeof DecompressionStream !== "undefined";
}

// A real trip compresses to a few KB. The caps below exist because decoding is
// zero-click (App decodes a share link in onMount, before any confirm) and
// deflate reaches ~1000:1 — without them a crafted link is a client-side OOM.
export const MAX_TOKEN_CHARS = 100_000;
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
            throw new ShareLinkError("分享連結的內容過大，已停止解析");
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

export function bytesToBase64url(bytes: Uint8Array): string {
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

export function base64urlToBytes(token: string): Uint8Array {
    const base64 = token.replace(/-/g, "+").replace(/_/g, "/");
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
}

export async function compressText(text: string): Promise<Uint8Array> {
    return pipeThrough(new TextEncoder().encode(text), new CompressionStream("deflate-raw"));
}

/** Rejects past the decompressed-size cap: decoding is zero-click, so a crafted payload must not OOM the tab. */
export async function decompressText(bytes: Uint8Array): Promise<string> {
    const decompressed = await pipeThrough(bytes, new DecompressionStream("deflate-raw"), MAX_DECOMPRESSED_BYTES);
    return new TextDecoder().decode(decompressed);
}

export async function encodeShareToken(yaml: string): Promise<string> {
    return bytesToBase64url(await compressText(yaml));
}

/** Rejects with a `ShareLinkError` on a corrupt or oversized token, so callers must be ready for a link that was truncated in transit. */
export async function decodeShareToken(token: string): Promise<string> {
    if (token.length > MAX_TOKEN_CHARS) {
        throw new ShareLinkError("分享連結的內容過大，已停止解析");
    }
    try {
        return await decompressText(base64urlToBytes(token));
    } catch (err) {
        throw asShareLinkError(err);
    }
}

// Never a hardcoded domain: the GitHub Pages copy is served from /show-me-way/,
// so a fixed origin passes every local check and only breaks on the deployed site.
function shareUrlBase(): string {
    return `${location.origin}${location.pathname}`;
}

/** Build an absolute share URL carrying the whole itinerary in its hash fragment. */
export async function buildShareUrl(yaml: string): Promise<string> {
    const token = await encodeShareToken(yaml);
    return `${shareUrlBase()}#${SHARE_HASH_PARAM}=${token}`;
}

// The key half is a fixed 22 chars (16 raw bytes, unpadded base64url). Anchoring
// both halves and the separator is what makes `h` safe to sniff out of arbitrary
// text: an `&h=` inside some mapLink cannot accidentally match this shape. Keep this
// in step with KEY_BYTES in share-crypto.ts — nothing else ties the two together.
const SHORT_LINK_RE = /^([A-Za-z0-9_-]{4,32})\.([A-Za-z0-9_-]{22})$/;

/**
 * Build the short share URL. It stays on this app's origin — only the ciphertext
 * lives on hop. Returns null when the id hop handed back does not fit the shape
 * `parseShareLink` accepts: such a link would be minted fine here and then
 * silently ignored on every receiving device, so the caller must fall back to the
 * inline link instead.
 */
export function buildShortShareUrl(id: string, key: string): string | null {
    const fragment = `${id}.${key}`;
    if (!SHORT_LINK_RE.test(fragment)) return null;
    return `${shareUrlBase()}#${SHORT_HASH_PARAM}=${fragment}`;
}

/**
 * Sniff a share link out of arbitrary pasted text — a full URL or a bare
 * fragment — reporting which of the two forms was found, or null for neither.
 * A `short` result carries only the id and key: expanding it needs a network
 * round trip through infra/http/hop.ts, which this layer must not make.
 */
export function parseShareLink(input: string): ShareLink | null {
    const hashIndex = input.indexOf("#");
    if (hashIndex === -1) return null;
    const fragment = input.slice(hashIndex + 1).trim();
    if (!fragment) return null;
    const params = new URLSearchParams(fragment);

    // `s` wins when both are present, so every link that worked before still
    // takes the identical path.
    const token = params.get(SHARE_HASH_PARAM);
    // The base64url check rejects a false sniff: a pasted export YAML carries a
    // `#` modeline, and an `&s=` inside some mapLink would otherwise read as a
    // share link and refuse to save. The length cap matches decodeShareToken's.
    if (token && token.length <= MAX_TOKEN_CHARS && /^[A-Za-z0-9_-]+$/.test(token)) {
        return { kind: "inline", token };
    }

    const short = params.get(SHORT_HASH_PARAM);
    const match = short && SHORT_LINK_RE.exec(short);
    return match ? { kind: "short", id: match[1], key: match[2] } : null;
}

export function readShareLinkFromHash(): ShareLink | null {
    return parseShareLink(location.hash);
}

/** `replaceState`, so no reload and no history entry — a refresh must not re-prompt. */
export function clearShareHash(): void {
    history.replaceState(null, "", location.pathname + location.search);
}
