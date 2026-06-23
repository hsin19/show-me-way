import {
    serializeToYaml,
    type TripData,
} from "./api";

export const GEMINI_API_KEY_STORAGE = "showmeway_gemini_api_key";
export const GEMINI_MODEL_STORAGE = "showmeway_gemini_model";

const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta";

// AI Studio keys authenticate via this header for every endpoint (chat uses
// the newer Interactions API, which doesn't accept the `?key=` query form).
function authHeaders(apiKey: string): Record<string, string> {
    return { "x-goog-api-key": apiKey };
}

// Gemini's content roles. The app's chat history maps onto these directly
// (assistant turns are "model"), so no translation layer is needed.
export interface ChatMessage {
    role: "user" | "model";
    content: string;
}

// Key access mirrors exchange.ts: any storage failure (quota, private mode,
// blocked storage) degrades to "no key" rather than throwing into the UI.
export function loadGeminiApiKey(): string | null {
    try {
        const key = localStorage.getItem(GEMINI_API_KEY_STORAGE);
        return key && key.trim() ? key.trim() : null;
    } catch (e) {
        console.warn("Failed to read Gemini API key", e);
        return null;
    }
}

export function saveGeminiApiKey(key: string): void {
    try {
        localStorage.setItem(GEMINI_API_KEY_STORAGE, key.trim());
    } catch (e) {
        console.warn("Failed to save Gemini API key", e);
    }
}

export function clearGeminiApiKey(): void {
    try {
        localStorage.removeItem(GEMINI_API_KEY_STORAGE);
    } catch (e) {
        console.warn("Failed to clear Gemini API key", e);
    }
}

// The chosen model is just a string preference; same silent-fail policy.
export function loadGeminiModel(): string | null {
    try {
        const model = localStorage.getItem(GEMINI_MODEL_STORAGE);
        return model && model.trim() ? model.trim() : null;
    } catch (e) {
        console.warn("Failed to read Gemini model", e);
        return null;
    }
}

export function saveGeminiModel(model: string): void {
    try {
        localStorage.setItem(GEMINI_MODEL_STORAGE, model.trim());
    } catch (e) {
        console.warn("Failed to save Gemini model", e);
    }
}

// The trip YAML is embedded verbatim as grounding context. Reusing
// serializeToYaml keeps a single source of truth for the itinerary shape and
// means the model sees exactly what the user could export.
export function buildItineraryContext(tripData: TripData): string {
    return serializeToYaml(tripData);
}

export function buildSystemInstruction(itineraryYaml: string, currentDateTime: string): string {
    return [
        "你是「ShowMeWay」旅遊行程 App 的 AI 助手。請依據以下使用者的行程資料（YAML 格式）回答問題。",
        `現在時間：${currentDateTime}`,
        "規則：",
        "1. 一律使用繁體中文（台灣用語）回答。",
        "2. 只根據行程資料作答；若資料中沒有相關內容，請如實說明找不到，不要編造。",
        "3. 回答簡潔、口語、重點明確，適合在手機上閱讀。",
        "4. 提到日期或時間時，沿用行程資料中的格式。",
        "",
        "=== 行程資料 (YAML) ===",
        itineraryYaml,
        "=== 行程資料結束 ===",
    ].join("\n");
}

interface InteractionStep {
    type?: string;
    content?: { type?: string; text?: string; }[];
}

// An Interactions response is a list of execution steps (thoughts, tool calls,
// model output). Pull text from every `model_output` step, ignoring the rest.
function extractText(payload: unknown): string | null {
    if (typeof payload !== "object" || payload === null) return null;
    const steps = (payload as { steps?: unknown; }).steps;
    if (!Array.isArray(steps)) return null;
    const text = steps
        .map(s => s as InteractionStep)
        .filter(s => s.type === "model_output" && Array.isArray(s.content))
        .flatMap(s => s.content!)
        .map(c => (c.type === "text" && typeof c.text === "string" ? c.text : ""))
        .join("")
        .trim();
    return text || null;
}

async function handleErrorResponse(res: Response): Promise<never> {
    const status = res.status;
    let detailMsg = "";
    try {
        const body: unknown = await res.json();
        if (body && typeof body === "object" && "error" in body) {
            const err = (body as { error?: unknown; }).error;
            if (err && typeof err === "object" && "message" in err && typeof err.message === "string") {
                detailMsg = err.message.trim();
            }
        }
    } catch {
        // Ignored
    }

    const userMsg = (status === 400 || status === 401 || status === 403)
        ? "API 金鑰無效或權限不足，請確認金鑰是否正確。"
        : (status === 429)
        ? "已達 Gemini 使用上限，請稍後再試。"
        : `Gemini 服務發生錯誤（${status}），請稍後再試。`;

    const combined = detailMsg ? `${userMsg}\n詳細資訊：${detailMsg}` : userMsg;
    throw new Error(combined);
}

