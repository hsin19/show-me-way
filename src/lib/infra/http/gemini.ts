import {
    serializeToYaml,
    type TripData,
} from "$lib/domain/trip";
import {
    splitDayDate,
    toLocalIsoDate,
} from "$lib/domain/utils";

export const GEMINI_API_KEY_STORAGE = "showmeway_gemini_api_key";
export const GEMINI_MODEL_STORAGE = "showmeway_gemini_model";

const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta";

// The header form, not `?key=`: the Interactions API does not accept the query form.
function authHeaders(apiKey: string): Record<string, string> {
    return { "x-goog-api-key": apiKey };
}

/** Gemini's own roles, so the chat history needs no translation layer. */
export interface ChatMessage {
    role: "user" | "model";
    content: string;
}

// One session-scoped slot, keyed by API key. Never persisted: a stale model
// list would outlive a revoked key.
let cachedModelsKey: string | null = null;
let cachedModelsPromise: Promise<GeminiModel[]> | null = null;

export function clearGeminiModelsMemory(): void {
    cachedModelsKey = null;
    cachedModelsPromise = null;
}

// Every accessor below swallows storage failures (quota, private mode, blocked
// storage) rather than throwing into the UI — same policy as weather.ts.
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
        clearGeminiModelsMemory();
    } catch (e) {
        console.warn("Failed to save Gemini API key", e);
    }
}

export function clearGeminiApiKey(): void {
    try {
        localStorage.removeItem(GEMINI_API_KEY_STORAGE);
        clearGeminiModelsMemory();
    } catch (e) {
        console.warn("Failed to clear Gemini API key", e);
    }
}

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

/** The grounding context for a chat turn: exactly the YAML the user could export. */
export function buildItineraryContext(tripData: TripData): string {
    return serializeToYaml(tripData);
}

function buildSystemInstruction(itineraryYaml: string, currentDateTime: string): string {
    return [
        "你是「ShowMeWay」旅遊行程 App 的 AI 助手。請依據以下使用者的行程資料（YAML 格式）協助查詢與編輯行程。",
        `現在時間：${currentDateTime}`,
        "【回答規則】",
        "1. 以使用者提問所用的語言回答；無法判斷時使用繁體中文（台灣用語）。",
        "2. 查詢類問題只根據行程資料作答；若資料中沒有相關內容，請如實說明找不到，不要編造。",
        "3. 回答簡潔、口語、重點明確，適合在手機上閱讀。",
        "4. 提到日期或時間時，沿用行程資料中的格式。",
        "【編輯規則】",
        "5. 當使用者要求新增、修改或刪除行程內容（例如加景點、改時間、換飯店、加待辦或打包項目）時，呼叫 update_itinerary 工具。",
        "6. 呼叫時 yaml 參數要傳入「完整」的更新後行程（沿用原本所有欄位與結構，只改動需要變動的部分，其餘原封不動保留，不可省略）；summary 參數用與回答相同的語言一兩句話說明這次的變更。",
        "7. 僅在確實要修改行程時才呼叫 update_itinerary；單純回答問題時不要呼叫，直接用文字回覆即可。",
        // Without rule 8 the model writes bare URLs, which markdown.ts renders as
        // literal text rather than links.
        "8. desc、bullets、alternatives 的 note、todo 與 packing 的 text 支援行內 Markdown：連結一律寫成 [說明文字](https://…)，不要放裸網址；可用 **粗體**、*斜體*、`等寬`。其餘欄位（title、pace、confirmation 的 note 等）不支援，請寫純文字。",
        // Rule 9: `56*36*23` parses as emphasis, here and in CommonMark alike, so
        // a size written that way loses its asterisks and italicizes the middle.
        "9. 在支援 Markdown 的欄位裡，尺寸與乘號請用 × 或反斜線跳脫（56×36×23 或 56\\*36\\*23），不要寫成 56*36*23，否則會被讀成斜體。",
        // Without rule 10 the model emits `desc: [官網](https://…)`, which js-yaml
        // reads as a flow sequence, or `desc: **提早**到`, which it reads as an
        // alias — either way the whole edit fails validateYaml.
        "10. 值的開頭若是 [ 或 *，整個值一定要用單引號包起來（例如 desc: '**提早兩小時**到機場'、text: '[申請入口](https://…) 記得先辦'），否則 YAML 會解析失敗、整次修改都套用不了。",
        // Appended rather than filed with the edit rules above so rules 8-10, which the
        // docs and comments refer to by number, keep their numbers. applyAiEdit restores
        // trip.id regardless — this only saves the model from inventing one.
        "11. trip.id 是 App 自動產生的行程識別碼，請原封不動照抄，不要修改、刪除或自行產生。",
        "",
        "=== 行程資料 (YAML) ===",
        itineraryYaml,
        "=== 行程資料結束 ===",
    ].join("\n");
}

