import {
    expect,
    FIXTURE_YAML,
    seedItinerary,
    test,
} from "./fixtures";

// AI 聊天分頁（ChatPanel + gemini.ts）的端對端測試。Gemini 的兩個端點都用
// page.route mock（page 層級路由優先於 fixtures.ts 的 context 層級封鎖）：
// GET /v1beta/models 回單頁模型清單（絕不可帶 nextPageToken，否則
// listGeminiModels 會無限翻頁），POST /v1beta/interactions 回 Interactions
// steps 形狀的回應（模型文字 + update_itinerary function_call）。

const MODELS_URL_PREFIX = "https://generativelanguage.googleapis.com/v1beta/models";
const INTERACTIONS_URL = "https://generativelanguage.googleapis.com/v1beta/interactions";

// FIXTURE_YAML 以 todo 清單結尾，直接附加一個項目仍是合法的行程 YAML
// （會通過 ChatPanel 與 App.svelte 兩層 validateYaml）。
const EDITED_YAML = `${FIXTURE_YAML}  - text: 換日幣\n`;

test("AI 聊天：儲存金鑰、AI 建議修改行程、套用後保留至重新載入", async ({ page }) => {
    await page.route(url => url.href.startsWith(MODELS_URL_PREFIX), route =>
        route.fulfill({
            json: {
                models: [
                    { name: "models/gemini-2.5-flash", displayName: "Gemini 2.5 Flash", supportedGenerationMethods: ["generateContent"] },
                ],
            },
        }));
    await page.route(INTERACTIONS_URL, route =>
        route.fulfill({
            json: {
                steps: [
                    { type: "model_output", content: [{ type: "text", text: "已幫你加入待辦。" }] },
                    { type: "function_call", id: "c1", name: "update_itinerary", arguments: { yaml: EDITED_YAML, summary: "已加入待辦「換日幣」。" } },
                ],
            },
        }));
    await seedItinerary(page);
    await page.goto("/");

    // 首次進入 AI 分頁：顯示金鑰表單
    await page.locator("nav").getByRole("button", { name: "AI", exact: true }).click();
    await expect(page.getByRole("heading", { name: "AI 行程小幫手" })).toBeVisible();
    await expect(page.getByText("請輸入你的 Google Gemini API 金鑰。金鑰只會儲存在這台裝置上，不會上傳。")).toBeVisible();

    await page.getByLabel("Gemini API 金鑰").fill("test-key");
    await page.getByRole("button", { name: "儲存並開始" }).click();
    await expect(page.getByRole("status")).toContainText("已儲存");

    // 模型清單 mock 生效：下拉選單載入可用模型
    await expect(page.getByLabel("選擇 AI 模型")).toContainText("Gemini 2.5 Flash");

    await page.getByLabel("輸入問題").fill("把待辦加上換日幣");
    await page.getByRole("button", { name: "送出" }).click();

    // 回覆氣泡與建議修改卡片（diff 預覽收在「查看變更」內）
    await expect(page.getByText("已幫你加入待辦。")).toBeVisible();
    await expect(page.getByText("AI 建議修改行程")).toBeVisible();
    await expect(page.getByText("查看變更")).toBeVisible();

    await page.getByRole("button", { name: "套用變更" }).click();
    await expect(page.getByRole("status")).toContainText("已套用");
    await expect(page.getByText("已套用變更")).toBeVisible();

    // 套用結果出現在「準備」分頁，且已寫入 showmeway_user_yaml（重新載入後保留）
    await page.locator("nav").getByRole("button", { name: "準備", exact: true }).click();
    await expect(page.getByRole("checkbox", { name: "換日幣" })).toBeVisible();

    await page.reload();
    await page.locator("nav").getByRole("button", { name: "準備", exact: true }).click();
    await expect(page.getByRole("checkbox", { name: "換日幣" })).toBeVisible();
});

test("AI 聊天：Gemini 無法連線時顯示錯誤並保留提問", async ({ page }) => {
    // 金鑰已存在 → 直接進入聊天畫面；模型清單抓取失敗會靜默回退預設模型
    await page.addInitScript(() => {
        window.localStorage.setItem("showmeway_gemini_api_key", "test-key");
    });
    await page.route(INTERACTIONS_URL, route => route.abort());
    await seedItinerary(page);
    await page.goto("/");

    await page.locator("nav").getByRole("button", { name: "AI", exact: true }).click();
    await page.getByLabel("輸入問題").fill("第二天去哪？");
    await page.getByRole("button", { name: "送出" }).click();

    await expect(page.getByText("無法連線到 Gemini")).toBeVisible();
    // 提問保留在對話中，方便重試
    await expect(page.getByText("第二天去哪？")).toBeVisible();
});
