import {
    EDIT_OPS,
    type ItineraryEdit,
} from "$lib/domain/itinerary-edits";
import {
    serializeToYaml,
    type TripData,
} from "$lib/domain/trip";
import {
    DAY_ROLLOVER_HOUR,
    splitDayDate,
    toLocalIsoDate,
    tripDayOf,
} from "$lib/domain/utils";
import { appStorage } from "$lib/infra/storage/app-storage";

export const GEMINI_API_KEY_STORAGE = "gemini_api_key";
export const GEMINI_MODEL_STORAGE = "gemini_model";

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
        const key = appStorage.get(GEMINI_API_KEY_STORAGE);
        return key && key.trim() ? key.trim() : null;
    } catch (e) {
        console.warn("Failed to read Gemini API key", e);
        return null;
    }
}

export function saveGeminiApiKey(key: string): void {
    try {
        appStorage.set(GEMINI_API_KEY_STORAGE, key.trim());
        clearGeminiModelsMemory();
    } catch (e) {
        console.warn("Failed to save Gemini API key", e);
    }
}

export function clearGeminiApiKey(): void {
    try {
        appStorage.remove(GEMINI_API_KEY_STORAGE);
        clearGeminiModelsMemory();
    } catch (e) {
        console.warn("Failed to clear Gemini API key", e);
    }
}

export function loadGeminiModel(): string | null {
    try {
        const model = appStorage.get(GEMINI_MODEL_STORAGE);
        return model && model.trim() ? model.trim() : null;
    } catch (e) {
        console.warn("Failed to read Gemini model", e);
        return null;
    }
}

