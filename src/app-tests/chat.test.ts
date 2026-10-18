import {
    type Matcher,
    screen,
    waitFor,
} from "@testing-library/dom";
import {
    expect,
    test,
} from "vitest";
import {
    createPage,
    navTab,
    type RouteHandler,
    status,
} from "./harness";

// AI 聊天分頁（ChatPanel + gemini.ts）。Gemini 的兩個端點都用 page.route 接住（其餘
// 外部來源一律被 harness 擋下）：GET /v1beta/models 回單頁模型清單（絕不可帶
// nextPageToken，否則 listGeminiModels 會無限翻頁），POST /v1beta/interactions 回
// Interactions steps 形狀的整包 JSON（模型文字 + edit_itinerary function_call）——
// sendChatMessage 讀的是 res.json()，不是串流。兩個端點都像真的 Gemini 一樣只認
// x-goog-api-key 標頭帶的金鑰、其餘回 400：不驗金鑰的話，存了卻沒送出去的金鑰照樣會過。

const MODELS_URL_PREFIX = "https://generativelanguage.googleapis.com/v1beta/models";
const INTERACTIONS_URL = "https://generativelanguage.googleapis.com/v1beta/interactions";

const ONE_MODEL = {
    models: [
        { name: "models/gemini-2.5-flash", displayName: "Gemini 2.5 Flash", supportedGenerationMethods: ["generateContent"] },
    ],
};

/** 模型呼叫 edit_itinerary 新增一個待辦：只送這一筆修改，不是整份行程。 */
function addTodo(text: string, id = "c1") {
    return { type: "function_call", id, name: "edit_itinerary", arguments: { edits: [{ op: "add_item", list: "todo", text }] } };
}

function json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

/** Gemini's answer to a key it does not accept, detail message included. */
function invalidKey(): Response {
    return json({ error: { code: 400, message: "API key not valid. Please pass a valid API key.", status: "INVALID_ARGUMENT" } }, 400);
}

/** Runs `respond` only for a request carrying `key` in its header, as Gemini checks it. */
function keyed(key: string, respond: RouteHandler): RouteHandler {
    return request => (request.headers.get("x-goog-api-key") === key ? respond(request) : invalidKey());
}

// A browser navigates on a submit nobody prevented, which reloads the app and drops the
// chat mid-send; happy-dom only rewrites the URL, so a lost preventDefault on the key
// form or the composer would pass. The app's handlers sit on the form and run first;
// the throw fails the click that submitted.
document.addEventListener("submit", event => {
    if (!event.defaultPrevented) throw new Error("form submitted without preventDefault — a browser would reload the app");
});

/**
 * An element whose whole text, descendants included, is `text` — the way Playwright's
 * `getByText` reads a row. Testing Library's string matcher reads only an element's own
 * text nodes, and a diff line keeps its `+` / `-` marker in a child span.
 */
function wholeText(text: string): Matcher {
    return (_content, element) => element?.textContent?.replace(/\s+/g, " ").trim() === text;
}

const composer = () => screen.getByLabelText<HTMLTextAreaElement>("輸入問題");
const modelSelect = () => screen.getByLabelText("選擇 AI 模型");

test("AI 聊天：儲存金鑰、AI 建議修改行程、套用後保留至重新載入", async () => {
    const page = createPage();
    page.route(MODELS_URL_PREFIX, keyed("test-key", () => json(ONE_MODEL)));
    page.route(
        INTERACTIONS_URL,
        keyed("test-key", () =>
            json({
                steps: [
                    { type: "model_output", content: [{ type: "text", text: "已幫你加入待辦。" }] },
                    addTodo("換日幣"),
                ],
            })),
    );
    await page.goto("/");
    const { user } = page;

    await user.click(navTab("AI"));
    await screen.findByRole("heading", { name: "尚未設定 AI 金鑰" });
    await user.click(screen.getByRole("button", { name: "前往 App 設定" }));

    await screen.findByRole("heading", { name: "AI 助手設定 (Gemini API)" });
    await page.fill(screen.getByLabelText("Gemini API 金鑰"), "test-key");
    await user.click(screen.getByRole("button", { name: "儲存" }));
    await waitFor(() => expect(status().textContent).toContain("已儲存"));

    await user.click(navTab("AI"));
    await waitFor(() => expect(modelSelect().textContent).toContain("Gemini 2.5 Flash"));

    await page.fill(composer(), "把待辦加上換日幣");
    await user.click(screen.getByRole("button", { name: "送出" }));

    await screen.findByText("已幫你加入待辦。");
    screen.getByText("AI 建議修改行程");

    // 展開 DiffView。斷言用正則、不釘 hunk 的確切數量。hunk 導覽只斷言計數文字，不斷言捲動位置：
    // happy-dom 沒有版面可量；在瀏覽器裡 jump() 的顯式 smooth scroll 也壓不住 reducedMotion。
    // 沒有 CSS 時 <details> 收合著內容也在 DOM 裡，所以展開要看 open，而不是看得到內容。
    const summary = screen.getByText("查看變更");
    await user.click(summary);
    expect(summary.closest("details")?.open).toBe(true);
    screen.getByText(/共 \d+ 處變更/);
    await user.click(screen.getByRole("button", { name: "下一處變更" }));
    screen.getByText(/第 1 \/ \d+ 處/);
    screen.getByText(wholeText("+ - text: 換日幣"));

    await user.click(screen.getByRole("button", { name: "套用變更" }));
    await waitFor(() => expect(status().textContent).toContain("已套用"));
    screen.getByText("已套用變更");

    await user.click(navTab("工具"));
    await user.click(screen.getByRole("button", { name: "準備" }));
    screen.getByRole("checkbox", { name: "換日幣" });

    // 重新載入：確認確實寫進 showmeway_user_yaml，而不只是活在記憶體。
    await page.reload();
    await user.click(navTab("工具"));
    await screen.findByRole("checkbox", { name: "換日幣" });
});

