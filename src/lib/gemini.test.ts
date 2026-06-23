import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from "vitest";
import type { TripData } from "./api";
import {
    clearGeminiApiKey,
    GEMINI_API_KEY_STORAGE,
    GEMINI_MODEL_STORAGE,
    listGeminiModels,
    loadGeminiApiKey,
    loadGeminiModel,
    saveGeminiApiKey,
    saveGeminiModel,
    sendChatMessage,
} from "./gemini";

function createLocalStorageStub() {
    const store = new Map<string, string>();
    return {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => void store.set(key, value),
        removeItem: (key: string) => void store.delete(key),
        clear: () => store.clear(),
    };
}

const tripData: TripData = {
    trip: { name: "Test Trip", start: "2026-06-11", end: "2026-06-13", departure: "2026-06-11T14:00:00+08:00", hotels: [] },
    todo: [],
    packing: [],
    days: [],
    expenses: [],
};

beforeEach(() => {
    vi.stubGlobal("localStorage", createLocalStorageStub());
});

afterEach(() => {
    vi.unstubAllGlobals();
});

describe("Gemini API key storage", () => {
    it("saves, reads (trimmed), and clears the key", () => {
        expect(loadGeminiApiKey()).toBeNull();

        saveGeminiApiKey("  AIza-test-key  ");
        expect(localStorage.getItem(GEMINI_API_KEY_STORAGE)).toBe("AIza-test-key");
        expect(loadGeminiApiKey()).toBe("AIza-test-key");

        clearGeminiApiKey();
        expect(loadGeminiApiKey()).toBeNull();
    });

    it("treats a blank stored value as no key", () => {
        localStorage.setItem(GEMINI_API_KEY_STORAGE, "   ");
        expect(loadGeminiApiKey()).toBeNull();
    });
});

describe("Gemini model storage", () => {
    it("saves and reads (trimmed) the chosen model", () => {
        expect(loadGeminiModel()).toBeNull();
        saveGeminiModel("  gemini-2.5-pro  ");
        expect(localStorage.getItem(GEMINI_MODEL_STORAGE)).toBe("gemini-2.5-pro");
        expect(loadGeminiModel()).toBe("gemini-2.5-pro");
    });
});