export function saveGeminiModel(model: string): void {
    try {
        appStorage.set(GEMINI_MODEL_STORAGE, model.trim());
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
        "【回答規則】",
        "1. 以使用者提問所用的語言回答；無法判斷時使用繁體中文（台灣用語）。",
        "2. 查詢類問題只根據行程資料作答；若資料中沒有相關內容，請如實說明找不到，不要編造。",
        "3. 回答簡潔、口語、重點明確，適合在手機上閱讀；可以用條列、粗體和小標題，不要用表格（手機畫面放不下）。",
        "4. 提到日期或時間時，沿用行程資料中的格式。",
        "【編輯規則】",
        "5. 當使用者要求新增、修改、刪除或搬移行程內容（例如加景點、改時間、換飯店、加待辦或打包項目）時，呼叫 edit_itinerary 工具：edits 依序列出每一項修改，只描述要改的地方，不要重寫整份行程；一次需求要改好幾處，就放在同一次呼叫裡。呼叫的同時用一兩句話說明這次的變更。",
        "6. 指定要改的對象：事件用 date（它目前所在那天的日期）加 title（目前的標題）；當天資訊用 date；住宿用 title（同名時再加 date＝入住日）；待辦或打包項目用 list（todo 或 packing）加 text（目前的文字）。title 與 text 照抄原文，太長時只寫開頭一段、足以分辨是哪一個即可。新增或搬移事件可用 after 指定排在哪個事件之後，不給就依時間排。",
        "7. 僅在確實要修改行程時才呼叫 edit_itinerary；單純回答問題時不要呼叫，直接用文字回覆即可。",
        // Without rule 8 the model writes bare URLs, which markdown.ts renders as
        // literal text rather than links. The field list is hand-kept: it must name
        // exactly the fields RichText renders, and nothing checks that it does.
        "8. 事件與住宿的 desc、bullets，alternatives 的 note，todo 與 packing 的 text 支援 Markdown：連結一律寫成 [說明文字](https://…)，不要放裸網址；可用 **粗體**、*斜體*、`等寬`，寫成多行時也可以用條列（- 或 1.）。其餘欄位（title、pace、address 等）不支援，請寫純文字。",
        // Rule 9: `56*36*23` parses as emphasis, here and in CommonMark alike, so
        // a size written that way loses its asterisks and italicizes the middle.
        "9. 在支援 Markdown 的欄位裡，尺寸與乘號請用 × 或反斜線跳脫（56×36×23 或 56\\*36\\*23），不要寫成 56*36*23，否則會被讀成斜體。",
        // Without rule 10 the model emits `desc: [官網](https://…)`, which js-yaml
        // reads as a flow sequence, `desc: **提早**到`, which it reads as an alias,
        // or `desc: - 先…`, which does not parse at all — and a value led by `#` is a
        // comment, so the field silently comes out empty.
        "10. yaml 參數裡，值的開頭若是 [、*、# 或「- 」，整個值一定要用單引號包起來（例如 desc: '**提早兩小時**到機場'、text: '[申請入口](https://…) 記得先辦'），否則 YAML 會解析失敗、整次修改都套用不了。要寫成多行（條列、分段）時改用 | 開頭的多行寫法。",
        // After the Markdown rules rather than filed with the edit rules, so rules 8-10,
        // which the docs and comments refer to by number, keep their numbers.
        "11. yaml 參數的寫法：update_ 開頭的修改只寫要改的欄位，值設為 null 代表刪除該欄位，bullets、links、stops 這類清單欄位要給完整的新清單；add_ 開頭的修改寫出完整的新項目。",
        // A fileId names a file already in the owner's Drive; one the model invents is a dead chip.
        "12. attachments 的 fileId 指向雲端上已存在的檔案，不可自行產生；事件要換到別天請用 move_event，附件會跟著走。",
        // The two check-in fields are written only once set — an unchecked item has no
        // `checked` at all — so without this the model cannot see that they exist.
        "13. 勾選待辦或打包項目：update_item，yaml 寫 checked: true（取消勾選寫 checked: false）。事件打卡：update_event，yaml 寫 status: done（已完成）或 status: skipped（略過），取消寫 status: null。yaml 裡只能用行程資料裡出現的欄位名稱，不要自創欄位。",
        // Asked to fit a museum in before shopping, gemini-3.6-flash renamed the shopping event
        // into the museum and re-created the shopping: whatever the old event carried — an
        // e-ticket, a check-in, its links — would then sit on the wrong one.
        "14. 新的行程用 add_event 新增，不要把既有事件改成另一個地點或活動：它身上的附件、打卡與連結都會跟著，改造後就掛在錯的事件上。既有事件只改需要變動的欄位，例如把時間往後挪。",
        // Without it the model leaves localName out, and the card has no map or enlarge button.
        "15. 新增地點（事件、stops、alternatives）時填 localName：當地語言的正式名稱，App 用它產生地圖按鈕與放大給當地人看的卡片。",
        // The notes ChatPanel's history carries on its own turns (see `replayed`); without
        // this the model reads them as the user's words, or starts writing its own.
        "16. 對話紀錄裡的「（App 紀錄：…）」是 App 附上的修改狀態，不是使用者說的話：用它判斷先前的修改有沒有套用，失敗的就照錯誤原因修正；回答時不要寫出這種格式。",
        "",
        "=== 行程資料 (YAML) ===",
        itineraryYaml,
        "=== 行程資料結束 ===",
        // Last, because it changes every minute: Gemini's implicit cache only matches an
        // identical prefix, and anything above this line — the rules and the whole trip —
        // stays one from turn to turn.
        `現在時間：${currentDateTime}`,
    ].join("\n");
}

// A tool call rather than a YAML block in prose, so nothing has to be scraped out of the
// reply, and targeted edits rather than the whole document, so the reply stays short —
// see `itinerary-edits.ts`. Every call is intercepted client-side, applied, validated
// and confirmed — see ChatPanel — so the model never edits the trip on its own.
const EDIT_ITINERARY_TOOL_NAME = "edit_itinerary";

