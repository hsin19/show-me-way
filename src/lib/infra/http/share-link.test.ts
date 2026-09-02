import {
    encodeShareToken,
    ShareLinkError,
} from "$lib/domain/share";
import { sealShareToken } from "$lib/domain/share-crypto";
import {
    afterEach,
    describe,
    expect,
    it,
    vi,
} from "vitest";
import { resolveShareLink } from "./share-link";

const YAML = "trip:\n  name: 測試\n";
const KEY22 = "A".repeat(22);

function stubFetchStatus(status: number, body: unknown = { error: "x" }) {
    const text = JSON.stringify(body);
    vi.stubGlobal(
        "fetch",
        vi.fn(() => Promise.resolve({ ok: status >= 200 && status < 300, status, text: () => Promise.resolve(text), json: () => Promise.resolve(body) })),
    );
}

async function rejection(p: Promise<unknown>): Promise<ShareLinkError> {
    try {
        await p;
    } catch (err) {
        expect(err).toBeInstanceOf(ShareLinkError);
        return err as ShareLinkError;
    }
    throw new Error("expected rejection");
}

afterEach(() => {
    vi.unstubAllGlobals();
});

describe("resolveShareLink", () => {
    it("decodes an inline link without touching the network", async () => {
        const fetchMock = vi.fn();
        vi.stubGlobal("fetch", fetchMock);
        expect(await resolveShareLink({ kind: "inline", token: await encodeShareToken(YAML) })).toBe(YAML);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("wraps a corrupt inline token in a non-retryable error with zh-TW copy", async () => {
        const err = await rejection(resolveShareLink({ kind: "inline", token: "not-a-real-deflate-stream" }));
        expect(err.retryable).toBe(false);
        expect(err.message).toBe("分享連結內容無效");
    });

    it("fetches, decrypts and returns the YAML for a short link", async () => {
        const sealed = await sealShareToken(YAML);
        stubFetchStatus(200, { payload: sealed.payload });
        expect(await resolveShareLink({ kind: "short", id: "abcd1234", key: sealed.key })).toBe(YAML);
    });

    it("is retryable when hop cannot be reached — the caller must keep the link", async () => {
        vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new TypeError("Failed to fetch"))));
        const err = await rejection(resolveShareLink({ kind: "short", id: "abcd1234", key: KEY22 }));
        expect(err.retryable).toBe(true);
        expect(err.message).toContain("請檢查網路");
    });

    it("is terminal when hop says the blob is gone", async () => {
        stubFetchStatus(404);
        const err = await rejection(resolveShareLink({ kind: "short", id: "abcd1234", key: KEY22 }));
        expect(err.retryable).toBe(false);
        expect(err.message).toBe("這個分享連結已失效或過期");
    });

    // A messaging app altering one key character leaves a 22-char key that passes
    // every shape check and then fails inside crypto.subtle.decrypt — the browser's
    // OperationError text must not reach the screen.
    it("turns a wrong key into a non-retryable zh-TW error, never a DOMException", async () => {
        const sealed = await sealShareToken(YAML);
        const other = await sealShareToken(YAML);
        stubFetchStatus(200, { payload: sealed.payload });
        const err = await rejection(resolveShareLink({ kind: "short", id: "abcd1234", key: other.key }));
        expect(err.retryable).toBe(false);
        expect(err.message).toBe("分享連結內容無效");
    });

    // pnpm dev over http://<LAN-IP> has no SubtleCrypto. The link is fine, the
    // browser is not, so it must survive for the user to open it elsewhere.
    it("is retryable, and skips the fetch, when this context has no SubtleCrypto", async () => {
        const fetchMock = vi.fn();
        vi.stubGlobal("fetch", fetchMock);
        vi.stubGlobal("crypto", { getRandomValues: crypto.getRandomValues.bind(crypto) });
        const err = await rejection(resolveShareLink({ kind: "short", id: "abcd1234", key: KEY22 }));
        expect(err.retryable).toBe(true);
        expect(fetchMock).not.toHaveBeenCalled();
    });
});