test("AI 聊天：先套用後一則建議，再套用較早的那則，兩個修改都留著", async () => {
    const page = createPage();
    window.localStorage.setItem("showmeway_gemini_api_key", "test-key");
    page.route(MODELS_URL_PREFIX, keyed("test-key", () => json(ONE_MODEL)));
    let call = 0;
    page.route(
        INTERACTIONS_URL,
        keyed("test-key", () => {
            call++;
            return json({ steps: [addTodo(call === 1 ? "換日幣" : "買轉接頭", `c${call}`)] });
        }),
    );
    await page.goto("/");
    const { user } = page;

    // 連續送出兩個編輯請求：兩張卡都是對原始行程提出的。
    await user.click(navTab("AI"));
    await page.fill(await screen.findByLabelText("輸入問題"), "加換日幣");
    await user.click(screen.getByRole("button", { name: "送出" }));
    await screen.findByRole("button", { name: "套用變更" });
    await page.fill(composer(), "加買轉接頭");
    await user.click(screen.getByRole("button", { name: "送出" }));
    await waitFor(() => expect(screen.getAllByRole("button", { name: "套用變更" })).toHaveLength(2));

    // 先套用第二張，行程就跟第一張的快照不一樣了。離開 AI 分頁會卸掉對話，所以
    // 套上去的是不是被按的那一張，只能從存檔看。
    await user.click(screen.getAllByRole("button", { name: "套用變更" })[1]!);
    await screen.findByText("已套用變更");
    expect(window.localStorage.getItem("showmeway_user_yaml")).toContain("text: 買轉接頭");

    // 較早的那張是對目前的行程重跑它的修改，不是拿舊快照整份蓋掉，所以不用再確認一次。
    await user.click(screen.getByRole("button", { name: "套用變更" }));
    await waitFor(() => expect(screen.getAllByText("已套用變更")).toHaveLength(2));

    await user.click(navTab("工具"));
    await user.click(screen.getByRole("button", { name: "準備" }));
    screen.getByRole("checkbox", { name: "買轉接頭" });
    screen.getByRole("checkbox", { name: "換日幣" });
});

test("AI 聊天：行程改過之後這則修改對不上了，就停下來說明，不套用", async () => {
    const page = createPage();
    window.localStorage.setItem("showmeway_gemini_api_key", "test-key");
    page.route(MODELS_URL_PREFIX, keyed("test-key", () => json(ONE_MODEL)));
    let call = 0;
    page.route(
        INTERACTIONS_URL,
        keyed("test-key", () => {
            call++;
            const edits = call === 1
                ? [{ op: "update_item", list: "todo", text: "測試待辦項目", yaml: "text: 換日幣" }]
                : [{ op: "remove_item", list: "todo", text: "測試待辦項目" }];
            return json({ steps: [{ type: "function_call", id: `c${call}`, name: "edit_itinerary", arguments: { edits } }] });
        }),
    );
    await page.goto("/");
    const { user } = page;

    await user.click(navTab("AI"));
    await page.fill(await screen.findByLabelText("輸入問題"), "待辦改成換日幣");
    await user.click(screen.getByRole("button", { name: "送出" }));
    await screen.findByRole("button", { name: "套用變更" });
    await page.fill(composer(), "刪掉那個待辦");
    await user.click(screen.getByRole("button", { name: "送出" }));
    await waitFor(() => expect(screen.getAllByRole("button", { name: "套用變更" })).toHaveLength(2));

    await user.click(screen.getAllByRole("button", { name: "套用變更" })[0]!);
    await screen.findByText("已套用變更");
    // 第二張要刪的「測試待辦項目」已經被改名了。
    await user.click(screen.getByRole("button", { name: "套用變更" }));
    expect((await screen.findByText(/這些修改對不上了/)).textContent).toContain("清單裡找不到「測試待辦項目」");
    expect(window.localStorage.getItem("showmeway_user_yaml")).toContain("text: 換日幣");
});

