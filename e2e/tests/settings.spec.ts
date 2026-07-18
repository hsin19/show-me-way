import type {
    Locator,
    Page,
} from "@playwright/test";
import {
    expect,
    FIXTURE_YAML,
    seedItinerary,
    test,
} from "./fixtures";

// 設定對話框（SettingsDialog.svelte）：YAML 編輯與儲存、自動備份還原、
// 無效 YAML 的行內錯誤、未儲存變更的關閉守衛。對話框是常駐 DOM，
// 以 opacity + inert 切換開闔 — Playwright 視 opacity:0 為 visible，
// 所以「已開啟」用 toBeVisible()，「已關閉」改驗 overlay 的 inert（移出無障礙樹）。

const EDITED_YAML = FIXTURE_YAML.replace("name: 測試行程", "name: 改版行程");

async function expectSettingsClosed(page: Page): Promise<void> {
    const overlay = page.getByRole("dialog", { name: "自訂 YAML 行程設定" }).locator("..");
    await expect(overlay).toHaveJSProperty("inert", true);
}

// 從總覽開啟設定，並等 initEditor 把現有 YAML 填入編輯器
// （太早 fill 會被 init 的內容覆寫）。
async function openSettings(page: Page): Promise<Locator> {
    await page.getByRole("button", { name: "自訂 YAML 行程" }).click();
    const dialog = page.getByRole("dialog", { name: "自訂 YAML 行程設定" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel("行程資料 (YAML)")).toHaveValue(/trip:/);
    return dialog;
}

test("設定：編輯 YAML 並儲存後套用新行程", async ({ page }) => {
    await seedItinerary(page);
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 2, name: "測試行程" })).toBeVisible();

    const dialog = await openSettings(page);
    await dialog.getByLabel("行程資料 (YAML)").fill(EDITED_YAML);
    await dialog.getByRole("button", { name: "儲存並解析" }).click();

    await expect(page.getByRole("status")).toContainText("儲存成功");
    await expectSettingsClosed(page);
    await expect(page.getByRole("heading", { level: 2, name: "改版行程" })).toBeVisible();
    await expect(page).toHaveTitle("改版行程");
});

test("備份還原：儲存後產生備份，還原回前一版行程", async ({ page }) => {
    await seedItinerary(page);
    await page.goto("/");

    // 先儲存一次修改版 — 覆蓋前會自動備份原本的「測試行程」
    let dialog = await openSettings(page);
    await dialog.getByLabel("行程資料 (YAML)").fill(EDITED_YAML);
    await dialog.getByRole("button", { name: "儲存並解析" }).click();
    await expect(page.getByRole("heading", { level: 2, name: "改版行程" })).toBeVisible();

    // 重新開啟設定：備份區出現一列，空狀態文案消失
    dialog = await openSettings(page);
    await expect(dialog.getByText("尚無自動備份")).not.toBeVisible();
    const restoreRow = dialog.getByRole("button", { name: "還原" });
    await expect(restoreRow).toHaveCount(1);

    // 原生 confirm()：Playwright 預設 dismiss，觸發前先註冊 accept
    let confirmMessage = "";
    page.once("dialog", d => {
        confirmMessage = d.message();
        void d.accept();
    });
    await restoreRow.click();
    expect(confirmMessage).toBe("要以此備份覆蓋目前的行程嗎？");

    await expect(page.getByRole("status")).toContainText("已還原");
    await expectSettingsClosed(page);
    await expect(page.getByRole("heading", { level: 2, name: "測試行程" })).toBeVisible();
    await expect(page).toHaveTitle("測試行程");
});

test("無效 YAML：顯示行內驗證錯誤且對話框保持開啟", async ({ page }) => {
    await seedItinerary(page);
    await page.goto("/");

    const dialog = await openSettings(page);
    await dialog.getByLabel("行程資料 (YAML)").fill("days: []");
    await dialog.getByRole("button", { name: "儲存並解析" }).click();

    await expect(dialog.getByText("YAML 缺少必要的結構")).toBeVisible();
    await expect(dialog).toBeVisible();
    // 無效內容沒有被存入 — 行程維持原樣
    await expect(page).toHaveTitle("測試行程");
});

test("未儲存變更：關閉時跳確認，取消保留、確認才關閉", async ({ page }) => {
    await seedItinerary(page);
    await page.goto("/");

    const dialog = await openSettings(page);
    const editor = dialog.getByLabel("行程資料 (YAML)");
    await editor.fill("edited: true");

    // Escape 走 attemptClose 的未儲存守衛 — dismiss 保留對話框與編輯內容
    let confirmMessage = "";
    page.once("dialog", d => {
        confirmMessage = d.message();
        void d.dismiss();
    });
    await page.keyboard.press("Escape");
    await expect.poll(() => confirmMessage).toContain("尚有未儲存的變更");
    await expect(dialog).toBeVisible();
    await expect(editor).toHaveValue("edited: true");

    // 關閉按鈕走同一個守衛 — accept 後才真的關閉
    page.once("dialog", d => void d.accept());
    await dialog.getByRole("button", { name: "關閉設定" }).click();
    await expectSettingsClosed(page);
});
