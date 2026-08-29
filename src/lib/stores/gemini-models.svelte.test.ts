// `createModelPicker` registers an `$effect`, so every test mounts it inside an
// `$effect.root` and drives it with `flushSync` — the `.svelte.` infix in this
// filename is what makes the plugin compile those runes.
import { flushSync } from "svelte";
import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from "vitest";
import {
    clearGeminiModelsMemory,
    GEMINI_MODEL_STORAGE,
    type GeminiModelFilterMode,
    loadGeminiModel,
} from "../infra/api/gemini";
import { createModelPicker } from "./gemini-models.svelte";

function createLocalStorageStub() {
    const store = new Map<string, string>();
    return {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => void store.set(key, value),
        removeItem: (key: string) => void store.delete(key),
        clear: () => store.clear(),
    };
}

function modelsResponse(names: string[]) {
    return {
        ok: true,
        json: () =>
            Promise.resolve({
                models: names.map(name => ({ name: `models/${name}`, displayName: name, supportedGenerationMethods: ["generateContent"] })),
            }),
    };
}

function stubModels(names: string[]) {
    const fetchMock = vi.fn(() => Promise.resolve(modelsResponse(names)));
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
}

function settle(): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, 0));
}

const roots: (() => void)[] = [];

function mountPicker(getKey: () => string | null, getFilterMode?: () => GeminiModelFilterMode) {
    let picker!: ReturnType<typeof createModelPicker>;
    roots.push($effect.root(() => {
        picker = createModelPicker(getKey, getFilterMode);
    }));
    flushSync();
    return picker;
}