test("AI 聊天：修改對不到行程時直接說明，不給套用按鈕", async () => {
    const page = createPage();
    window.localStorage.setItem("showmeway_gemini_api_key", "test-key");
    page.route(MODELS_URL_PREFIX, keyed("test-key", () => json(ONE_MODEL)));
    page.route(
        INTERACTIONS_URL,
        keyed("test-key", () =>
            json({
                steps: [{ type: "function_call", id: "c1", name: "edit_itinerary", arguments: { edits: [{ op: "remove_event", date: "2099-01-01", title: "不存在的事件" }] } }],
            })),
    );
    await page.goto("/");
    const { user } = page;

    await user.click(navTab("AI"));
    await page.fill(await screen.findByLabelText("輸入問題"), "刪掉那個行程");
    await user.click(screen.getByRole("button", { name: "送出" }));

    await screen.findByText(/AI 給的修改無法套用。第 1 項修改（刪除事件）沒辦法套用：2099-01-01 找不到「不存在的事件」/);
    expect(screen.queryByRole("button", { name: "套用變更" })).toBeNull();
});

test("AI 聊天：Gemini 無法連線時顯示錯誤並保留提問", async () => {
    // 金鑰已存在且模型清單抓得到 → 直接進入聊天畫面，只有送出會失敗。
    // 模型清單必須 mock：抓不到會被當成金鑰不可用而擋掉整個分頁（見下一個測試）。
    const page = createPage();
    window.localStorage.setItem("showmeway_gemini_api_key", "test-key");
    page.route(MODELS_URL_PREFIX, keyed("test-key", () => json(ONE_MODEL)));
    // 第一次送出失敗（handler 拋錯＝連線中斷），重試後成功。
    let interactionCalls = 0;
    page.route(
        INTERACTIONS_URL,
        keyed("test-key", () => {
            interactionCalls++;
            if (interactionCalls === 1) throw new TypeError("Failed to fetch");
            return json({ steps: [{ type: "model_output", content: [{ type: "text", text: "第二天去明洞。" }] }] });
        }),
    );
    await page.goto("/");
    const { user } = page;

    await user.click(navTab("AI"));
    await page.fill(await screen.findByLabelText("輸入問題"), "第二天去哪？");
    await user.click(screen.getByRole("button", { name: "送出" }));

    expect((await screen.findByRole("alert")).textContent).toContain("無法連線到 Gemini");
    // 失敗的提問退回輸入框（不留在對話串，否則會被當成沒有回覆的歷史輪次重播）
    expect(composer().value).toBe("第二天去哪？");
    expect(screen.queryByText(/第二天去哪？/)).toBeNull();

    // 一鍵重試：成功後錯誤消失、提問回到對話串、回覆出現
    await user.click(screen.getByRole("button", { name: "重試" }));
    await screen.findByText("第二天去明洞。");
    screen.getByText("第二天去哪？");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(composer().value).toBe("");
});

test("AI 聊天：金鑰被拒時擋住整個分頁，不讓使用者送出注定失敗的提問", async () => {
    const page = createPage();
    window.localStorage.setItem("showmeway_gemini_api_key", "bad-key");
    // 模型清單就是唯一的金鑰驗證管道，Gemini 沒有獨立的 verify endpoint。
    page.route(MODELS_URL_PREFIX, invalidKey);
    await page.goto("/");
    const { user } = page;

    await user.click(navTab("AI"));

    // 阻斷式錯誤狀態：翻譯後的訊息 + 原始詳細資訊都要看得到
    await screen.findByRole("heading", { name: "AI 金鑰無法使用" });
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("API 金鑰無效或權限不足，請確認金鑰是否正確。");
    expect(alert.textContent).toContain("API key not valid.");

    // 聊天介面完全不出現，沒有可以誤送的輸入框
    expect(screen.queryByLabelText(/輸入問題/)).toBeNull();
    expect(screen.queryByLabelText(/選擇 AI 模型/)).toBeNull();
    screen.getByRole("button", { name: "前往 App 設定" });

    // 重試會重打一次 models（listGeminiModels 失敗時會丟掉記憶體快取）
    let calls = 0;
    page.route(MODELS_URL_PREFIX, () => {
        calls++;
        return json(ONE_MODEL);
    });
    await user.click(screen.getByRole("button", { name: "重試" }));
    await waitFor(() => expect(modelSelect().textContent).toContain("Gemini 2.5 Flash"));
    expect(calls).toBe(1);
});