const EDIT_ITINERARY_TOOL = {
    type: "function",
    name: EDIT_ITINERARY_TOOL_NAME,
    description: "當使用者要求新增、修改、刪除或搬移行程內容（景點、時間、飯店、待辦、打包等）時呼叫，edits 依序列出要做的修改，App 會依序套用並請使用者確認。單純回答問題時不要呼叫。",
    parameters: {
        type: "object",
        properties: {
            edits: {
                type: "array",
                items: {
                    type: "object",
                    properties: {
                        op: {
                            type: "string",
                            enum: EDIT_OPS,
                            description: "update_event / add_event / remove_event / move_event：事件；update_day / add_day / remove_day：一整天；update_hotel / add_hotel / remove_hotel：住宿；update_trip：行程名稱、城市等；add_item / update_item / remove_item：待辦或打包清單。",
                        },
                        date: { type: "string", description: "事件目前所在那天、或要改的那天的日期（YYYY-MM-DD）；住宿同名時填入住日。" },
                        title: { type: "string", description: "事件或住宿目前的完整標題，一字不差。" },
                        list: { type: "string", enum: ["todo", "packing"], description: "清單項目所在的清單。" },
                        text: { type: "string", description: "清單項目目前的完整文字，一字不差。" },
                        to_date: { type: "string", description: "move_event：要搬到哪天（YYYY-MM-DD）。" },
                        after: { type: "string", description: "add_event / move_event：排在哪個事件之後（它目前的完整標題）；不給就依時間排。" },
                        yaml: { type: "string", description: "YAML 格式：add_ 開頭的修改寫完整的新項目；update_ 開頭的修改只寫要改的欄位（null 代表刪除）。" },
                    },
                    required: ["op"],
                },
            },
        },
        required: ["edits"],
    },
} as const;

export interface ChatTurn {
    /** Empty when the model only called the edit tool. */
    text: string;
    /** The edits the model proposed, NOT yet applied or validated — that is the caller's job. Null when it proposed none. */
    edits: ItineraryEdit[] | null;
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
    const empty: ChatTurn = { text: "", edits: null };
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
    // A model may split one request over several calls; they apply in the order sent.
    const edits = typed
        .filter(s => s.type === "function_call" && s.name === EDIT_ITINERARY_TOOL_NAME)
        .flatMap(s => parseEditArgs(s.arguments));
    return { text, edits: edits.length > 0 ? edits : null };
}

function optionalString(value: unknown): string | undefined {
    return typeof value === "string" ? value : undefined;
}

// Arguments normally arrive as an object; the JSON-string form is tolerated
// because the API has been seen to send both.
function parseEditArgs(args: unknown): ItineraryEdit[] {
    let obj: unknown = args;
    if (typeof obj === "string") {
        try {
            obj = JSON.parse(obj);
        } catch {
            return [];
        }
    }
    const edits = (obj as { edits?: unknown; } | null)?.edits;
    if (!Array.isArray(edits)) return [];
    return edits
        .filter((edit): edit is Record<string, unknown> => !!edit && typeof edit === "object" && typeof (edit as { op?: unknown; }).op === "string")
        .map(edit => ({
            op: edit.op as string,
            date: optionalString(edit.date),
            title: optionalString(edit.title),
            list: optionalString(edit.list),
            text: optionalString(edit.text),
            toDate: optionalString(edit.to_date),
            after: optionalString(edit.after),
            yaml: edit.yaml,
        }));
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
        : (status === 503)
        ? "這個模型現在太忙（Google 那邊暫時滿載，跟你的額度無關），請稍後再試，或換一個模型。"
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
const UNWANTED_MODEL_REGEX = /(?:preview|latest|exp|tts|image|banana|computer-use|lyria|robotics|transcribe|-\d{3}$)/i;

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

const DEFAULT_MODEL_PREFERENCE = [/^gemini-.+-flash$/, /^gemini-.+-flash/, /^gemini-/];

/**
 * The model to auto-select for a user with no stored preference. Not `list[0]`:
 * the descending id sort puts every `gemma-*` ahead of every `gemini-*` and
 * compares size suffixes as strings (`-9b` beats `-31b`), so the head of the list
 * is an arbitrary pick.
 *
 * The newest plain Flash first: the same sort puts `-pro` ahead of `-flash` and a
 * newer generation's flagship (`gemini-4-argon`) ahead of both, which made a new key
 * default to the dearest model when Flash already handles this app's chat and edits.
 * Anchored at the end so `-flash-lite` does not win by sorting ahead of `-flash`, yet
 * still ahead of Pro when it is the only Flash there is.
 */
export function pickDefaultModel(models: GeminiModel[]): string | null {
    for (const pattern of DEFAULT_MODEL_PREFERENCE) {
        const found = models.find(m => pattern.test(m.id));
        if (found) return found.id;
    }
    return models[0]?.id ?? null;
}

// Google sheds load on a busy model with a 503 that usually clears within seconds. Waited
// out here so the user does not have to tap 重試 for what a moment's pause fixes; nothing
// is lost by sending again, since an edit only ever lands on the user's own tap.
const BUSY_RETRY_DELAYS_MS = [2000, 5000];

function wait(ms: number, signal: AbortSignal | undefined): Promise<void> {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, ms);
        signal?.addEventListener("abort", () => {
            clearTimeout(timer);
            reject(signal.reason as Error);
        }, { once: true });
    });
}