// A tool call rather than a YAML block in prose, so nothing has to be scraped out
// of the reply. Every call is intercepted client-side, validated and confirmed —
// see ChatPanel — so the model never edits the trip on its own.
const UPDATE_ITINERARY_TOOL_NAME = "update_itinerary";

const UPDATE_ITINERARY_TOOL = {
    type: "function",
    name: UPDATE_ITINERARY_TOOL_NAME,
    description: "當使用者要求新增、修改或刪除行程內容（景點、時間、飯店、待辦、打包等）時呼叫，傳入更新後的完整行程 YAML。單純回答問題時不要呼叫。",
    parameters: {
        type: "object",
        properties: {
            yaml: {
                type: "string",
                description: "完整的更新後行程 YAML，沿用原本所有欄位與結構，只改動需要變動的部分，其餘原封不動保留。",
            },
            summary: {
                type: "string",
                description: "用繁體中文一兩句話說明這次做了哪些變更。",
            },
        },
        required: ["yaml", "summary"],
    },
} as const;

interface ProposedEdit {
    /** The complete updated itinerary, NOT yet validated — that is the caller's job. */
    yaml: string;
    /** zh-TW one-liner describing the change, for the chat bubble. */
    summary: string;
}

export interface ChatTurn {
    /** Empty when the model only called the edit tool. */
    text: string;
    edit: ProposedEdit | null;
}

interface InteractionStep {
    type?: string;
    name?: string;
    arguments?: unknown;
    content?: { type?: string; text?: string; }[];
}

// An Interactions response is a list of execution steps — thoughts, tool calls,
// model output — of which only the last two kinds interest us.
function extractTurn(payload: unknown): ChatTurn {
    const empty: ChatTurn = { text: "", edit: null };
    if (typeof payload !== "object" || payload === null) return empty;
    const steps = (payload as { steps?: unknown; }).steps;
    if (!Array.isArray(steps)) return empty;
    const typed = steps.map(s => s as InteractionStep);
    const text = typed
        .filter(s => s.type === "model_output" && Array.isArray(s.content))
        .flatMap(s => s.content!)
        .map(c => (c.type === "text" && typeof c.text === "string" ? c.text : ""))
        .join("")
        .trim();
    const call = typed.find(s => s.type === "function_call" && s.name === UPDATE_ITINERARY_TOOL_NAME);
    return { text, edit: call ? parseEditArgs(call.arguments) : null };
}

