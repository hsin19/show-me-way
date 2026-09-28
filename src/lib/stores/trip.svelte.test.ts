import { encodeShareToken } from "$lib/domain/share";
import { sealShareToken } from "$lib/domain/share-crypto";
import {
    serializeToYaml,
    validateYaml,
} from "$lib/domain/trip";
import { yamlFingerprint } from "$lib/domain/utils";
import { appStorage } from "$lib/infra/storage/app-storage";
import {
    ensureActiveProfileId,
    listProfiles,
    PROFILES_KEY,
} from "$lib/infra/storage/profiles";
import {
    backupCurrentYaml,
    listYamlBackups,
    USER_YAML_KEY,
} from "$lib/infra/storage/yaml-storage";
import {
    createLocalStorageStub,
    stubWindowTimers,
} from "$lib/testing/stubs";
import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    onTestFinished,
    vi,
} from "vitest";
import { gdriveSync } from "./gdrive.svelte";
import { settingsDraft } from "./settings-draft.svelte";
import { shareLinks } from "./share-link.svelte";
import {
    runToastAction,
    toast,
} from "./toast.svelte";
import { tripOrigins } from "./trip-origin.svelte";
import { TripStore } from "./trip.svelte";

const TEST_YAML = `trip:
  name: 東京之旅
  city: 東京
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
        type: standard
todo:
  - text: 買網卡
    checked: false
packing:
  - text: 護照
    checked: true
`;

