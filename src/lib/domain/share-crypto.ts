/**
 * End-to-end encryption for the short share link. The itinerary is compressed,
 * then encrypted here; only the ciphertext is ever uploaded to hop, and the key is
 * handed back to the caller to put in the URL fragment. hop therefore stores
 * something it cannot read, and the privacy property of the inline `#s=` link
 * survives the move to a backend.
 *
 * Compress before encrypting, never the other way round: ciphertext has no
 * compressible structure, so reversing the order silently throws the compression
 * away and roughly triples what gets uploaded.
 */

import {
    asShareLinkError,
    base64urlToBytes,
    bytesToBase64url,
    compressText,
    decompressText,
    isShareSupported,
    MAX_TOKEN_CHARS,
    ShareLinkError,
} from "./share";

const IV_BYTES = 12;
/**
 * AES-128, not 256, and the reason is link length: 16 bytes is 22 base64url chars
 * against 43, which drops the whole share URL from ~79 to ~58 and the QR code down a
 * version. Nothing is given up for it — the key only guards against someone holding
 * the ciphertext without the link (hop itself), and 2^128 is not searchable. What
 * actually bounds the exposure here is how guessable the id is, not the key size.
 */
const KEY_BYTES = 16;

export type SealedShare = {
    /** base64url of `iv ‖ ciphertext` — what gets uploaded. */
    payload: string;
    /** base64url of the raw AES key — 22 chars, and it must never leave the fragment. */
    key: string;
};

/**
 * Separate from `isShareSupported` on purpose: folding the crypto check into it
 * would also disable the inline link, which needs no crypto at all. The
 * `crypto.subtle` half is not redundant either — a non-secure context has no
 * SubtleCrypto, and `pnpm dev` reached from a phone over `http://<LAN-IP>:8045`
 * is exactly that.
 */
export function isEncryptedShareSupported(): boolean {
    return isShareSupported() && !!globalThis.crypto?.subtle;
}

/**
 * Always generates its own IV and key. The signature deliberately accepts neither:
 * updating an existing blob (a printed QR must keep working) is the one place a key
 * would be reused, and reusing an IV with it is what breaks AES-GCM outright.
 */
export async function sealShareToken(yaml: string): Promise<SealedShare> {
    const compressed = await compressText(yaml);
    const rawKey = crypto.getRandomValues(new Uint8Array(KEY_BYTES));
    const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));

    const key = await crypto.subtle.importKey("raw", rawKey as BufferSource, "AES-GCM", false, ["encrypt"]);
    const ciphertext = new Uint8Array(
        await crypto.subtle.encrypt({ name: "AES-GCM", iv: iv as BufferSource }, key, compressed as BufferSource),
    );

    const packed = new Uint8Array(IV_BYTES + ciphertext.length);
    packed.set(iv, 0);
    packed.set(ciphertext, IV_BYTES);

    return { payload: bytesToBase64url(packed), key: bytesToBase64url(rawKey) };
}

/**
 * Rejects with a `ShareLinkError` on a wrong key, tampered ciphertext, a truncated
 * payload, or one past the size cap — never with the browser's own OperationError,
 * whose English text the editor would otherwise put on screen. The cap is checked
 * before `crypto.subtle.decrypt`, which has no streaming form: an oversized payload
 * from a host we do not control would otherwise be materialized in full before
 * anything could object.
 */
export async function openShareToken(payload: string, rawKeyText: string): Promise<string> {
    if (payload.length > MAX_TOKEN_CHARS) {
        throw new ShareLinkError("分享連結的內容過大，已停止解析");
    }
    try {
        const packed = base64urlToBytes(payload);
        if (packed.length <= IV_BYTES) {
            throw new ShareLinkError("分享連結內容無效");
        }

        const rawKey = base64urlToBytes(rawKeyText);
        if (rawKey.length !== KEY_BYTES) {
            throw new ShareLinkError("分享連結內容無效");
        }

        const key = await crypto.subtle.importKey("raw", rawKey as BufferSource, "AES-GCM", false, ["decrypt"]);
        const plain = new Uint8Array(
            await crypto.subtle.decrypt(
                { name: "AES-GCM", iv: packed.subarray(0, IV_BYTES) as BufferSource },
                key,
                packed.subarray(IV_BYTES) as BufferSource,
            ),
        );

        return await decompressText(plain);
    } catch (err) {
        throw asShareLinkError(err);
    }
}
