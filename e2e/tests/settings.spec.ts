import type { Page } from "@playwright/test";
import {
    expect,
    FIXTURE_YAML,
    seedItinerary,
    test,
} from "./fixtures";

// 行程管理頁（SettingsPanel.svelte — 工具分頁內的頁面，非模態）：YAML 編輯與
// 儲存、自動備份還原、無效 YAML 的行內錯誤、未儲存草稿跨分頁保留
// （settings-draft.svelte.ts）。儲存／還原成功後會自動導回行程分頁。

const EDITED_YAML = FIXTURE_YAML.replace("name: 測試行程", "name: 改版行程");

// 從工具分頁的「行程管理」chip 進入設定頁，並等 initEditor 把現有 YAML
// 填入編輯器（太早 fill 會被 init 的內容覆寫）。
async function openSettings(page: Page): Promise<void> {
    await page.locator("nav").getByRole("button", { name: "工具", exact: true }).click();
    await page.getByRole("button", { name: "行程管理", exact: true }).click();
    await expect(page.getByRole("heading", { name: "行程管理" })).toBeVisible();
    await expect(page.getByLabel("行程資料 (YAML)")).toHaveValue(/trip:/);
}

test("設定：編輯 YAML 並儲存後套用新行程", async ({ page }) => {
    await seedItinerary(page);
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 2, name: "測試行程" })).toBeVisible();

    await openSettings(page);
    await page.getByLabel("行程資料 (YAML)").fill(EDITED_YAML);
    await page.getByRole("button", { name: "儲存並解析" }).click();

    await expect(page.getByRole("status")).toContainText("儲存成功");
    // 儲存成功後自動導回行程分頁
    await expect(page.getByRole("heading", { level: 2, name: "改版行程" })).toBeVisible();
    await expect(page).toHaveTitle("改版行程");
});

test("備份還原：儲存後產生備份，還原回前一版行程", async ({ page }) => {
    await seedItinerary(page);
    await page.goto("/");

    // 先儲存一次修改版 — 覆蓋前會自動備份原本的「測試行程」
    await openSettings(page);
    await page.getByLabel("行程資料 (YAML)").fill(EDITED_YAML);
    await page.getByRole("button", { name: "儲存並解析" }).click();
    await expect(page.getByRole("heading", { level: 2, name: "改版行程" })).toBeVisible();

    // 重新進入設定頁：備份區出現一列，空狀態文案消失
    await openSettings(page);
    await expect(page.getByText("尚無自動備份")).not.toBeVisible();
    const restoreRow = page.getByRole("button", { name: "還原" });
    await expect(restoreRow).toHaveCount(1);

    // 點擊「還原」按鈕展開 ConfirmBar 行內確認，再點擊「確定還原」
    await restoreRow.click();
    await expect(page.getByText(/確定要還原.*的備份嗎？/)).toBeVisible();
    await page.getByRole("button", { name: "確定還原" }).click();

    await expect(page.getByRole("status")).toContainText("已還原");
    // 還原成功後同樣導回行程分頁
    await expect(page.getByRole("heading", { level: 2, name: "測試行程" })).toBeVisible();
    await expect(page).toHaveTitle("測試行程");
});

test("無效 YAML：顯示行內驗證錯誤且停留在設定頁", async ({ page }) => {
    await seedItinerary(page);
    await page.goto("/");

    await openSettings(page);
    await page.getByLabel("行程資料 (YAML)").fill("days: []");
    await page.getByRole("button", { name: "儲存並解析" }).click();

    await expect(page.getByText("YAML 缺少必要的結構")).toBeVisible();
    await expect(page.getByRole("heading", { name: "行程管理" })).toBeVisible();
    // 無效內容沒有被存入 — 行程維持原樣
    await expect(page).toHaveTitle("測試行程");
});

test("未儲存草稿：切換分頁後再回來仍保留編輯內容", async ({ page }) => {
    await seedItinerary(page);
    await page.goto("/");

    await openSettings(page);
    const editor = page.getByLabel("行程資料 (YAML)");
    await editor.fill("edited: true");

    // 切去行程分頁再回工具分頁（子頁記憶為行程管理）— 草稿仍在
    await page.locator("nav").getByRole("button", { name: "行程", exact: true }).click();
    await expect(page.getByRole("heading", { level: 2, name: "測試行程" })).toBeVisible();

    await page.locator("nav").getByRole("button", { name: "工具", exact: true }).click();
    await expect(page.getByRole("heading", { name: "行程管理" })).toBeVisible();
    await expect(editor).toHaveValue("edited: true");
});

// 這幾個 affordance 曾經在一次無關的改寫中被順手刪掉（複製鈕、手機輸入屬性、
// 預設行程與 Skill 安裝說明），而型別、lint、單元測試全都不會察覺。
test("編輯器：複製鈕可用，且保留手機輸入必要屬性與說明", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await seedItinerary(page);
    await page.goto("/");
    await openSettings(page);

    // YAML 的 key 全小寫：手機輸入法自動大寫會直接產生無效的行程。
    const editor = page.locator("#yaml-editor");
    await expect(editor).toHaveAttribute("spellcheck", "false");
    await expect(editor).toHaveAttribute("autocapitalize", "off");

    // exact：不加會連「複製跨裝置連結」一起命中。
    await page.getByRole("button", { name: "複製", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("已複製編輯器中的 YAML");
    expect(await page.evaluate(() => navigator.clipboard.readText())).toContain("name: 測試行程");

    // 說明卡：清空後的行為、資料出境、以及產生 YAML 的 Skill 從哪來。
    await expect(page.getByRole("link", { name: "itinerary.yaml" })).toBeVisible();
    await expect(page.getByText(/同步會把整份行程（含記帳明細）複製到你自己的 Drive/)).toBeVisible();
    await expect(page.getByText(/npx skills add .*itinerary-yaml-builder/)).toBeVisible();
});