describe("listGeminiModels", () => {
    function modelsPayload() {
        return {
            models: [
                { name: "models/gemini-2.5-pro", displayName: "Gemini 2.5 Pro", supportedGenerationMethods: ["generateContent"] },
                { name: "models/gemini-2.5-flash", displayName: "Gemini 2.5 Flash", supportedGenerationMethods: ["generateContent"] },
                { name: "models/embedding-001", displayName: "Embedding", supportedGenerationMethods: ["embedContent"] },
                { name: "models/gemini-1.0-vision", displayName: "Vision", supportedGenerationMethods: ["countTokens"] },
            ],
        };
    }

    it("keeps only generateContent-capable gemini models, strips the prefix, and sorts descending", async () => {
        vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve(modelsPayload()) })));
        const models = await listGeminiModels("key");
        expect(models.map(m => m.id)).toEqual(["gemini-2.5-pro", "gemini-2.5-flash"]);
        expect(models[0].displayName).toBe("Gemini 2.5 Pro");
    });

    it("filters out dirty model names like preview, banana, tts, and version suffixes", async () => {
        const payload = {
            models: [
                { name: "models/gemini-3.5-flash", displayName: "Gemini 3.5 Flash", supportedGenerationMethods: ["generateContent"] },
                { name: "models/gemini-2.0-flash-001", displayName: "Flash 001", supportedGenerationMethods: ["generateContent"] },
                { name: "models/nano-banana-pro-preview", displayName: "Banana", supportedGenerationMethods: ["generateContent"] },
                { name: "models/gemini-2.5-flash-image", displayName: "Flash Image", supportedGenerationMethods: ["generateContent"] },
                { name: "models/gemini-3.1-pro-preview", displayName: "Pro Preview", supportedGenerationMethods: ["generateContent"] },
                { name: "models/gemini-3.5-live-translate-preview", displayName: "Translate", supportedGenerationMethods: ["generateContent"] },
                { name: "models/gemini-flash-latest", displayName: "Latest", supportedGenerationMethods: ["generateContent"] },
            ],
        };
        vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve(payload) })));
        const models = await listGeminiModels("key");
        expect(models.map(m => m.id)).toEqual(["gemini-3.5-flash"]);
    });

    it("sorts models descending alphabetically by name", async () => {
        const payload = {
            models: [
                { name: "models/gemini-2.0-flash", displayName: "Flash 2.0", supportedGenerationMethods: ["generateContent"] },
                { name: "models/gemini-3.5-flash", displayName: "Flash 3.5", supportedGenerationMethods: ["generateContent"] },
                { name: "models/gemini-2.5-pro", displayName: "Pro 2.5", supportedGenerationMethods: ["generateContent"] },
                { name: "models/gemini-2.5-flash", displayName: "Flash 2.5", supportedGenerationMethods: ["generateContent"] },
                { name: "models/gemini-3.1-flash-lite", displayName: "Lite 3.1", supportedGenerationMethods: ["generateContent"] },
            ],
        };
        vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve(payload) })));
        const models = await listGeminiModels("key");
        expect(models.map(m => m.id)).toEqual([
            "gemini-3.5-flash",
            "gemini-3.1-flash-lite",
            "gemini-2.5-pro",
            "gemini-2.5-flash",
            "gemini-2.0-flash",
        ]);
    });

    it("follows nextPageToken until the list is exhausted", async () => {
        const fetchMock = vi.fn((url: string) => {
            if (!url.includes("pageToken")) {
                return Promise.resolve({
                    ok: true,
                    json: () =>
                        Promise.resolve({
                            models: [{ name: "models/gemini-2.5-flash", displayName: "Flash", supportedGenerationMethods: ["generateContent"] }],
                            nextPageToken: "next",
                        }),
                });
            }
            return Promise.resolve({
                ok: true,
                json: () =>
                    Promise.resolve({
                        models: [{ name: "models/gemini-2.5-pro", displayName: "Pro", supportedGenerationMethods: ["generateContent"] }],
                    }),
            });
        });
        vi.stubGlobal("fetch", fetchMock);
        const models = await listGeminiModels("key");
        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(models.map(m => m.id)).toEqual(["gemini-2.5-pro", "gemini-2.5-flash"]);
    });

    it("throws a key-related message on 403", async () => {
        vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({ ok: false, status: 403, json: () => Promise.resolve({}) })));
        await expect(listGeminiModels("bad")).rejects.toThrow("金鑰");
    });

    it("includes detailed API error message when available", async () => {
        const errorPayload = {
            error: {
                message: "gemini-3.5-flash is currently experiencing high demand",
                code: "api_error",
            },
        };
        vi.stubGlobal(
            "fetch",
            vi.fn(() =>
                Promise.resolve({
                    ok: false,
                    status: 503,
                    json: () => Promise.resolve(errorPayload),
                })
            ),
        );
        await expect(listGeminiModels("key")).rejects.toThrow("Gemini 服務發生錯誤（503），請稍後再試。\n詳細資訊：gemini-3.5-flash is currently experiencing high demand");
    });
});

