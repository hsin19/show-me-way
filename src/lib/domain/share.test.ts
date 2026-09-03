import {
    afterEach,
    describe,
    expect,
    it,
    vi,
} from "vitest";
import {
    buildShareUrl,
    buildShortShareUrl,
    clearShareHash,
    decodeShareToken,
    encodeShareToken,
    isShareSupported,
    parseShareLink,
    readShareLinkFromHash,
    SHARE_HASH_PARAM,
    SHORT_HASH_PARAM,
} from "./share";

/** 22 unpadded base64url chars — the exact shape parseShareLink anchors the key half on. */
const KEY22 = "A".repeat(22);

const SAMPLE_YAML = `trip:
  name: 東京自由行 🗼
  start: '2026-06-11'
  end: '2026-06-15'
days:
  - day: 1
    title: 新宿
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

    it("rejects a zip bomb before buffering it whole", async () => {
        // 6MB of one repeated character compresses to a tiny token; decoding it
        // must stop at the decompressed-size cap instead of materializing 6MB.
        const token = await encodeShareToken("a".repeat(6 * 1024 * 1024));
        await expect(decodeShareToken(token)).rejects.toThrow("內容過大");
    });

    it("rejects an absurdly long token without attempting to decode it", async () => {
        await expect(decodeShareToken("A".repeat(100_001))).rejects.toThrow("內容過大");
    });
});

describe("isShareSupported", () => {
    it("is true where Compression Streams exist (test runtime)", () => {
        expect(isShareSupported()).toBe(true);
    });
});

describe("parseShareLink — inline (#s=)", () => {
    it("extracts the token from a full share URL", () => {
        expect(parseShareLink("https://hsin19.github.io/show-me-way/#s=abc123"))
            .toEqual({ kind: "inline", token: "abc123" });
    });

    it("extracts the token from a bare hash fragment", () => {
        expect(parseShareLink("#s=abc123")).toEqual({ kind: "inline", token: "abc123" });
    });

    it("returns null for plain YAML or a hash without a known param", () => {
        expect(parseShareLink("trip:\n  name: 東京\n")).toBeNull();
        expect(parseShareLink("https://example.com/#other=1")).toBeNull();
    });

    it("ignores a token past the length cap", () => {
        expect(parseShareLink(`#s=${"A".repeat(100_001)}`)).toBeNull();
    });

    it("rejects false sniffs from export YAML carrying &s= inside a URL field", () => {
        const exportYaml = "# yaml-language-server: $schema=https://example.com/schema.json\n"
            + "trip:\n  name: '測試'\n  hotels: []\ndays:\n"
            + "  - day: 1\n    timeline:\n"
            + "      - title: '店'\n        mapLink: 'https://example.com/?a=1&s=xyz'\n";
        expect(parseShareLink(exportYaml)).toBeNull();
    });

    it("round-trips through buildShareUrl output", async () => {
        vi.stubGlobal("location", { origin: "https://hsin19.github.io", pathname: "/show-me-way/" });
        const link = parseShareLink(await buildShareUrl(SAMPLE_YAML));
        expect(link?.kind).toBe("inline");
        expect(await decodeShareToken((link as { token: string; }).token)).toBe(SAMPLE_YAML);
        vi.unstubAllGlobals();
    });
});