// Arguments normally arrive as an object; the JSON-string form is tolerated
// because the API has been seen to send both.
function parseEditArgs(args: unknown): ProposedEdit | null {
    let obj: unknown = args;
    if (typeof obj === "string") {
        try {
            obj = JSON.parse(obj);
        } catch {
            return null;
        }
    }
    if (typeof obj !== "object" || obj === null) return null;
    const yaml = (obj as { yaml?: unknown; }).yaml;
    const summary = (obj as { summary?: unknown; }).summary;
    if (typeof yaml !== "string" || !yaml.trim()) return null;
    return { yaml, summary: typeof summary === "string" ? summary : "" };
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

// Hidden from the picker: experimental and non-text variants, leaving the clean
// Gemini and Gemma release names. The snapshot rule is anchored because a
// pinned build is always a trailing `-001`, while an unanchored `-\d{3}` would
// also swallow parameter counts like `gemma-3-270m-it`.
const UNWANTED_MODEL_REGEX = /(?:preview|latest|exp|tts|image|banana|computer-use|lyria|robotics|-\d{3}$)/i;

function parseModels(payload: unknown): GeminiModel[] {
    if (typeof payload !== "object" || payload === null) return [];
    const models = (payload as { models?: unknown; }).models;
    if (!Array.isArray(models)) return [];
    return models
        .map(m => m as RawModel)
        .filter(m => {
            if (typeof m.name !== "string") return false;
            if (!Array.isArray(m.supportedGenerationMethods) || !m.supportedGenerationMethods.includes("generateContent")) {
                return false;
            }
            return !UNWANTED_MODEL_REGEX.test(m.name);
        })
        .map(m => ({
            id: m.name!.replace(/^models\//, ""),
            displayName: m.displayName?.trim() || m.name!.replace(/^models\//, ""),
        }));
}

/**
 * The chat-capable models this key can use. Doubles as key validation — the API
 * has no verify endpoint — so it rejects rather than degrading, and the UI is
 * expected to render the reason. Repeat calls with the same key share one
 * in-flight/settled promise for the session.
 */
export function listGeminiModels(apiKey: string): Promise<GeminiModel[]> {
    if (cachedModelsKey === apiKey && cachedModelsPromise) {
        return cachedModelsPromise;
    }

    cachedModelsKey = apiKey;
    cachedModelsPromise = (async () => {
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
    })().catch(err => {
        // Drop the memo on failure, or the picker's 重試 button would keep handing
        // back the same rejection.
        if (cachedModelsKey === apiKey) {
            clearGeminiModelsMemory();
        }
        throw err;
    });

    return cachedModelsPromise;
}

/**
 * The model to auto-select for a user with no stored preference. Not `list[0]`:
 * the descending id sort puts every `gemma-*` ahead of every `gemini-*` and
 * compares size suffixes as strings (`-9b` beats `-31b`), so the head of the list
 * is an arbitrary pick.
 */
export function pickDefaultModel(models: GeminiModel[]): string | null {
    return (models.find(m => m.id.startsWith("gemini-")) ?? models[0])?.id ?? null;
}

function toInputSteps(history: ChatMessage[], userText: string) {
    const steps = history.map(m => ({
        type: m.role === "user" ? "user_input" : "model_output",
        content: [{ type: "text", text: m.content }],
    }));
    steps.push({ type: "user_input", content: [{ type: "text", text: userText }] });
    return steps;
}

/**
 * One chat turn: the reply text plus any itinerary edit the model proposed. The
 * caller owns the conversation — nothing is retained here or at Google
 * (`store: false`) — and owns the failure too, since this rejects rather than
 * degrading like the caches do.
 */
export async function sendChatMessage(
    apiKey: string,
    model: string,
    history: ChatMessage[],
    userText: string,
    itineraryYaml: string,
): Promise<ChatTurn> {
    const now = new Date();
    const nowIso = toLocalIsoDate(now);
    const { weekday } = splitDayDate(nowIso);
    const hours = String(now.getHours()).padStart(2, "0");
    const minutes = String(now.getMinutes()).padStart(2, "0");
    const nowStr = `${nowIso} (星期${weekday}) ${hours}:${minutes}`;

    let res: Response;
    try {
        res = await fetch(`${GEMINI_API_BASE}/interactions`, {
            method: "POST",
            headers: { ...authHeaders(apiKey), "Content-Type": "application/json" },
            body: JSON.stringify({
                model,
                store: false,
                // Re-sent every turn, so the model always edits the current trip
                // and the replayed history can stay prose-only.
                system_instruction: buildSystemInstruction(itineraryYaml, nowStr),
                input: toInputSteps(history, userText),
                tools: [UPDATE_ITINERARY_TOOL],
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
    const turn = extractTurn(payload);
    if (!turn.text && !turn.edit) {
        throw new Error("Gemini 沒有回覆內容，請換個方式再問一次。");
    }
    return turn;
}