describe("TripStore", () => {
    let store: TripStore;
    const originalLocalStorage = globalThis.localStorage;

    beforeEach(() => {
        globalThis.localStorage = createLocalStorageStub();
        stubWindowTimers();
        store = new TripStore();
        store.data = validateYaml(TEST_YAML);
    });

    afterEach(() => {
        globalThis.localStorage = originalLocalStorage;
        vi.unstubAllGlobals();
    });

    it("a failed load leaves no trip behind, so nothing can be persisted over the slot that failed", async () => {
        const broken = "trip:\n  name: '壞掉的'\n";
        localStorage.setItem("showmeway_user_yaml", broken);
        await store.load();
        expect(store.data).toBeNull();
        expect(store.loadError).toBeTruthy();
        // The previous trip used to survive here and get written into this slot by the next toggle.
        expect(store.persist()).toBe(false);
        expect(localStorage.getItem("showmeway_user_yaml")).toBe(broken);
    });

    it("derives prep totals and done count correctly", () => {
        expect(store.prepTotal).toBe(2);
        expect(store.prepDone).toBe(1);
    });

    it("toggles checklist items", () => {
        const todoItem = store.data!.todo[0]!;
        expect(todoItem.checked).toBe(false);

        store.toggleChecklistItem("todo", todoItem._id!);
        expect(todoItem.checked).toBe(true);

        store.toggleChecklistItem("todo", todoItem._id!);
        expect(todoItem.checked).toBe(false);
    });

    it("adds and deletes checklist items", () => {
        store.addChecklistItem("todo", "新待辦事項");
        expect(store.data!.todo.length).toBe(2);
        expect(store.data!.todo[1]?.text).toBe("新待辦事項");

        const newId = store.data!.todo[1]!._id!;
        store.deleteChecklistItem("todo", newId);
        expect(store.data!.todo.length).toBe(1);
    });

    it("updates timeline event status", () => {
        const event = store.data!.days[0]!.timeline[0]!;
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

        it("keeps the hash when the trip could not be stored, since nothing else holds the key", async () => {
            const sealed = await sealShareToken(TEST_YAML);
            stubHash(`#h=abcd1234.${sealed.key}`);
            stubFetchStatus(200, { payload: sealed.payload });
            const storage = globalThis.localStorage;
            const setItem = storage.setItem.bind(storage);
            vi.spyOn(storage, "setItem").mockImplementation((key, value) => {
                if (key === "showmeway_user_yaml") throw new DOMException("full", "QuotaExceededError");
                setItem(key, value);
            });

            await store.maybeImportSharedItinerary();
            expect(replaceState).not.toHaveBeenCalled();
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
        let calls: { method: string; url: string; auth: string | null; }[];

        beforeEach(() => {
            writeText = vi.fn(() => Promise.resolve());
            calls = [];
            // No `share` on this navigator, so the clipboard path is taken and the link
            // can be read back from writeText.
            vi.stubGlobal("navigator", { clipboard: { writeText } });
            vi.stubGlobal("location", { origin: "https://trip.hsin19.com", pathname: "/", search: "", hash: "" });
        });

        function json(body: unknown, status = 200) {
            return { ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body), text: () => Promise.resolve(JSON.stringify(body)) };
        }

        /** hop that mints `id` on POST and answers PUT with `putStatus`. Records every call. */
        function stubHop(id: string, putStatus = 200) {
            vi.stubGlobal(
                "fetch",
                vi.fn((url: string, init?: RequestInit) => {
                    const headers = (init?.headers ?? {}) as Record<string, string>;
                    calls.push({ method: init?.method ?? "GET", url, auth: headers["Authorization"] ?? null });
                    if (init?.method === "POST") return Promise.resolve(json({ id, editToken: `tok-${id}`, expiresAt: 1 }, 201));
                    return Promise.resolve(json(putStatus === 200 ? { expiresAt: 2 } : { error: "x" }, putStatus));
                }),
            );
        }

        const SHORT = /^https:\/\/trip\.hsin19\.com\/#h=([A-Za-z0-9]+)\.([A-Za-z0-9_-]{22})$/;

        it("mints a short link when hop returns a well-formed id", async () => {
            stubHop("abcd1234");
            await store.shareCurrentTrip();
            expect(writeText).toHaveBeenCalledTimes(1);
            expect(writeText.mock.calls[0]?.[0]).toMatch(/^https:\/\/trip\.hsin19\.com\/#h=abcd1234\.[A-Za-z0-9_-]{22}$/);
            // A persistent link asks for hop's maximum lifetime, not its 90-day default.
            expect(calls[0]?.url).toBe("https://hop.hsin19.com/api/v1/blobs?ttl=31536000");
        });

        // hop owns its id format. An id parseShareLink refuses would be a dead QR with a
        // success toast on the sender's side, so the inline link is the safe answer.
        it("falls back to the inline link when hop hands back an id no receiver would parse", async () => {
            stubHop("x".repeat(40));
            await store.shareCurrentTrip();
            expect(writeText).toHaveBeenCalledTimes(1);
            expect(writeText.mock.calls[0]?.[0]).toMatch(/^https:\/\/trip\.hsin19\.com\/#s=/);
        });

        // The whole point of remembering the link: a QR code printed from the first tap
        // must keep resolving to whatever the trip says now.
        it("updates the same id and key on the second tap instead of minting a new link", async () => {
            stubHop("abcd1234");
            await store.shareCurrentTrip();
            const first = writeText.mock.calls[0]?.[0] as string;
            store.data!.trip.name = "改名了";
            await store.shareCurrentTrip();

            expect(writeText.mock.calls[1]?.[0]).toBe(first);
            expect(calls.map(c => c.method)).toEqual(["POST", "PUT"]);
            expect(calls[1]?.url).toBe("https://hop.hsin19.com/api/v1/blobs/abcd1234?ttl=31536000");
            expect(calls[1]?.auth).toBe("Bearer tok-abcd1234");
            // The key rides in the fragment only — never in the update request either.
            const key = SHORT.exec(first)![2]!;
            expect(JSON.stringify(calls)).not.toContain(key);
        });

        it("mints a new link when hop says the old one is gone, so the user gets a working URL", async () => {
            stubHop("abcd1234");
            await store.shareCurrentTrip();
            const first = writeText.mock.calls[0]?.[0] as string;
            stubHop("efgh5678", 404);
            calls = [];
            await store.shareCurrentTrip();

            const second = writeText.mock.calls[1]?.[0] as string;
            expect(second).toMatch(/#h=efgh5678\./);
            expect(second).not.toBe(first);
            expect(calls.map(c => c.method)).toEqual(["PUT", "POST"]);
        });

        // The owner's other devices find a link on the trip's Drive file, so only hop's own
        // answer that it is dead may take it off there — never a failure to reach hop.
        it.each([
            { hop: "404 and no replacement", put: () => json({ error: "x" }, 404), post: () => Promise.reject(new TypeError("Failed to fetch")), drop: true, push: false },
            { hop: "401 and no replacement", put: () => json({ error: "x" }, 401), post: () => Promise.reject(new TypeError("Failed to fetch")), drop: true, push: false },
            { hop: "404 and a replacement", put: () => json({ error: "x" }, 404), post: () => json({ id: "efgh5678", editToken: "tok-efgh5678", expiresAt: 1 }, 201), drop: false, push: true },
            { hop: "503", put: () => json({ error: "x" }, 503), post: () => Promise.reject(new TypeError("unused")), drop: false, push: false },
            { hop: "unreachable", put: () => Promise.reject(new TypeError("Failed to fetch")), post: () => Promise.reject(new TypeError("unused")), drop: false, push: false },
        ])("on an existing link hop answers $hop: drops it from Drive $drop, pushes a new one $push", async ({ put, post, drop, push }) => {
            stubHop("abcd1234");
            await store.shareCurrentTrip();
            const pushSpy = vi.spyOn(gdriveSync, "pushShareLink").mockResolvedValue();
            const dropSpy = vi.spyOn(gdriveSync, "dropDeadShareLink").mockResolvedValue();
            onTestFinished(() => {
                vi.restoreAllMocks();
            });
            vi.stubGlobal("fetch", vi.fn((_url: string, init?: RequestInit) => Promise.resolve(init?.method === "PUT" ? put() : post())));

            await store.shareCurrentTrip();

            expect(dropSpy.mock.calls).toEqual(drop ? [[expect.any(String), "abcd1234"]] : []);
            expect(pushSpy).toHaveBeenCalledTimes(push ? 1 : 0);
        });

        // Minting a fresh link here would split the audience across two ids, and the
        // inline fallback would hand over a URL different from the one already sent around.
        it("hands out nothing when an existing link cannot be updated because hop is unreachable", async () => {
            stubHop("abcd1234");
            await store.shareCurrentTrip();
            vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new TypeError("Failed to fetch"))));
            await store.shareCurrentTrip();

            expect(writeText).toHaveBeenCalledTimes(1);
            expect(store.isSharing).toBe(false);
            // The record survives, so the next tap retries the same link.
            stubHop("zzzz9999");
            await store.shareCurrentTrip();
            expect(calls.at(-1)?.method).toBe("PUT");
            expect(calls.at(-1)?.url).toContain("/abcd1234");
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

describe("TripStore whole-document writes", () => {
    const originalLocalStorage = globalThis.localStorage;
    // No `city`: `load()` would otherwise kick off a weather fetch these tests have no answer for.
    // Canonical, because storage holds nothing else: these stand for what the app wrote.
    const LOCAL_YAML = serializeToYaml(validateYaml(`trip:
  name: 本機行程
  id: t-local
  hotels: []
days:
  - date: '2025-05-01'
    title: 抵達
    timeline:
      - time: '10:00'
        title: 抵達機場
        type: standard
todo:
  - text: 買網卡
    checked: false
`));
    const CLOUD_YAML = LOCAL_YAML.replace("本機行程", "雲端行程").replace("t-local", "t-cloud");
    const BROKEN_YAML = "trip:\n  name: '壞掉的'\n";
    let store: TripStore;
    let profileId: string;

    beforeEach(() => {
        globalThis.localStorage = createLocalStorageStub();
        stubWindowTimers();
        vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("offline"))));
        vi.stubGlobal("confirm", () => true);
        settingsDraft.yaml = null;
        appStorage.set(USER_YAML_KEY, LOCAL_YAML);
        profileId = ensureActiveProfileId();
        store = new TripStore();
        store.data = validateYaml(LOCAL_YAML);
    });

    afterEach(() => {
        globalThis.localStorage = originalLocalStorage;
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    describe("landYaml", () => {
        // A file this app did not write lands as different bytes than its record hashed, which
        // is what makes it read as a local edit and brings up the upload that repairs it.
        it("stores a whole document canonical whatever bytes it came in, and reports those", async () => {
            const handWritten = `${LOCAL_YAML.replace("本機行程", "手改過").replace("  hotels: []\n", "  hotels: []\n  start: '2020-01-01'\n")}# 手寫註解\n`;
            const outcome = await store.landYaml(profileId, handWritten);
            expect(outcome.kind).toBe("landed");
            const stored = appStorage.get(USER_YAML_KEY);
            expect(stored).toBe(serializeToYaml(validateYaml(handWritten)));
            expect(outcome.kind === "landed" && outcome.yaml).toBe(stored);
            expect(listYamlBackups()[0]?.yaml).toBe(LOCAL_YAML);
        });

        // In place means the same trip; a document that lost or changed its id must not cut it
        // loose from the binding and link the slot carries.
        it("keeps the slot's trip.id whatever the document says", async () => {
            const outcome = await store.landYaml(profileId, CLOUD_YAML);
            expect(outcome.kind).toBe("landed");
            expect(appStorage.get(USER_YAML_KEY)).toContain("id: t-local");
            expect(appStorage.get(USER_YAML_KEY)).toContain("雲端行程");
        });

        it("writes nothing for YAML that does not validate", async () => {
            const outcome = await store.landYaml(profileId, BROKEN_YAML);
            expect(outcome.kind).toBe("invalid");
            expect(outcome.kind === "invalid" && outcome.yaml).toBe(BROKEN_YAML);
            expect(appStorage.get(USER_YAML_KEY)).toBe(LOCAL_YAML);
            expect(listYamlBackups()).toEqual([]);
        });

        it("refuses to land bytes meant for a trip that is no longer active", async () => {
            const outcome = await store.landYaml("a-profile-switched-away-from", CLOUD_YAML);
            expect(outcome.kind).toBe("aborted");
            expect(appStorage.get(USER_YAML_KEY)).toBe(LOCAL_YAML);
        });
    });

    describe("syncWithCloud", () => {
        it("lands a pulled copy and only then records it", async () => {
            const commit = vi.fn();
            const pulled = LOCAL_YAML.replace("本機行程", "雲端改過的本機行程");
            vi.spyOn(gdriveSync, "sync").mockResolvedValue({ action: "pulled", yaml: pulled, commit });
            const outcome = await store.syncWithCloud(profileId, LOCAL_YAML);
            expect(outcome?.kind).toBe("landed");
            expect(appStorage.get(USER_YAML_KEY)).toBe(pulled);
            expect(commit).toHaveBeenCalledTimes(1);
        });

        it("never records a pull that failed validation, and leaves it in the editor draft instead", async () => {
            const commit = vi.fn();
            vi.spyOn(gdriveSync, "sync").mockResolvedValue({ action: "pulled", yaml: BROKEN_YAML, commit });
            const outcome = await store.syncWithCloud(profileId, LOCAL_YAML);
            expect(outcome?.kind).toBe("invalid");
            expect(commit).not.toHaveBeenCalled();
            expect(appStorage.get(USER_YAML_KEY)).toBe(LOCAL_YAML);
            expect(settingsDraft.yaml).toBe(BROKEN_YAML);
        });

        it("reports nothing to land when the sync pushed or raised a conflict", async () => {
            vi.spyOn(gdriveSync, "sync").mockResolvedValue({ action: "conflict" });
            expect(await store.syncWithCloud(profileId, LOCAL_YAML)).toBeNull();
            expect(appStorage.get(USER_YAML_KEY)).toBe(LOCAL_YAML);
        });
    });

    describe("keepBothVersions", () => {
        it("parks the cloud copy under this trip's id and branches the local one into a trip of its own", async () => {
            vi.spyOn(gdriveSync, "sync").mockResolvedValue({ action: "pulled", yaml: CLOUD_YAML, commit: vi.fn() });
            const outcome = await store.keepBothVersions(profileId, LOCAL_YAML);
            expect(outcome?.kind).toBe("landed");
            const active = appStorage.get(USER_YAML_KEY) ?? "";
            expect(active).toContain("本機行程（本機版）");
            expect(active).not.toContain("t-local");
            const parked = listProfiles().map(p => p.name);
            expect(parked).toEqual(["雲端行程"]);
        });

        it("forks nothing when the cloud copy could not land", async () => {
            vi.spyOn(gdriveSync, "sync").mockResolvedValue({ action: "pulled", yaml: BROKEN_YAML, commit: vi.fn() });
            const outcome = await store.keepBothVersions(profileId, LOCAL_YAML);
            expect(outcome?.kind).toBe("invalid");
            expect(listProfiles()).toEqual([]);
            expect(appStorage.get(USER_YAML_KEY)).toBe(LOCAL_YAML);
        });
    });

    describe("loadCloudTrip", () => {
        afterEach(() => {
            gdriveSync.unbindTrip(ensureActiveProfileId());
        });

        it("adds the file's trip as one of its own, bound to that file, and parks the current one", async () => {
            vi.spyOn(gdriveSync, "loadTripYaml").mockResolvedValue({ yaml: CLOUD_YAML, md5: "md5-cloud" });

            const outcome = await store.loadCloudTrip("file-cloud", "雲端行程");

            expect(outcome?.kind).toBe("landed");
            // As downloaded, so the record just adopted agrees with what is stored.
            expect(appStorage.get(USER_YAML_KEY)).toBe(CLOUD_YAML);
            expect(gdriveSync.cloudFileId(ensureActiveProfileId())).toBe("file-cloud");
            expect(gdriveSync.hasUnpushedEdits(ensureActiveProfileId(), CLOUD_YAML)).toBe(false);
            expect(listProfiles().map(p => p.name)).toEqual(["本機行程"]);
        });

        // Reachable when Drive holds a duplicate of a trip this device has bound elsewhere.
        it("keeps a copy of a trip this device holds unbound, so it cannot claim the duplicate file", async () => {
            vi.spyOn(gdriveSync, "loadTripYaml").mockResolvedValue({ yaml: LOCAL_YAML.replace("本機行程", "本機行程重複檔"), md5: "md5-dup" });
            vi.stubGlobal("confirm", vi.fn().mockReturnValueOnce(false).mockReturnValue(true));

            const outcome = await store.loadCloudTrip("file-dup", "本機行程重複檔");

            expect(outcome?.kind).toBe("landed");
            expect(appStorage.get(USER_YAML_KEY)).not.toContain("t-local");
            expect(gdriveSync.cloudFileId(ensureActiveProfileId())).toBeNull();
        });

        it("writes the trip on screen back first when storage missed its last edit", async () => {
            vi.spyOn(gdriveSync, "loadTripYaml").mockResolvedValue({ yaml: CLOUD_YAML });
            const item = store.data?.todo[0];
            if (item) item.checked = true;

            await store.loadCloudTrip("file-cloud", "雲端行程");

            expect(listProfiles()).toHaveLength(1);
            const parked = JSON.parse(appStorage.get(PROFILES_KEY) ?? "[]") as { yaml: string; }[];
            expect(parked[0]?.yaml).toContain("checked: true");
        });

        it("hands an invalid download to the editor draft instead of parking anything", async () => {
            vi.spyOn(gdriveSync, "loadTripYaml").mockResolvedValue({ yaml: BROKEN_YAML });
            const outcome = await store.loadCloudTrip("file-1", "雲端行程");
            expect(outcome?.kind).toBe("invalid");
            expect(outcome?.kind === "invalid" && outcome.yaml).toBe(BROKEN_YAML);
            expect(settingsDraft.yaml).toBe(BROKEN_YAML);
            expect(appStorage.get(USER_YAML_KEY)).toBe(LOCAL_YAML);
        });
    });

    describe("saveFromEditor", () => {
        it("saves an edit of this trip in place, in canonical form, without asking", async () => {
            const ask = vi.fn(() => true);
            vi.stubGlobal("confirm", ask);
            const edited = LOCAL_YAML.replace("本機行程", "本機行程改").replace("  hotels: []\n", "  hotels: []\n  departure: '2020-01-01T00:00:00'\n");

            const outcome = await store.saveFromEditor(profileId, edited);

            expect(outcome.kind).toBe("landed");
            expect(ask).not.toHaveBeenCalled();
            expect(ensureActiveProfileId()).toBe(profileId);
            expect(appStorage.get(USER_YAML_KEY)).not.toMatch(/^\s+departure:/m);
            expect(store.data?.trip.name).toBe("本機行程改");
            expect(listYamlBackups()[0]?.yaml).toBe(LOCAL_YAML);
        });

        // The slot is still wearing this trip's Drive binding; writing another trip into it
        // would push that trip over this one's cloud file.
        it("adds another trip as one of its own, leaving the current one parked with its binding", async () => {
            gdriveSync.adoptCloudTrip(profileId, "file-local", LOCAL_YAML);
            onTestFinished(() => {
                gdriveSync.unbindTrip(profileId);
            });

            const outcome = await store.saveFromEditor(profileId, CLOUD_YAML);

            expect(outcome.kind).toBe("landed");
            expect(ensureActiveProfileId()).not.toBe(profileId);
            expect(store.data?.trip.name).toBe("雲端行程");
            expect(listProfiles().map(p => p.name)).toEqual(["本機行程"]);
            expect(gdriveSync.cloudFileId(profileId)).toBe("file-local");
            expect(gdriveSync.cloudFileId(ensureActiveProfileId())).toBeNull();
        });

        // The schema's own promise: deleting `trip.id` severs the trip from its cloud file.
        it("counts YAML without a trip.id as another trip, and writes nothing when that is declined", async () => {
            const ask = vi.fn(() => false);
            vi.stubGlobal("confirm", ask);

            const outcome = await store.saveFromEditor(profileId, LOCAL_YAML.replace("  id: t-local\n", ""));

            expect(outcome.kind).toBe("aborted");
            expect(ask).toHaveBeenCalledTimes(1);
            expect(appStorage.get(USER_YAML_KEY)).toBe(LOCAL_YAML);
            expect(listProfiles()).toEqual([]);
        });

        it("leaves what was typed alone when it does not parse", async () => {
            const outcome = await store.saveFromEditor(profileId, BROKEN_YAML);
            expect(outcome.kind).toBe("invalid");
            expect(outcome.kind === "invalid" && outcome.yaml).toBe(BROKEN_YAML);
            expect(appStorage.get(USER_YAML_KEY)).toBe(LOCAL_YAML);
        });

        it("treats a pasted share link as a trip of its own and parks the current one", async () => {
            vi.stubGlobal("location", { origin: "https://trip.hsin19.com", pathname: "/", search: "", hash: "" });
            const link = `https://trip.hsin19.com/#s=${await encodeShareToken(CLOUD_YAML)}`;
            const outcome = await store.saveFromEditor(profileId, link);
            expect(outcome.kind).toBe("landed");
            expect(appStorage.get(USER_YAML_KEY)).toContain("雲端行程");
            expect(listProfiles().map(p => p.name)).toEqual(["本機行程"]);
            expect(store.data?.trip.name).toBe("雲端行程");
        });
    });

    describe("applyAiEdit", () => {
        const proposal = LOCAL_YAML.replace("本機行程", "AI 改過的行程").replace("  id: t-local\n", "");

        it("keeps the trip's id, and 復原 puts back exactly the bytes it replaced", () => {
            expect(store.applyAiEdit(proposal)).toBe(true);
            expect(appStorage.get(USER_YAML_KEY)).toContain("id: t-local");
            expect(store.data?.trip.name).toBe("AI 改過的行程");

            const undo = [...toast.items].reverse().find(item => item.action?.label === "復原");
            runToastAction(undo!.id);

            expect(appStorage.get(USER_YAML_KEY)).toBe(LOCAL_YAML);
            expect(store.data?.trip.name).toBe("本機行程");
        });

        it("says so when storage refuses, instead of claiming the edit applied", () => {
            const storage = globalThis.localStorage;
            const setItem = storage.setItem.bind(storage);
            vi.spyOn(storage, "setItem").mockImplementation((key, value) => {
                if (key === "showmeway_user_yaml") throw new DOMException("full", "QuotaExceededError");
                setItem(key, value);
            });

            expect(store.applyAiEdit(proposal)).toBe(false);

            expect(store.data?.trip.name).toBe("本機行程");
            expect(toast.items.at(-1)?.message).toBe("儲存失敗，請稍後再試");
        });
    });

    describe("createProfile", () => {
        // itinerary.local.yaml can be a trip:sync working copy of a trip already on this device.
        it("gives the new trip an identity of its own, whatever id the template carries", async () => {
            const template = LOCAL_YAML.replace("本機行程", "範本");
            vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response(template))));

            await store.createProfile();

            expect(store.data?.trip.name).toBe("範本");
            expect(store.data?.trip.id).not.toBe("t-local");
            expect(listProfiles().map(p => p.name)).toEqual(["本機行程"]);
        });
    });

    describe("switchProfile", () => {
        // What storage holds is what a sync record hashes; a pull stores the file's bytes as
        // downloaded, and rewriting them on the way out would read as an edit nobody made.
        it("parks the outgoing trip byte for byte when nothing on screen is unsaved", async () => {
            appStorage.set(PROFILES_KEY, JSON.stringify([{ id: "p-other", yaml: CLOUD_YAML, savedAt: "2026-01-01T00:00:00.000Z" }]));

            await store.switchProfile("p-other");

            const parked = JSON.parse(appStorage.get(PROFILES_KEY) ?? "[]") as { id: string; yaml: string; }[];
            expect(parked.find(p => p.id === profileId)?.yaml).toBe(LOCAL_YAML);
        });
    });

    describe("restoreBackup", () => {
        it("puts a backed-up copy back, byte for byte, and snapshots the one it replaces", async () => {
            backupCurrentYaml();
            const edited = LOCAL_YAML.replace("本機行程", "本機行程改");
            appStorage.set(USER_YAML_KEY, edited);
            store.data = validateYaml(edited);
            const savedAt = listYamlBackups()[0]?.savedAt ?? "";
            const outcome = await store.restoreBackup(profileId, savedAt);
            expect(outcome?.kind).toBe("landed");
            expect(ensureActiveProfileId()).toBe(profileId);
            expect(appStorage.get(USER_YAML_KEY)).toBe(LOCAL_YAML);
            expect(listYamlBackups()[0]?.yaml).toBe(edited);
        });

        // The ring is shared by every trip on the device, so a backup can be another trip's.
        it("brings another trip's backup back as a trip of its own, leaving the current one parked with its binding", async () => {
            backupCurrentYaml();
            appStorage.set(USER_YAML_KEY, CLOUD_YAML);
            store.data = validateYaml(CLOUD_YAML);
            gdriveSync.adoptCloudTrip(profileId, "file-cloud", CLOUD_YAML);
            onTestFinished(() => {
                gdriveSync.unbindTrip(profileId);
            });
            const savedAt = listYamlBackups()[0]?.savedAt ?? "";

            const outcome = await store.restoreBackup(profileId, savedAt);

            expect(outcome?.kind).toBe("landed");
            expect(ensureActiveProfileId()).not.toBe(profileId);
            expect(appStorage.get(USER_YAML_KEY)).toBe(LOCAL_YAML);
            expect(listProfiles().map(p => p.name)).toEqual(["雲端行程"]);
            expect(gdriveSync.cloudFileId(profileId)).toBe("file-cloud");
            expect(gdriveSync.cloudFileId(ensureActiveProfileId())).toBeNull();
        });

        it("does nothing for an entry the ring no longer holds", async () => {
            expect(await store.restoreBackup(profileId, "2020-01-01T00:00:00.000Z")).toBeNull();
            expect(appStorage.get(USER_YAML_KEY)).toBe(LOCAL_YAML);
        });
    });

    describe("resetToDefault", () => {
        it("drops the active slot's YAML after backing it up", async () => {
            expect(await store.resetToDefault(profileId)).toBe(true);
            expect(appStorage.get(USER_YAML_KEY)).toBeNull();
            expect(listYamlBackups()[0]?.yaml).toBe(LOCAL_YAML);
        });

        it("refuses once the trip has switched", async () => {
            expect(await store.resetToDefault("a-profile-switched-away-from")).toBe(false);
            expect(appStorage.get(USER_YAML_KEY)).toBe(LOCAL_YAML);
        });

        // The slot outlives its trip, so a share link or origin left on it would reseal the
        // bundled template to the old trip's recipients, or compare it against the sender's.
        it("forgets the slot's share link and origin along with the trip", async () => {
            const link = { id: "abcd1234", key: "a".repeat(22) };
            shareLinks.adopt(profileId, { ...link, editToken: "tok", createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z", expiresAt: null });
            tripOrigins.markShared(profileId, link, LOCAL_YAML);

            expect(await store.resetToDefault(profileId)).toBe(true);

            expect(shareLinks.forTrip(profileId)).toBeNull();
            expect(tripOrigins.isShared(profileId)).toBe(false);
        });

        it("refuses while a share is still in flight, leaving the trip alone", async () => {
            store.isSharing = true;

            expect(await store.resetToDefault(profileId)).toBe(false);

            expect(appStorage.get(USER_YAML_KEY)).toBe(LOCAL_YAML);
        });
    });
});

describe("TripStore shared-link updates", () => {
    const originalLocalStorage = globalThis.localStorage;
    // No `city`, so `load()` starts no weather fetch these tests have no answer for.
    const RECEIVED_YAML = `trip:
  name: 朋友的行程
  id: t-shared
  hotels: []
days:
  - date: '2025-05-01'
    title: 抵達
    timeline:
      - time: '10:00'
        title: 抵達機場
        type: standard
`;
    const LINK = { id: "abcd1234", key: "" };
    let store: TripStore;
    let profileId: string;
    /** Canonical form, which is what lands in storage and what the taken hash is measured in. */
    let received: string;

    /** hop answering with `yaml` sealed under this link's key. */
    async function stubLinkPayload(yaml: string) {
        const sealed = await sealShareToken(yaml);
        LINK.key = sealed.key;
        vi.stubGlobal(
            "fetch",
            vi.fn(() =>
                Promise.resolve({
                    ok: true,
                    status: 200,
                    text: () => Promise.resolve(JSON.stringify({ payload: sealed.payload })),
                    json: () => Promise.resolve({ payload: sealed.payload }),
                })
            ),
        );
    }

    beforeEach(() => {
        globalThis.localStorage = createLocalStorageStub();
        stubWindowTimers();
        settingsDraft.yaml = null;
        received = serializeToYaml(validateYaml(RECEIVED_YAML));
        appStorage.set(USER_YAML_KEY, received);
        profileId = ensureActiveProfileId();
        store = new TripStore();
        store.data = validateYaml(received);
        tripOrigins.forget(profileId);
    });

    afterEach(() => {
        tripOrigins.forget(profileId);
        globalThis.localStorage = originalLocalStorage;
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    it("says nothing when the sender has published nothing new", async () => {
        await stubLinkPayload(received);
        tripOrigins.markShared(profileId, LINK, received);

        await store.checkSharedTripForUpdates(() => {});

        expect(store.sharedUpdate).toBeNull();
    });

    it("offers the sender's new version when this device has not touched its copy", async () => {
        const sendersEdit = received.replace("抵達機場", "抵達車站");
        await stubLinkPayload(sendersEdit);
        tripOrigins.markShared(profileId, LINK, received);

        await store.checkSharedTripForUpdates(() => {});

        expect(store.sharedUpdate?.localChanged).toBe(false);
        expect(store.sharedUpdate?.yaml).toContain("抵達車站");
        // Offered, not applied: nothing is written until the user answers.
        expect(appStorage.get(USER_YAML_KEY)).toBe(received);
    });

    it("reports a divergence when both the sender and this device moved", async () => {
        const sendersEdit = received.replace("抵達機場", "抵達車站");
        await stubLinkPayload(sendersEdit);
        tripOrigins.markShared(profileId, LINK, received);
        appStorage.set(USER_YAML_KEY, received.replace("抵達機場", "先去吃飯"));

        await store.checkSharedTripForUpdates(() => {});

        expect(store.sharedUpdate?.localChanged).toBe(true);
    });

    it("asks nothing for a trip that came from an inline link, which no server holds", async () => {
        const fetchMock = vi.fn();
        vi.stubGlobal("fetch", fetchMock);
        tripOrigins.markShared(profileId, null, received);

        await store.checkSharedTripForUpdates(() => {});

        expect(fetchMock).not.toHaveBeenCalled();
        expect(store.sharedUpdate).toBeNull();
    });

    it("takes the update, records it as taken, and keeps a backup of what it replaced", async () => {
        const sendersEdit = received.replace("抵達機場", "抵達車站");
        await stubLinkPayload(sendersEdit);
        tripOrigins.markShared(profileId, LINK, received);
        await store.checkSharedTripForUpdates(() => {});

        const outcome = await store.takeSharedUpdate();

        expect(outcome?.kind).toBe("landed");
        expect(appStorage.get(USER_YAML_KEY)).toContain("抵達車站");
        expect(tripOrigins.takenHash(profileId)).toBe(yamlFingerprint(serializeToYaml(validateYaml(sendersEdit))));
        expect(store.sharedUpdate).toBeNull();
        expect(listYamlBackups().length).toBe(1);
    });

    it("reopening the link and overwriting records what landed as taken, so the next check finds nothing", async () => {
        const sendersEdit = received.replace("抵達機場", "抵達車站");
        tripOrigins.markShared(profileId, { ...LINK }, received);
        // The sender recreated the link, so the reopened one carries a different id.
        await stubLinkPayload(sendersEdit);
        vi.stubGlobal("confirm", () => true);

        const outcome = await store.saveFromEditor(profileId, `#h=wxyz9876.${LINK.key}`);

        expect(outcome.kind).toBe("landed");
        expect(appStorage.get(USER_YAML_KEY)).toContain("抵達車站");
        expect(tripOrigins.takenHash(profileId)).toBe(yamlFingerprint(serializeToYaml(validateYaml(sendersEdit))));
        expect(tripOrigins.linkFor(profileId)).toEqual({ id: "wxyz9876", key: LINK.key });

        await store.checkSharedTripForUpdates(() => {});
        expect(store.sharedUpdate).toBeNull();
    });

    it("drops the offer once another trip takes the slot it was about", async () => {
        await stubLinkPayload(received.replace("抵達機場", "抵達車站"));
        tripOrigins.markShared(profileId, LINK, received);
        await store.checkSharedTripForUpdates(() => {});
        vi.stubGlobal("confirm", () => true);

        await store.saveFromEditor(profileId, `#s=${await encodeShareToken(RECEIVED_YAML.replace("t-shared", "t-other"))}`);

        expect(store.sharedUpdate).toBeNull();
    });

    it("keeping the local version records the sender's copy as seen without applying it", async () => {
        const sendersEdit = received.replace("抵達機場", "抵達車站");
        await stubLinkPayload(sendersEdit);
        tripOrigins.markShared(profileId, LINK, received);
        await store.checkSharedTripForUpdates(() => {});

        store.keepLocalOverSharedUpdate();

        expect(appStorage.get(USER_YAML_KEY)).toBe(received);
        expect(store.sharedUpdate).toBeNull();
        // Settled rather than suppressed: the sender's copy counts as taken, so a later
        // check of that same version finds nothing and only their next change asks again.
        expect(tripOrigins.takenHash(profileId)).toBe(yamlFingerprint(serializeToYaml(validateYaml(sendersEdit))));
    });
});