describe("sendChatMessage", () => {
    function modelOutput(...texts: string[]) {
        return { steps: [{ type: "model_output", content: texts.map(t => ({ type: "text", text: t })) }] };
    }

    function functionCall(yaml: string, summary = "改好了") {
        return { steps: [{ type: "function_call", id: "c1", name: "update_itinerary", arguments: { yaml, summary } }] };
    }

    it("joins text from the model_output step on success", async () => {
        const fetchMock = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve(modelOutput("第二天", "去明洞。")) }));
        vi.stubGlobal("fetch", fetchMock);

        const turn = await sendChatMessage("key", "gemini-2.5-flash", [], "第二天去哪？", "trip: {}");
        expect(turn.text).toBe("第二天去明洞。");
        expect(turn.edit).toBeNull();
        expect(fetchMock).toHaveBeenCalledOnce();
    });

    it("returns a proposed edit when the model calls update_itinerary", async () => {
        vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve(functionCall("trip: {}", "加了咖啡廳")) })));
        const turn = await sendChatMessage("key", "gemini-2.5-flash", [], "加咖啡廳", buildContext());
        expect(turn.edit).toEqual({ yaml: "trip: {}", summary: "加了咖啡廳" });
        expect(turn.text).toBe("");
    });

    it("parses function_call arguments given as a JSON string", async () => {
        const payload = { steps: [{ type: "function_call", name: "update_itinerary", arguments: JSON.stringify({ yaml: "trip: {}", summary: "x" }) }] };
        vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve(payload) })));
        const turn = await sendChatMessage("key", "gemini-2.5-flash", [], "hi", buildContext());
        expect(turn.edit?.yaml).toBe("trip: {}");
    });

    it("posts to the Interactions endpoint with the model, key header, and edit tool, statelessly", async () => {
        let capturedUrl = "";
        let capturedInit: { headers: Record<string, string>; body: string; } | undefined;
        const fetchMock = vi.fn((url: string, init: { headers: Record<string, string>; body: string; }) => {
            capturedUrl = url;
            capturedInit = init;
            return Promise.resolve({ ok: true, json: () => Promise.resolve(modelOutput("好")) });
        });
        vi.stubGlobal("fetch", fetchMock);

        await sendChatMessage("my-key", "gemini-2.5-pro", [], "hi", buildContext());
        expect(capturedUrl).toContain("/interactions");
        expect(capturedInit?.headers["x-goog-api-key"]).toBe("my-key");
        const body = JSON.parse(capturedInit!.body) as {
            model: string;
            store: boolean;
            tools: { type: string; name: string; parameters: { required: string[]; }; }[];
        };
        expect(body.model).toBe("gemini-2.5-pro");
        expect(body.store).toBe(false);
        expect(body.tools[0].name).toBe("update_itinerary");
        expect(body.tools[0].parameters.required).toContain("yaml");
    });

    it("replays prior history as input steps and appends the new user turn", async () => {
        let captured: unknown;
        const fetchMock = vi.fn((_url: string, init: { body: string; }) => {
            captured = JSON.parse(init.body);
            return Promise.resolve({ ok: true, json: () => Promise.resolve(modelOutput("好")) });
        });
        vi.stubGlobal("fetch", fetchMock);

        await sendChatMessage("key", "gemini-2.5-flash", [{ role: "user", content: "嗨" }, { role: "model", content: "你好" }], "再問", "trip: {}");

        const body = captured as { input: { type: string; content: { text: string; }[]; }[]; };
        expect(body.input.map(s => s.type)).toEqual(["user_input", "model_output", "user_input"]);
        expect(body.input.at(-1)?.content[0]?.text).toBe("再問");
    });

    it("throws a key-related message on 403", async () => {
        vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({ ok: false, status: 403, json: () => Promise.resolve({}) })));
        await expect(sendChatMessage("bad", "gemini-2.5-flash", [], "hi", buildContext())).rejects.toThrow("金鑰");
    });

    it("throws when the response has no model_output step", async () => {
        vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ steps: [] }) })));
        await expect(sendChatMessage("key", "gemini-2.5-flash", [], "hi", buildContext())).rejects.toThrow("沒有回覆");
    });

    it("throws a network message when fetch rejects", async () => {
        vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("offline"))));
        await expect(sendChatMessage("key", "gemini-2.5-flash", [], "hi", buildContext())).rejects.toThrow("無法連線");
    });
});

function buildContext(): string {
    return JSON.stringify(tripData);
}