beforeEach(() => {
    vi.stubGlobal("localStorage", createLocalStorageStub());
    // The models memo is module-level and keyed by apiKey:filterMode; tests reuse
    // key names, so a leftover settled promise would make a fetch stub dead code.
    clearGeminiModelsMemory();
    vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
    while (roots.length > 0) roots.pop()!();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe("createModelPicker", () => {
    it("stays empty without a key and never fetches", () => {
        const fetchMock = stubModels([]);
        const picker = mountPicker(() => null);
        expect(picker.list).toEqual([]);
        expect(picker.loading).toBe(false);
        expect(picker.error).toBeNull();
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("fetches the key's models and persists an auto-picked default", async () => {
        stubModels(["gemma-9b-it", "gemini-2.5-flash"]);
        const picker = mountPicker(() => "key-a");
        expect(picker.loading).toBe(true);

        await settle();
        expect(picker.loading).toBe(false);
        expect(picker.list.map(m => m.id)).toEqual(["gemma-9b-it", "gemini-2.5-flash"]);
        // pickDefaultModel, not list[0]: the descending sort puts gemma first.
        expect(picker.selected).toBe("gemini-2.5-flash");
        expect(loadGeminiModel()).toBe("gemini-2.5-flash");
    });

    it("keeps a stored preference the key still offers", async () => {
        localStorage.setItem(GEMINI_MODEL_STORAGE, "gemini-2.0-flash");
        stubModels(["gemini-2.5-flash", "gemini-2.0-flash"]);
        const picker = mountPicker(() => "key-a");
        await settle();
        expect(picker.selected).toBe("gemini-2.0-flash");
        expect(loadGeminiModel()).toBe("gemini-2.0-flash");
    });

    it("re-picks when the stored model is not among this key's models", async () => {
        localStorage.setItem(GEMINI_MODEL_STORAGE, "gemini-retired");
        stubModels(["gemini-2.5-flash"]);
        const picker = mountPicker(() => "key-a");
        await settle();
        expect(picker.selected).toBe("gemini-2.5-flash");
        expect(loadGeminiModel()).toBe("gemini-2.5-flash");
    });

    it("hands the filter mode through to the listing", async () => {
        stubModels(["gemini-3.1-pro-preview"]);
        const picker = mountPicker(() => "key-a", () => "all");
        await settle();
        expect(picker.list.map(m => m.id)).toEqual(["gemini-3.1-pro-preview"]);
    });

    it("persists an assignment to selected", () => {
        stubModels([]);
        const picker = mountPicker(() => null);
        picker.selected = "gemini-2.5-pro";
        expect(loadGeminiModel()).toBe("gemini-2.5-pro");
    });

    it("activeModel prefers the selection, then the list default, then the hardcoded fallback", async () => {
        stubModels(["gemini-2.5-flash"]);
        const picker = mountPicker(() => "key-a");
        expect(picker.activeModel).toBe("gemini-3.5-flash");

        await settle();
        expect(picker.activeModel).toBe("gemini-2.5-flash");

        picker.selected = "gemini-2.5-pro";
        expect(picker.activeModel).toBe("gemini-2.5-pro");
    });

    it("surfaces the listing failure instead of swallowing it", async () => {
        vi.stubGlobal(
            "fetch",
            vi.fn(() =>
                Promise.resolve({
                    ok: false,
                    status: 403,
                    json: () => Promise.resolve({ error: { message: "key revoked" } }),
                })
            ),
        );
        const picker = mountPicker(() => "key-a");
        await settle();
        expect(picker.loading).toBe(false);
        expect(picker.list).toEqual([]);
        expect(picker.error).toContain("API 金鑰無效或權限不足");
        expect(picker.error).toContain("key revoked");
    });

    it("retry() refetches after a failure rather than replaying the rejection", async () => {
        const fetchMock = vi.fn<() => Promise<unknown>>(() => Promise.reject(new Error("offline")));
        vi.stubGlobal("fetch", fetchMock);
        const picker = mountPicker(() => "key-a");
        await settle();
        expect(picker.error).toContain("無法連線到 Gemini");

        fetchMock.mockImplementation(() => Promise.resolve(modelsResponse(["gemini-2.5-flash"])));
        picker.retry();
        flushSync();
        await settle();
        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(picker.error).toBeNull();
        expect(picker.list.map(m => m.id)).toEqual(["gemini-2.5-flash"]);
    });

    it("reset() forgets the list, selection, and error", async () => {
        stubModels(["gemini-2.5-flash"]);
        const picker = mountPicker(() => "key-a");
        await settle();

        picker.reset();
        expect(picker.list).toEqual([]);
        expect(picker.selected).toBe("");
        expect(picker.error).toBeNull();
    });

    it("clears the list when the key is removed", async () => {
        stubModels(["gemini-2.5-flash"]);
        let key = $state<string | null>("key-a");
        const picker = mountPicker(() => key);
        await settle();
        expect(picker.list).toHaveLength(1);

        key = null;
        flushSync();
        expect(picker.list).toEqual([]);
        expect(picker.error).toBeNull();
    });

    it("ignores a response that lands after the key changed", async () => {
        let grantFirst!: () => void;
        const fetchMock = vi.fn(() => Promise.resolve(modelsResponse(["gemini-key-b"])));
        fetchMock.mockImplementationOnce(() => new Promise(resolve => (grantFirst = () => resolve(modelsResponse(["gemini-key-a"])))));
        vi.stubGlobal("fetch", fetchMock);

        let key = $state<string | null>("key-a");
        const picker = mountPicker(() => key);
        key = "key-b";
        flushSync();
        await settle();
        expect(picker.list.map(m => m.id)).toEqual(["gemini-key-b"]);

        grantFirst();
        await settle();
        expect(picker.list.map(m => m.id)).toEqual(["gemini-key-b"]);
    });

    it("ignores a response that lands after the component is gone", async () => {
        let grant!: () => void;
        vi.stubGlobal("fetch", vi.fn(() => new Promise(resolve => (grant = () => resolve(modelsResponse(["gemini-2.5-flash"]))))));
        const picker = mountPicker(() => "key-a");
        expect(picker.loading).toBe(true);

        roots.pop()!();
        grant();
        await settle();
        expect(picker.list).toEqual([]);
        expect(picker.loading).toBe(true);
    });
});