export interface GeminiModel {
    /** Bare id without the `models/` prefix, e.g. `gemini-2.5-flash`. */
    id: string;
    displayName: string;
}

interface RawModel {
    name?: string;
    displayName?: string;
    supportedGenerationMethods?: string[];
}

// Match clean versioned names: models/gemini-1.5-flash, models/gemini-3.5-pro, models/gemini-2.0-flash-lite etc.
// Excludes banana, tts, image, computer-use, preview, exp, latest, and specific snapshot numbers like -001.
const CLEAN_MODEL_REGEX = /^models\/gemini-\d+(?:\.\d+)?-[a-z]+(?:-lite)?$/;

function parseModels(payload: unknown): GeminiModel[] {
    if (typeof payload !== "object" || payload === null) return [];
    const models = (payload as { models?: unknown; }).models;
    if (!Array.isArray(models)) return [];
    return models
        .map(m => m as RawModel)
        .filter(m =>
            typeof m.name === "string"
            && CLEAN_MODEL_REGEX.test(m.name)
            && Array.isArray(m.supportedGenerationMethods)
            && m.supportedGenerationMethods.includes("generateContent")
        )
        .map(m => ({
            id: m.name!.replace(/^models\//, ""),
            displayName: m.displayName?.trim() || m.name!.replace(/^models\//, ""),
        }));
}

/**
 * List the chat-capable models available to this key. Doubles as key
 * validation — a bad key fails here before the user ever sends a message.
 * Rejects on failure (like sendChatMessage) so the UI can fall back to the
 * default model and report the cause.
 */
export async function listGeminiModels(apiKey: string): Promise<GeminiModel[]> {
    const collected: GeminiModel[] = [];
    let pageToken: string | undefined;

    do {
        const url = new URL(`${GEMINI_API_BASE}/models`);
        url.searchParams.set("pageSize", "200");
        if (pageToken) url.searchParams.set("pageToken", pageToken);

        let res: Response;
        try {
            res = await fetch(url.toString(), { headers: authHeaders(apiKey) });
        } catch (e) {
            console.error("Gemini model list request failed", e);
            throw new Error("無法連線到 Gemini，請檢查網路連線。", { cause: e });
        }
        if (!res.ok) {
            await handleErrorResponse(res);
        }
        const payload: unknown = await res.json();
        collected.push(...parseModels(payload));
        pageToken = (payload as { nextPageToken?: string; }).nextPageToken;
    } while (pageToken);

    return [...collected].sort((a, b) => b.id.localeCompare(a.id));
}

// Map our in-memory history to Interactions input steps. Stateless replay:
// each prior turn is echoed back in its documented step shape, then the new
// question is appended as a `user_input` step.
function toInputSteps(history: ChatMessage[], userText: string) {
    const steps = history.map(m => ({
        type: m.role === "user" ? "user_input" : "model_output",
        content: [{ type: "text", text: m.content }],
    }));
    steps.push({ type: "user_input", content: [{ type: "text", text: userText }] });
    return steps;
}

/**
 * Send one chat turn to Gemini (Interactions API) and return the reply text.
 *
 * `store: false` keeps it stateless — Google retains nothing and we replay the
 * in-memory history each call, matching the chat's "memory only" design. Unlike
 * the fail-silent caches in exchange.ts / weather.ts, this rejects on failure so
 * the calling component can surface the cause inline / via toast.
 */
export async function sendChatMessage(
    apiKey: string,
    model: string,
    history: ChatMessage[],
    userText: string,
    itineraryYaml: string,
): Promise<string> {
    const daysOfWeek = ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"];
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const date = String(now.getDate()).padStart(2, "0");
    const hours = String(now.getHours()).padStart(2, "0");
    const minutes = String(now.getMinutes()).padStart(2, "0");
    const dayName = daysOfWeek[now.getDay()];
    const nowStr = `${year}-${month}-${date} (${dayName}) ${hours}:${minutes}`;

    let res: Response;
    try {
        res = await fetch(`${GEMINI_API_BASE}/interactions`, {
            method: "POST",
            headers: { ...authHeaders(apiKey), "Content-Type": "application/json" },
            body: JSON.stringify({
                model,
                store: false,
                system_instruction: buildSystemInstruction(itineraryYaml, nowStr),
                input: toInputSteps(history, userText),
            }),
        });
    } catch (e) {
        console.error("Gemini request failed", e);
        throw new Error("無法連線到 Gemini，請檢查網路連線。", { cause: e });
    }

    if (!res.ok) {
        await handleErrorResponse(res);
    }

    const payload: unknown = await res.json();
    const text = extractText(payload);
    if (!text) {
        throw new Error("Gemini 沒有回覆內容，請換個方式再問一次。");
    }
    return text;
}
