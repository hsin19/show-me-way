import {
    afterEach,
    describe,
    expect,
    it,
    vi,
} from "vitest";
import {
    buildShareUrl,
    clearShareHash,
    decodeShareToken,
    encodeShareToken,
    isShareSupported,
    readShareTokenFromHash,
    SHARE_HASH_PARAM,
} from "./share";

const SAMPLE_YAML = `trip:
  name: 東京自由行 🗼
  start: '2026-06-11'
  end: '2026-06-15'
days:
  - day: 1
    region: 新宿
`;

describe("encodeShareToken / decodeShareToken", () => {
    it("round-trips a YAML string unchanged", async () => {
        const token = await encodeShareToken(SAMPLE_YAML);
        expect(await decodeShareToken(token)).toBe(SAMPLE_YAML);
    });

    it("preserves multibyte content (Chinese + emoji)", async () => {
        const text = "trip:\n  name: 測試行程 🍜🚕\n";
        const token = await encodeShareToken(text);
        expect(await decodeShareToken(token)).toBe(text);
    });

    it("produces a URL-safe token (no +, / or = padding)", async () => {
        const token = await encodeShareToken(SAMPLE_YAML);
        expect(token).not.toMatch(/[+/=]/);
    });

    it("handles an empty string", async () => {
        const token = await encodeShareToken("");
        expect(await decodeShareToken(token)).toBe("");
    });

    it("rejects a corrupt token", async () => {
        // Valid base64url chars, but not a valid deflate-raw stream.
        await expect(decodeShareToken("not-a-real-deflate-stream")).rejects.toThrow();
    });
});

describe("isShareSupported", () => {
    it("is true where Compression Streams exist (test runtime)", () => {
        expect(isShareSupported()).toBe(true);
    });
});

describe("URL hash helpers", () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it("buildShareUrl embeds a decodable token in the hash", async () => {
        vi.stubGlobal("location", { origin: "https://hsin19.github.io", pathname: "/show-me-way/" });
        const url = await buildShareUrl(SAMPLE_YAML);
        expect(url.startsWith(`https://hsin19.github.io/show-me-way/#${SHARE_HASH_PARAM}=`)).toBe(true);

        const token = url.split(`#${SHARE_HASH_PARAM}=`)[1];
        expect(await decodeShareToken(token)).toBe(SAMPLE_YAML);
    });

    it("readShareTokenFromHash extracts the token, or null when absent", () => {
        vi.stubGlobal("location", { hash: "#s=abc123" });
        expect(readShareTokenFromHash()).toBe("abc123");

        vi.stubGlobal("location", { hash: "" });
        expect(readShareTokenFromHash()).toBeNull();

        vi.stubGlobal("location", { hash: "#other=1" });
        expect(readShareTokenFromHash()).toBeNull();
    });

    it("clearShareHash strips the hash without a reload", () => {
        const replaceState = vi.fn();
        vi.stubGlobal("history", { replaceState });
        vi.stubGlobal("location", { pathname: "/show-me-way/", search: "" });
        clearShareHash();
        expect(replaceState).toHaveBeenCalledWith(null, "", "/show-me-way/");
    });
});
