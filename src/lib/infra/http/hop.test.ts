import {
    afterEach,
    describe,
    expect,
    it,
    vi,
} from "vitest";
import {
    createHopBlob,
    fetchHopBlob,
} from "./hop";

function stubFetch(impl: (url: string, init?: RequestInit) => unknown) {
    const fetchMock = vi.fn((url: string, init?: RequestInit) => Promise.resolve(impl(url, init)));
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
}

function jsonResponse(body: unknown, status = 200) {
    const text = JSON.stringify(body);
    return { ok: status >= 200 && status < 300, status, text: () => Promise.resolve(text), json: () => Promise.resolve(body) };
}

afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
});

describe("hop base URL", () => {
    it("uses the production host when the variable is absent or blank", async () => {
        vi.stubEnv("VITE_HOP_BASE_URL", "");
        const fetchMock = stubFetch(() => jsonResponse({ id: "abcd1234" }, 201));
        await createHopBlob("CIPHERTEXT");
        expect(fetchMock.mock.calls[0][0]).toBe("https://hop.hsin19.com/api/v1/blobs");
    });

    it("honours an override and tolerates a trailing slash", async () => {
        vi.stubEnv("VITE_HOP_BASE_URL", "http://localhost:8787/");
        const fetchMock = stubFetch(() => jsonResponse({ id: "abcd1234", payload: "X" }));
        await fetchHopBlob("abcd1234");
        expect(fetchMock.mock.calls[0][0]).toBe("http://localhost:8787/api/v1/blobs/abcd1234");
    });
});

describe("createHopBlob", () => {
    it("posts the ciphertext as a CORS-simple text/plain body", async () => {
        vi.stubEnv("VITE_HOP_BASE_URL", "");
        const fetchMock = stubFetch(() => jsonResponse({ id: "abcd1234", editToken: "tok" }, 201));

        const res = await createHopBlob("CIPHERTEXT");
        expect(res).toEqual({ ok: true, id: "abcd1234", editToken: "tok" });

        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toBe("https://hop.hsin19.com/api/v1/blobs");
        expect(init?.method).toBe("POST");
        // application/json would trigger a preflight OPTIONS on this request.
        expect((init?.headers as Record<string, string>)["Content-Type"]).toBe("text/plain");
        expect(init?.body).toBe("CIPHERTEXT");
    });

    it("refuses an oversized payload locally instead of waiting for a 413", async () => {
        const fetchMock = stubFetch(() => jsonResponse({ id: "abcd1234" }, 201));

        expect(await createHopBlob("A".repeat(100_001))).toEqual({ ok: false });
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("refuses an empty payload", async () => {
        const fetchMock = stubFetch(() => jsonResponse({ id: "abcd1234" }, 201));
        expect(await createHopBlob("")).toEqual({ ok: false });
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("reports failure on a server error, a bad body, or a dead network", async () => {
        stubFetch(() => jsonResponse({ error: "nope" }, 500));
        expect(await createHopBlob("CIPHERTEXT")).toEqual({ ok: false });

        stubFetch(() => jsonResponse({ notAnId: true }, 201));
        expect(await createHopBlob("CIPHERTEXT")).toEqual({ ok: false });

        vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new TypeError("Failed to fetch"))));
        expect(await createHopBlob("CIPHERTEXT")).toEqual({ ok: false });
    });
});

describe("fetchHopBlob", () => {
    it("returns the ciphertext", async () => {
        vi.stubEnv("VITE_HOP_BASE_URL", "");
        const fetchMock = stubFetch(() => jsonResponse({ id: "abcd1234", payload: "CIPHERTEXT" }));

        expect(await fetchHopBlob("abcd1234")).toEqual({ ok: true, cipher: "CIPHERTEXT" });
        expect(fetchMock.mock.calls[0][0]).toBe("https://hop.hsin19.com/api/v1/blobs/abcd1234");
    });

    // The reason/ok split is what decides whether the caller may clear the URL hash,
    // and the hash is the only copy of the decryption key on the device.
    it("calls a 404 or 410 terminal", async () => {
        stubFetch(() => jsonResponse({ error: "gone" }, 404));
        expect(await fetchHopBlob("abcd1234")).toEqual({ ok: false, reason: "gone" });

        stubFetch(() => jsonResponse({ error: "gone" }, 410));
        expect(await fetchHopBlob("abcd1234")).toEqual({ ok: false, reason: "gone" });
    });

    it("calls a 429 or 5xx retryable", async () => {
        stubFetch(() => jsonResponse({ error: "slow down" }, 429));
        expect(await fetchHopBlob("abcd1234")).toEqual({ ok: false, reason: "network" });

        stubFetch(() => jsonResponse({ error: "boom" }, 503));
        expect(await fetchHopBlob("abcd1234")).toEqual({ ok: false, reason: "network" });
    });

    // A proxy or WAF rule in front of hop answers these without the blob being gone.
    it("calls any other 4xx retryable rather than terminal", async () => {
        for (const status of [400, 401, 403, 418]) {
            stubFetch(() => jsonResponse({ error: "nope" }, status));
            expect(await fetchHopBlob("abcd1234")).toEqual({ ok: false, reason: "network" });
        }
    });

    it("calls an offline or aborted request retryable", async () => {
        vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new TypeError("Failed to fetch"))));
        expect(await fetchHopBlob("abcd1234")).toEqual({ ok: false, reason: "network" });

        vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new DOMException("Aborted", "TimeoutError"))));
        expect(await fetchHopBlob("abcd1234")).toEqual({ ok: false, reason: "network" });
    });

    it("rejects a response past the size cap before it can be decrypted, without calling the blob gone", async () => {
        stubFetch(() => ({
            ok: true,
            status: 200,
            text: () => Promise.resolve("x".repeat(200_002)),
        }));
        expect(await fetchHopBlob("abcd1234")).toEqual({ ok: false, reason: "network" });
    });

    // A misrouted deploy serving an HTML page with permissive CORS looks exactly like
    // this, and a refresh later may well work — so it must not cost the user the link.
    it("treats a malformed or payload-less body as retryable", async () => {
        stubFetch(() => ({ ok: true, status: 200, text: () => Promise.resolve("<!doctype html>") }));
        expect(await fetchHopBlob("abcd1234")).toEqual({ ok: false, reason: "network" });

        stubFetch(() => jsonResponse({ id: "abcd1234" }));
        expect(await fetchHopBlob("abcd1234")).toEqual({ ok: false, reason: "network" });
    });
});
