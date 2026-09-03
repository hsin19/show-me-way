import { encodeShareToken } from "$lib/domain/share";
import { sealShareToken } from "$lib/domain/share-crypto";
import { validateYaml } from "$lib/domain/trip";
import {
    ensureActiveProfileId,
    listProfiles,
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
    vi,
} from "vitest";
import { gdriveSync } from "./gdrive.svelte";
import { settingsDraft } from "./settings-draft.svelte";
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
    const LOCAL_YAML = `trip:
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
`;
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
        localStorage.setItem(USER_YAML_KEY, LOCAL_YAML);
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
        it("stores the canonical form when asked, backing up what it replaces", async () => {
            const handwritten = CLOUD_YAML.replace("  hotels: []\n", "  hotels: []\n  start: '2020-01-01'\n");
            const outcome = await store.landYaml(profileId, handwritten, { canonical: true });
            expect(outcome.kind).toBe("landed");
            const stored = localStorage.getItem(USER_YAML_KEY);
            expect(stored).toContain("雲端行程");
            expect(stored).not.toMatch(/^\s+start:/m);
            expect(outcome.kind === "landed" && outcome.yaml).toBe(stored);
            expect(listYamlBackups()[0]?.yaml).toBe(LOCAL_YAML);
            expect(store.data?.trip.name).toBe("雲端行程");
        });

        it("keeps the bytes as given by default, so a cloud pull stores what the sync record hashes", async () => {
            const asDownloaded = CLOUD_YAML.replace("  hotels: []\n", "  hotels: []\n  start: '2020-01-01'\n");
            const outcome = await store.landYaml(profileId, asDownloaded);
            expect(outcome.kind).toBe("landed");
            expect(localStorage.getItem(USER_YAML_KEY)).toBe(asDownloaded);
        });

        it("writes nothing for YAML that does not validate", async () => {
            const outcome = await store.landYaml(profileId, BROKEN_YAML);
            expect(outcome.kind).toBe("invalid");
            expect(outcome.kind === "invalid" && outcome.yaml).toBe(BROKEN_YAML);
            expect(localStorage.getItem(USER_YAML_KEY)).toBe(LOCAL_YAML);
            expect(listYamlBackups()).toEqual([]);
        });

        it("refuses to land bytes meant for a trip that is no longer active", async () => {
            const outcome = await store.landYaml("a-profile-switched-away-from", CLOUD_YAML);
            expect(outcome.kind).toBe("aborted");
            expect(localStorage.getItem(USER_YAML_KEY)).toBe(LOCAL_YAML);
        });
    });

    describe("syncWithCloud", () => {
        it("lands a pulled copy and only then records it", async () => {
            const commit = vi.fn();
            vi.spyOn(gdriveSync, "sync").mockResolvedValue({ action: "pulled", yaml: CLOUD_YAML, commit });
            const outcome = await store.syncWithCloud(profileId, LOCAL_YAML);
            expect(outcome?.kind).toBe("landed");
            expect(localStorage.getItem(USER_YAML_KEY)).toBe(CLOUD_YAML);
            expect(commit).toHaveBeenCalledTimes(1);
        });

        it("never records a pull that failed validation, and leaves it in the editor draft instead", async () => {
            const commit = vi.fn();
            vi.spyOn(gdriveSync, "sync").mockResolvedValue({ action: "pulled", yaml: BROKEN_YAML, commit });
            const outcome = await store.syncWithCloud(profileId, LOCAL_YAML);
            expect(outcome?.kind).toBe("invalid");
            expect(commit).not.toHaveBeenCalled();
            expect(localStorage.getItem(USER_YAML_KEY)).toBe(LOCAL_YAML);
            expect(settingsDraft.yaml).toBe(BROKEN_YAML);
        });

        it("reports nothing to land when the sync pushed or raised a conflict", async () => {
            vi.spyOn(gdriveSync, "sync").mockResolvedValue({ action: "conflict" });
            expect(await store.syncWithCloud(profileId, LOCAL_YAML)).toBeNull();
            expect(localStorage.getItem(USER_YAML_KEY)).toBe(LOCAL_YAML);
        });
    });

    describe("keepBothVersions", () => {
        it("parks the cloud copy under this trip's id and branches the local one into a trip of its own", async () => {
            vi.spyOn(gdriveSync, "sync").mockResolvedValue({ action: "pulled", yaml: CLOUD_YAML, commit: vi.fn() });
            const outcome = await store.keepBothVersions(profileId, LOCAL_YAML);
            expect(outcome?.kind).toBe("landed");
            const active = localStorage.getItem(USER_YAML_KEY) ?? "";
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
            expect(localStorage.getItem(USER_YAML_KEY)).toBe(LOCAL_YAML);
        });
    });

    describe("loadCloudTrip", () => {
        it("flushes in-memory edits before the outgoing trip is parked", async () => {
            const spy = vi.spyOn(gdriveSync, "importCloudTripAsProfile").mockImplementation((_fileId, beforeCommit) => {
                expect(beforeCommit?.()).toBe(true);
                // What `createProfile` would now read out of storage carries the edit.
                expect(localStorage.getItem(USER_YAML_KEY)).toContain("checked: true");
                return Promise.resolve({ ok: true as const, yaml: CLOUD_YAML, profileId: "p-cloud" });
            });
            const item = store.data?.todo[0];
            if (item) item.checked = true;
            const outcome = await store.loadCloudTrip("file-1", "雲端行程");
            expect(spy).toHaveBeenCalledTimes(1);
            expect(outcome?.kind).toBe("landed");
        });

        it("hands an invalid download to the editor draft instead of parking anything", async () => {
            vi.spyOn(gdriveSync, "importCloudTripAsProfile").mockResolvedValue({ ok: false, yaml: BROKEN_YAML, error: "壞了" });
            const outcome = await store.loadCloudTrip("file-1", "雲端行程");
            expect(outcome).toEqual({ kind: "invalid", yaml: BROKEN_YAML, error: "壞了" });
            expect(settingsDraft.yaml).toBe(BROKEN_YAML);
            expect(localStorage.getItem(USER_YAML_KEY)).toBe(LOCAL_YAML);
        });
    });

    describe("saveFromEditor", () => {
        it("saves typed YAML in canonical form", async () => {
            const outcome = await store.saveFromEditor(profileId, CLOUD_YAML.replace("  hotels: []\n", "  hotels: []\n  departure: '2020-01-01T00:00:00'\n"));
            expect(outcome.kind).toBe("landed");
            expect(localStorage.getItem(USER_YAML_KEY)).not.toMatch(/^\s+departure:/m);
            expect(store.data?.trip.name).toBe("雲端行程");
        });

        it("leaves what was typed alone when it does not parse", async () => {
            const outcome = await store.saveFromEditor(profileId, BROKEN_YAML);
            expect(outcome.kind).toBe("invalid");
            expect(outcome.kind === "invalid" && outcome.yaml).toBe(BROKEN_YAML);
            expect(localStorage.getItem(USER_YAML_KEY)).toBe(LOCAL_YAML);
        });

        it("treats a pasted share link as a trip of its own and parks the current one", async () => {
            vi.stubGlobal("location", { origin: "https://trip.hsin19.com", pathname: "/", search: "", hash: "" });
            const link = `https://trip.hsin19.com/#s=${await encodeShareToken(CLOUD_YAML)}`;
            const outcome = await store.saveFromEditor(profileId, link);
            expect(outcome.kind).toBe("imported");
            expect(localStorage.getItem(USER_YAML_KEY)).toContain("雲端行程");
            expect(listProfiles().map(p => p.name)).toEqual(["本機行程"]);
            expect(store.data?.trip.name).toBe("雲端行程");
        });
    });

    describe("restoreBackup", () => {
        it("puts a backed-up copy back and snapshots the one it replaces", async () => {
            backupCurrentYaml();
            localStorage.setItem(USER_YAML_KEY, CLOUD_YAML);
            const savedAt = listYamlBackups()[0]?.savedAt ?? "";
            const outcome = await store.restoreBackup(profileId, savedAt);
            expect(outcome?.kind).toBe("landed");
            expect(localStorage.getItem(USER_YAML_KEY)).toBe(LOCAL_YAML);
            expect(listYamlBackups()[0]?.yaml).toBe(CLOUD_YAML);
        });

        it("does nothing for an entry the ring no longer holds", async () => {
            expect(await store.restoreBackup(profileId, "2020-01-01T00:00:00.000Z")).toBeNull();
            expect(localStorage.getItem(USER_YAML_KEY)).toBe(LOCAL_YAML);
        });
    });

    describe("resetToDefault", () => {
        it("drops the active slot's YAML after backing it up", async () => {
            expect(await store.resetToDefault(profileId)).toBe(true);
            expect(localStorage.getItem(USER_YAML_KEY)).toBeNull();
            expect(listYamlBackups()[0]?.yaml).toBe(LOCAL_YAML);
        });

        it("refuses once the trip has switched", async () => {
            expect(await store.resetToDefault("a-profile-switched-away-from")).toBe(false);
            expect(localStorage.getItem(USER_YAML_KEY)).toBe(LOCAL_YAML);
        });
    });
});