describe("parseShareLink — short (#h=)", () => {
    it("splits the id and key", () => {
        expect(parseShareLink(`#h=abcd1234.${KEY22}`))
            .toEqual({ kind: "short", id: "abcd1234", key: KEY22 });
    });

    it("round-trips through buildShortShareUrl output", () => {
        vi.stubGlobal("location", { origin: "https://trip.hsin19.com", pathname: "/" });
        const url = buildShortShareUrl("abcd1234", KEY22);
        expect(url).not.toBeNull();
        expect(parseShareLink(url!)).toEqual({ kind: "short", id: "abcd1234", key: KEY22 });
        vi.unstubAllGlobals();
    });

    it("rejects a key that is not exactly 22 chars", () => {
        expect(parseShareLink(`#h=abcd1234.${"A".repeat(21)}`)).toBeNull();
        expect(parseShareLink(`#h=abcd1234.${"A".repeat(23)}`)).toBeNull();
    });

    it("rejects non-base64url characters in either half", () => {
        expect(parseShareLink(`#h=abcd1234.${"+".repeat(22)}`)).toBeNull();
        expect(parseShareLink(`#h=abcd/234.${KEY22}`)).toBeNull();
    });

    it("rejects a missing half", () => {
        expect(parseShareLink("#h=abcd1234")).toBeNull();
        expect(parseShareLink(`#h=${KEY22}`)).toBeNull();
        expect(parseShareLink("#h=a.b")).toBeNull();
    });

    it("rejects false sniffs from export YAML carrying &h= inside a URL field", () => {
        const exportYaml = "trip:\n  name: '測試'\ndays:\n  - day: 1\n    timeline:\n"
            + "      - title: '店'\n        mapLink: 'https://example.com/?a=1&h=xyz'\n";
        expect(parseShareLink(exportYaml)).toBeNull();
    });

    // Pins the precedence: every link that worked before the short form existed must
    // still take the identical path, even if something appends an `h` param to it.
    it("prefers the inline token when both params are present", () => {
        expect(parseShareLink(`#s=abc123&h=abcd1234.${KEY22}`))
            .toEqual({ kind: "inline", token: "abc123" });
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

        const token = url.split(`#${SHARE_HASH_PARAM}=`)[1]!;
        expect(await decodeShareToken(token)).toBe(SAMPLE_YAML);
    });

    it("buildShortShareUrl keeps the link on this app's origin", () => {
        const suffix = `#${SHORT_HASH_PARAM}=abcd1234.${KEY22}`;

        vi.stubGlobal("location", { origin: "https://trip.hsin19.com", pathname: "/" });
        expect(buildShortShareUrl("abcd1234", KEY22)).toBe(`https://trip.hsin19.com/${suffix}`);

        // The GitHub Pages copy lives under a sub-path; a hardcoded origin would pass
        // every local check and only break there.
        vi.stubGlobal("location", { origin: "https://hsin19.github.io", pathname: "/show-me-way/" });
        expect(buildShortShareUrl("abcd1234", KEY22)).toBe(`https://hsin19.github.io/show-me-way/${suffix}`);
    });

    // hop decides the id format, not this app. A link minted from an id parseShareLink
    // would refuse is a dead QR with a success toast on the sender's side.
    it("buildShortShareUrl refuses an id parseShareLink would not accept", () => {
        vi.stubGlobal("location", { origin: "https://trip.hsin19.com", pathname: "/" });
        expect(buildShortShareUrl("a".repeat(33), KEY22)).toBeNull();
        expect(buildShortShareUrl("has.dot", KEY22)).toBeNull();
        expect(buildShortShareUrl("abc", KEY22)).toBeNull();
        expect(buildShortShareUrl("abcd1234", "A".repeat(21))).toBeNull();
        expect(buildShortShareUrl("abcd1234", KEY22)).not.toBeNull();
    });

    it("readShareLinkFromHash reports the link, or null when absent", () => {
        vi.stubGlobal("location", { hash: "#s=abc123" });
        expect(readShareLinkFromHash()).toEqual({ kind: "inline", token: "abc123" });

        vi.stubGlobal("location", { hash: `#h=abcd1234.${KEY22}` });
        expect(readShareLinkFromHash()).toEqual({ kind: "short", id: "abcd1234", key: KEY22 });

        vi.stubGlobal("location", { hash: "" });
        expect(readShareLinkFromHash()).toBeNull();

        vi.stubGlobal("location", { hash: "#other=1" });
        expect(readShareLinkFromHash()).toBeNull();
    });

    it("clearShareHash strips the hash without a reload", () => {
        const replaceState = vi.fn();
        vi.stubGlobal("history", { replaceState });
        vi.stubGlobal("location", { pathname: "/show-me-way/", search: "" });
        clearShareHash();
        expect(replaceState).toHaveBeenCalledWith(null, "", "/show-me-way/");
    });
});
