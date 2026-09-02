import {
    describe,
    expect,
    it,
} from "vitest";
import { base64urlToBytes } from "./share";
import {
    isEncryptedShareSupported,
    openShareToken,
    sealShareToken,
} from "./share-crypto";

const SAMPLE_YAML = `trip:
  name: 東京自由行 🗼
  start: '2026-06-11'
  end: '2026-06-15'
days:
  - day: 1
    title: 新宿
`;

describe("isEncryptedShareSupported", () => {
    it("is true where SubtleCrypto and Compression Streams exist (test runtime)", () => {
        expect(isEncryptedShareSupported()).toBe(true);
    });
});

describe("sealShareToken / openShareToken", () => {
    it("round-trips a YAML string unchanged", async () => {
        const sealed = await sealShareToken(SAMPLE_YAML);
        expect(await openShareToken(sealed.payload, sealed.key)).toBe(SAMPLE_YAML);
    });

    it("preserves multibyte content (Chinese + emoji)", async () => {
        const text = "trip:\n  name: 測試行程 🍜🚕\n";
        const sealed = await sealShareToken(text);
        expect(await openShareToken(sealed.payload, sealed.key)).toBe(text);
    });

    it("produces a 22-char URL-safe key", async () => {
        const { key } = await sealShareToken(SAMPLE_YAML);
        // 16 raw bytes (AES-128), unpadded base64url. parseShareLink anchors on
        // exactly this length to tell a share link apart from arbitrary pasted text,
        // so shortening the key means editing SHORT_LINK_RE in the same commit.
        expect(key).toHaveLength(22);
        expect(key).not.toMatch(/[+/=]/);
        expect(base64urlToBytes(key)).toHaveLength(16);
    });

    it("produces a URL-safe payload", async () => {
        const { payload } = await sealShareToken(SAMPLE_YAML);
        expect(payload).not.toMatch(/[+/=]/);
    });

    it("never repeats a payload or key for the same input", async () => {
        const a = await sealShareToken(SAMPLE_YAML);
        const b = await sealShareToken(SAMPLE_YAML);
        // Pins that both the key and the IV are freshly random. A fixed IV with a
        // reused key is what breaks AES-GCM outright.
        expect(a.payload).not.toBe(b.payload);
        expect(a.key).not.toBe(b.key);
    });

    it("rejects the wrong key", async () => {
        const sealed = await sealShareToken(SAMPLE_YAML);
        const other = await sealShareToken(SAMPLE_YAML);
        await expect(openShareToken(sealed.payload, other.key)).rejects.toThrow();
    });

    it("rejects a tampered ciphertext", async () => {
        const sealed = await sealShareToken(SAMPLE_YAML);
        // Flip one character well past the 12-byte IV so the GCM auth tag is what fails.
        const chars = [...sealed.payload];
        const at = chars.length - 5;
        chars[at] = chars[at] === "A" ? "B" : "A";
        await expect(openShareToken(chars.join(""), sealed.key)).rejects.toThrow();
    });

    it("rejects a payload too short to hold an IV, without a raw DOMException", async () => {
        const { key } = await sealShareToken(SAMPLE_YAML);
        await expect(openShareToken("AAAA", key)).rejects.toThrow("分享連結內容無效");
    });

    it("rejects a key of the wrong length", async () => {
        const sealed = await sealShareToken(SAMPLE_YAML);
        await expect(openShareToken(sealed.payload, "A".repeat(22))).rejects.toThrow();
        await expect(openShareToken(sealed.payload, "AAAA")).rejects.toThrow("分享連結內容無效");
    });

    it("rejects an oversized payload before attempting to decrypt it", async () => {
        const { key } = await sealShareToken(SAMPLE_YAML);
        // crypto.subtle.decrypt has no streaming form, so the cap has to bite first.
        await expect(openShareToken("A".repeat(100_001), key)).rejects.toThrow("內容過大");
    });

    it("still rejects a zip bomb after decryption", async () => {
        const sealed = await sealShareToken("a".repeat(6 * 1024 * 1024));
        await expect(openShareToken(sealed.payload, sealed.key)).rejects.toThrow("內容過大");
    });
});
