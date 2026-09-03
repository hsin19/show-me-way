import { openShareToken } from "$lib/domain/share-crypto";
import { createLocalStorageStub } from "$lib/testing/stubs";
import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from "vitest";

// The store reads storage when its module is evaluated, so each test rebuilds the module
// graph and imports a fresh instance — the pattern pwa-install.svelte.test.ts uses.
async function freshStore() {
    vi.resetModules();
    return (await import("./share-link.svelte")).shareLinks;
}

type Call = { method: string; url: string; body: string | undefined; auth: string | null; };

function json(body: unknown, status = 200) {
    return { ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body), text: () => Promise.resolve(JSON.stringify(body)) };
}

/** hop that mints `id` on POST, answers PUT with `putStatus` and DELETE with `deleteStatus`. */
function stubHop(id: string, opts: { putStatus?: number; deleteStatus?: number; } = {}) {
    const calls: Call[] = [];
    vi.stubGlobal(
        "fetch",
        vi.fn((url: string, init?: RequestInit) => {
            const headers = (init?.headers ?? {}) as Record<string, string>;
            const method = init?.method ?? "GET";
            calls.push({ method, url, body: init?.body as string | undefined, auth: headers["Authorization"] ?? null });
            if (method === "POST") return Promise.resolve(json({ id, editToken: `tok-${id}`, expiresAt: 1_000 }, 201));
            if (method === "PUT") {
                const status = opts.putStatus ?? 200;
                return Promise.resolve(json(status === 200 ? { expiresAt: 2_000 } : { error: "x" }, status));
            }
            const status = opts.deleteStatus ?? 204;
            return Promise.resolve({ ok: status < 300, status });
        }),
    );
    return calls;
}

const KEY_RE = /#h=[A-Za-z0-9]+\.([A-Za-z0-9_-]{22})$/;

