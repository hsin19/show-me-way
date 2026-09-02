import { encodeShareToken } from "$lib/domain/share";
import { sealShareToken } from "$lib/domain/share-crypto";
import { validateYaml } from "$lib/domain/trip";
import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from "vitest";
import { TripStore } from "./trip.svelte";

const TEST_YAML = `trip:
  name: 東京之旅
  city: 東京
  currency: JPY
  start: '2025-05-01'
  end: '2025-05-02'
  departure: '2025-05-01T08:00:00+08:00'
  hotels: []
days:
  - date: '2025-05-01'
    title: 抵達
    timeline:
      - time: '10:00'
        title: 抵達機場
todo:
  - text: 買網卡
    checked: false
packing:
  - text: 護照
    checked: true
expenses: []
`;

function createLocalStorageStub() {
    const store = new Map<string, string>();
    return {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => void store.set(key, value),
        removeItem: (key: string) => void store.delete(key),
        clear: () => store.clear(),
    };
}

describe("TripStore", () => {
    let store: TripStore;
    const originalLocalStorage = globalThis.localStorage;

    beforeEach(() => {
        globalThis.localStorage = createLocalStorageStub() as unknown as Storage;
        vi.stubGlobal("window", {
            setTimeout: (handler: () => void, timeout?: number) => setTimeout(handler, timeout),
        });
        store = new TripStore();
        store.data = validateYaml(TEST_YAML);
    });

    afterEach(() => {
        globalThis.localStorage = originalLocalStorage;
        vi.unstubAllGlobals();
    });

    it("derives prep totals and done count correctly", () => {
        expect(store.prepTotal).toBe(2);
        expect(store.prepDone).toBe(1);
    });

    it("toggles checklist items", () => {
        const todoItem = store.data!.todo[0];
        expect(todoItem.checked).toBe(false);

        store.toggleChecklistItem("todo", todoItem._id!);
        expect(todoItem.checked).toBe(true);

        store.toggleChecklistItem("todo", todoItem._id!);
        expect(todoItem.checked).toBe(false);
    });

    it("adds and deletes checklist items", () => {
        store.addChecklistItem("todo", "新待辦事項");
        expect(store.data!.todo.length).toBe(2);
        expect(store.data!.todo[1].text).toBe("新待辦事項");

        const newId = store.data!.todo[1]._id!;
        store.deleteChecklistItem("todo", newId);
        expect(store.data!.todo.length).toBe(1);
    });

    it("manages trip wallets", () => {
        expect(store.data!.trip.wallets).toBeUndefined();
        store.addTripWallet("公費");
        expect(store.data!.trip.wallets).toEqual(["公費"]);

        // Duplicate wallet ignored
        store.addTripWallet("公費");
        expect(store.data!.trip.wallets).toEqual(["公費"]);
    });

    it("adds, deletes, and resets expenses", () => {
        store.addExpense("拉麵", 1200, "現金", "2025-05-01");
        expect(store.data!.expenses.length).toBe(1);
        expect(store.data!.expenses[0].name).toBe("拉麵");
        expect(store.data!.expenses[0].amount).toBe(1200);

        const expId = store.data!.expenses[0]._id!;
        store.deleteExpense(expId);
        expect(store.data!.expenses.length).toBe(0);

        store.addExpense("壽司", 3000, "刷卡");
        expect(store.data!.expenses.length).toBe(1);
        store.resetLedger();
        expect(store.data!.expenses.length).toBe(0);
    });

    it("updates timeline event status", () => {
        const event = store.data!.days[0].timeline[0];
        expect(event.status).toBeUndefined();

        store.setEventStatus(event._id!, "done");
        expect(event.status).toBe("done");

        store.setEventStatus(event._id!, undefined);
        expect(event.status).toBeUndefined();
    });

    /**
     * These pin when the URL hash may be cleared. For a `#h=` link the address bar
     * holds the only copy of the decryption key on this device, so clearing it after
     * a failure a refresh could have fixed destroys the link the user just scanned.
     * The rule is easy to "tidy up" back into an unconditional finally — hence tests.
     */
    describe("maybeImportSharedItinerary", () => {
        let replaceState: ReturnType<typeof vi.fn>;

        function stubHash(hash: string) {
            vi.stubGlobal("location", { hash, pathname: "/", search: "" });
        }

        function stubFetchStatus(status: number, body: unknown = { error: "x" }) {
            const text = JSON.stringify(body);
            vi.stubGlobal(
                "fetch",
                vi.fn(() =>
                    Promise.resolve({
                        ok: status >= 200 && status < 300,
                        status,
                        text: () => Promise.resolve(text),
                        json: () => Promise.resolve(body),
                    })
                ),
            );
        }

        beforeEach(() => {
            replaceState = vi.fn();
            vi.stubGlobal("history", { replaceState });
            vi.stubGlobal("confirm", () => true);
        });

        it("keeps the hash when the blob cannot be fetched — the key lives only there", async () => {
            stubHash(`#h=abcd1234.${"A".repeat(22)}`);
            vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new TypeError("Failed to fetch"))));

            await store.maybeImportSharedItinerary();
            expect(replaceState).not.toHaveBeenCalled();
        });

        it("keeps the hash on a 5xx or 429, which a refresh may still fix", async () => {
            stubHash(`#h=abcd1234.${"A".repeat(22)}`);
            stubFetchStatus(503);
            await store.maybeImportSharedItinerary();
            expect(replaceState).not.toHaveBeenCalled();

            stubFetchStatus(429);
            await store.maybeImportSharedItinerary();
            expect(replaceState).not.toHaveBeenCalled();
        });

        // Only 404/410 prove the blob is gone. A proxy or WAF answering 403 does not,
        // and guessing wrong here destroys the key the user just scanned.
        it("keeps the hash on any other 4xx", async () => {
            stubHash(`#h=abcd1234.${"A".repeat(22)}`);
            stubFetchStatus(403);
            await store.maybeImportSharedItinerary();
            expect(replaceState).not.toHaveBeenCalled();
        });

        // pnpm dev reached over http://<LAN-IP> has no SubtleCrypto. The link is fine,
        // this browser is not — it must survive for the user to open it over https.
        it("keeps the hash, and skips the fetch, when this context has no SubtleCrypto", async () => {
            stubHash(`#h=abcd1234.${"A".repeat(22)}`);
            const fetchMock = vi.fn();
            vi.stubGlobal("fetch", fetchMock);
            vi.stubGlobal("crypto", { getRandomValues: crypto.getRandomValues.bind(crypto) });

            await store.maybeImportSharedItinerary();
            expect(fetchMock).not.toHaveBeenCalled();
            expect(replaceState).not.toHaveBeenCalled();
        });

        it("clears the hash when the blob is gone, because a refresh cannot help", async () => {
            stubHash(`#h=abcd1234.${"A".repeat(22)}`);
            stubFetchStatus(404);

            await store.maybeImportSharedItinerary();
            expect(replaceState).toHaveBeenCalled();
        });

        it("clears the hash when the payload cannot be decrypted", async () => {
            stubHash(`#h=abcd1234.${"A".repeat(22)}`);
            stubFetchStatus(200, { payload: "AAAAAAAAAAAAAAAAAAAA" });

            await store.maybeImportSharedItinerary();
            expect(replaceState).toHaveBeenCalled();
        });

        it("imports a short link and clears the hash on success", async () => {
            const sealed = await sealShareToken(TEST_YAML);
            stubHash(`#h=abcd1234.${sealed.key}`);
            stubFetchStatus(200, { payload: sealed.payload });

            await store.maybeImportSharedItinerary();
            expect(replaceState).toHaveBeenCalled();
            expect(localStorage.getItem("showmeway_user_yaml")).toContain("東京之旅");
        });

        it("leaves the inline path untouched — no fetch, hash always cleared", async () => {
            const fetchMock = vi.fn();
            vi.stubGlobal("fetch", fetchMock);
            stubHash(`#s=${await encodeShareToken(TEST_YAML)}`);

            await store.maybeImportSharedItinerary();
            expect(fetchMock).not.toHaveBeenCalled();
            expect(replaceState).toHaveBeenCalled();
            expect(localStorage.getItem("showmeway_user_yaml")).toContain("東京之旅");
        });

        it("does nothing at all without a share link in the hash", async () => {
            const fetchMock = vi.fn();
            vi.stubGlobal("fetch", fetchMock);
            stubHash("");

            await store.maybeImportSharedItinerary();
            expect(fetchMock).not.toHaveBeenCalled();
            expect(replaceState).not.toHaveBeenCalled();
        });
    });

    describe("share link building", () => {
        let writeText: ReturnType<typeof vi.fn>;

        beforeEach(() => {
            writeText = vi.fn(() => Promise.resolve());
            // No `share` on this navigator, so the clipboard path is taken and the link
            // can be read back from writeText.
            vi.stubGlobal("navigator", { clipboard: { writeText } });
            vi.stubGlobal("location", { origin: "https://trip.hsin19.com", pathname: "/", search: "", hash: "" });
        });

        function stubHopCreate(id: string) {
            vi.stubGlobal(
                "fetch",
                vi.fn(() => Promise.resolve({ ok: true, status: 201, json: () => Promise.resolve({ id }), text: () => Promise.resolve(JSON.stringify({ id })) })),
            );
        }

        it("mints a short link when hop returns a well-formed id", async () => {
            stubHopCreate("abcd1234");
            await store.exportTripUrl();
            expect(writeText).toHaveBeenCalledTimes(1);
            expect(writeText.mock.calls[0][0]).toMatch(/^https:\/\/trip\.hsin19\.com\/#h=abcd1234\.[A-Za-z0-9_-]{22}$/);
        });

        // hop owns its id format. An id parseShareLink refuses would be a dead QR with a
        // success toast on the sender's side, so the inline link is the safe answer.
        it("falls back to the inline link when hop hands back an id no receiver would parse", async () => {
            stubHopCreate("x".repeat(40));
            await store.exportTripUrl();
            expect(writeText).toHaveBeenCalledTimes(1);
            expect(writeText.mock.calls[0][0]).toMatch(/^https:\/\/trip\.hsin19\.com\/#s=/);
        });

        // Building a link is a network round trip now; a second tap mid-flight must not
        // upload a second blob or race the clipboard.
        it("ignores a second tap while a link is still being built", async () => {
            let release: () => void = () => {};
            const gate = new Promise<void>(resolve => (release = resolve));
            vi.stubGlobal(
                "fetch",
                vi.fn(() => gate.then(() => ({ ok: true, status: 201, json: () => Promise.resolve({ id: "abcd1234" }) }))),
            );

            const first = store.shareCurrentTrip();
            expect(store.isSharing).toBe(true);
            const second = store.shareCurrentTrip();
            release();
            await Promise.all([first, second]);

            expect(fetch).toHaveBeenCalledTimes(1);
            expect(writeText).toHaveBeenCalledTimes(1);
            expect(store.isSharing).toBe(false);
        });
    });
});