function isBusy(status: number): boolean {
    return status === 500 || status === 502 || status === 503 || status === 504;
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
    options: {
        /** Aborting rejects with the signal's reason, through a retry's wait as well. */
        signal?: AbortSignal;
        /** Called before each wait out of a busy model, so the UI can say what it is doing. */
        onBusyRetry?: (attempt: number, of: number) => void;
    } = {},
): Promise<ChatTurn> {
    const { signal, onBusyRetry } = options;
    const now = new Date();
    const nowIso = toLocalIsoDate(now);
    const { weekday } = splitDayDate(nowIso);
    const hours = String(now.getHours()).padStart(2, "0");
    const minutes = String(now.getMinutes()).padStart(2, "0");
    // The real clock, plus which day "today" means in the small hours, when the trip still
    // counts the night as the day before and the user does too.
    const tripDay = tripDayOf(now);
    const dayNote = tripDay === nowIso ? "" : `（凌晨 ${DAY_ROLLOVER_HOUR} 點前還算前一天：使用者說的「今天」是 ${tripDay} 的行程）`;
    const nowStr = `${nowIso} (星期${weekday}) ${hours}:${minutes}${dayNote}`;

    const body = JSON.stringify({
        model,
        store: false,
        // Re-sent every turn, so the model always edits the current trip
        // and the replayed history can stay prose-only.
        system_instruction: buildSystemInstruction(itineraryYaml, nowStr),
        input: toInputSteps(history, userText),
        tools: [EDIT_ITINERARY_TOOL],
    });

    let res: Response;
    for (let attempt = 0;; attempt++) {
        try {
            res = await fetch(`${GEMINI_API_BASE}/interactions`, {
                method: "POST",
                headers: { ...authHeaders(apiKey), "Content-Type": "application/json" },
                body,
                signal,
            });
        } catch (e) {
            if (signal?.aborted) throw e;
            console.error("Gemini request failed", e);
            throw new Error("無法連線到 Gemini，請檢查網路連線。", { cause: e });
        }
        const delay = BUSY_RETRY_DELAYS_MS[attempt];
        if (!isBusy(res.status) || delay === undefined) break;
        onBusyRetry?.(attempt + 1, BUSY_RETRY_DELAYS_MS.length);
        await wait(delay, signal);
    }

    if (!res.ok) {
        await handleErrorResponse(res);
    }

    const payload: unknown = await res.json();
    const turn = extractTurn(payload);
    if (!turn.text && !turn.edits) {
        throw new Error("Gemini 沒有回覆內容，請換個方式再問一次。");
    }
    return turn;
}