describe("shareLinks", () => {
    beforeEach(() => {
        vi.stubGlobal("localStorage", createLocalStorageStub());
        vi.stubGlobal("location", { origin: "https://trip.hsin19.com", pathname: "/", search: "", hash: "" });
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it("mints a link the first time and remembers id, key and token for the slot", async () => {
        const store = await freshStore();
        const calls = stubHop("abcd1234");

        const outcome = await store.publish("p-1", "trip:\n  name: a\n");

        expect(outcome.kind).toBe("created");
        const key = KEY_RE.exec((outcome as { url: string; }).url)![1]!;
        expect(store.forTrip("p-1")).toMatchObject({ id: "abcd1234", key, editToken: "tok-abcd1234", expiresAt: new Date(1_000).toISOString() });
        // Uploaded: ciphertext the fragment's key opens, and not the key itself.
        expect(await openShareToken(calls[0]!.body!, key)).toBe("trip:\n  name: a\n");
        expect(JSON.stringify(calls)).not.toContain(key);
    });

    it("re-encrypts under the stored key and PUTs to the stored id on the next publish", async () => {
        const store = await freshStore();
        const calls = stubHop("abcd1234");
        const first = await store.publish("p-1", "v1") as { url: string; };
        const key = KEY_RE.exec(first.url)![1]!;

        const second = await store.publish("p-1", "v2");

        expect(second).toEqual({ kind: "updated", url: first.url });
        expect(calls[1]).toMatchObject({ method: "PUT", url: "https://hop.hsin19.com/api/v1/blobs/abcd1234?ttl=31536000", auth: "Bearer tok-abcd1234" });
        expect(await openShareToken(calls[1]!.body!, key)).toBe("v2");
        expect(store.forTrip("p-1")?.expiresAt).toBe(new Date(2_000).toISOString());
    });

    it("forgets a link hop reports gone and mints a replacement, reporting it as recreated", async () => {
        const store = await freshStore();
        stubHop("abcd1234");
        await store.publish("p-1", "v1");
        const calls = stubHop("efgh5678", { putStatus: 404 });

        const outcome = await store.publish("p-1", "v2");

        expect(outcome.kind).toBe("recreated");
        expect((outcome as { url: string; }).url).toContain("#h=efgh5678.");
        expect(calls.map(c => c.method)).toEqual(["PUT", "POST"]);
        expect(store.forTrip("p-1")?.id).toBe("efgh5678");
    });

    it("treats a rejected token like a gone link", async () => {
        const store = await freshStore();
        stubHop("abcd1234");
        await store.publish("p-1", "v1");
        stubHop("efgh5678", { putStatus: 401 });
        expect((await store.publish("p-1", "v2")).kind).toBe("recreated");
    });

    it("refuses to mint or fall back when an existing link cannot be reached", async () => {
        const store = await freshStore();
        stubHop("abcd1234");
        await store.publish("p-1", "v1");
        const calls = stubHop("efgh5678", { putStatus: 503 });

        expect(await store.publish("p-1", "v2")).toEqual({ kind: "unreachable" });
        expect(calls.map(c => c.method)).toEqual(["PUT"]);
        expect(store.forTrip("p-1")?.id).toBe("abcd1234");
    });

    it("falls back to the inline link and remembers nothing when hop refuses a first upload", async () => {
        const store = await freshStore();
        vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new TypeError("Failed to fetch"))));

        const outcome = await store.publish("p-1", "v1");

        expect(outcome.kind).toBe("inline");
        expect((outcome as { url: string; }).url).toContain("#s=");
        expect(store.forTrip("p-1")).toBeNull();
    });

    it("keys links by slot, so two trips never share one", async () => {
        const store = await freshStore();
        stubHop("abcd1234");
        await store.publish("p-1", "v1");
        stubHop("efgh5678");
        await store.publish("p-2", "v1");
        expect(store.forTrip("p-1")?.id).toBe("abcd1234");
        expect(store.forTrip("p-2")?.id).toBe("efgh5678");
    });

    it("survives a reload through storage", async () => {
        let store = await freshStore();
        stubHop("abcd1234");
        await store.publish("p-1", "v1");
        store = await freshStore();
        expect(store.forTrip("p-1")?.id).toBe("abcd1234");
    });

    describe("revoke", () => {
        it("DELETEs with the token and forgets the record", async () => {
            const store = await freshStore();
            stubHop("abcd1234");
            await store.publish("p-1", "v1");
            const calls = stubHop("abcd1234");

            expect(await store.revoke("p-1")).toBe("revoked");
            expect(calls[0]).toMatchObject({ method: "DELETE", url: "https://hop.hsin19.com/api/v1/blobs/abcd1234", auth: "Bearer tok-abcd1234" });
            expect(store.forTrip("p-1")).toBeNull();
        });

        it("counts an already-gone blob as revoked, but keeps the record when hop is unreachable", async () => {
            const store = await freshStore();
            stubHop("abcd1234");
            await store.publish("p-1", "v1");
            stubHop("abcd1234", { deleteStatus: 503 });
            expect(await store.revoke("p-1")).toBe("unreachable");
            expect(store.forTrip("p-1")).not.toBeNull();
            stubHop("abcd1234", { deleteStatus: 404 });
            expect(await store.revoke("p-1")).toBe("revoked");
            expect(store.forTrip("p-1")).toBeNull();
        });

        it("is a no-op without a link", async () => {
            const store = await freshStore();
            const fetchMock = vi.fn();
            vi.stubGlobal("fetch", fetchMock);
            expect(await store.revoke("p-none")).toBe("revoked");
            expect(fetchMock).not.toHaveBeenCalled();
        });
    });

    it("forget drops the record without calling hop", async () => {
        const store = await freshStore();
        stubHop("abcd1234");
        await store.publish("p-1", "v1");
        const fetchMock = vi.fn();
        vi.stubGlobal("fetch", fetchMock);
        store.forget("p-1");
        expect(store.forTrip("p-1")).toBeNull();
        expect(fetchMock).not.toHaveBeenCalled();
    });
});
