import {
    expect,
    seedItinerary,
    stubMissingLocalItinerary,
    test,
} from "./fixtures";

// 行程設定檔（trip profiles）生命週期：建立 → 切換 → 刪除（先取消再確認）。
// 建立與切換各觸發一次 loadTripData（isLoading 會暫時卸載總覽面板，切換器
// 因此收合），所以每個步驟都先等 level-2 標題出現，再重新展開切換器。

test("行程設定檔：建立、切換、刪除與取消刪除", async ({ page }) => {
    // 讓「新增行程」一定取得內建範本，而非本機的個人 itinerary.local.yaml。
    await stubMissingLocalItinerary(page);
    await seedItinerary(page);
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 2, name: "測試行程" })).toBeVisible();

    const expander = page.getByRole("button", { name: /目前行程/ });
    const status = page.getByRole("status");

    // (1) 建立：展開切換器 → 新增行程 → 設定視窗自動開啟 → 關閉後顯示範本行程
    await expect(expander).toHaveAttribute("aria-expanded", "false");
    await expander.click();
    await expect(expander).toHaveAttribute("aria-expanded", "true");
    await page.getByRole("button", { name: "新增行程" }).click();
    await expect(status).toContainText("已建立新行程");

    const settingsDialog = page.getByRole("dialog", { name: "自訂 YAML 行程設定" });
    await expect(settingsDialog).toBeVisible();
    await settingsDialog.getByRole("button", { name: "關閉設定" }).click();

    await expect(page).toHaveTitle("我的探索之旅 (範本)");
    await expect(page.getByRole("heading", { level: 2, name: "我的探索之旅 (範本)" })).toBeVisible();

    // 原本的行程被停放成 profile，出現在切換器清單裡
    await expect(expander).toHaveAttribute("aria-expanded", "false");
    await expander.click();
    const parkedFixtureRow = page.getByRole("button", { name: "測試行程 切換" });
    await expect(parkedFixtureRow).toBeVisible();

    // (2) 切換：換回原本的行程
    await parkedFixtureRow.click();
    await expect(status).toContainText("已切換");
    await expect(page.getByRole("heading", { level: 2, name: "測試行程" })).toBeVisible();
    await expect(page).toHaveTitle("測試行程");

    // 範本行程改為停放狀態
    await expect(expander).toHaveAttribute("aria-expanded", "false");
    await expander.click();
    const parkedTemplateRow = page.getByRole("button", { name: "我的探索之旅 (範本) 切換" });
    const deleteButton = page.getByRole("button", { name: "刪除行程 我的探索之旅 (範本)" });
    await expect(parkedTemplateRow).toBeVisible();

    // (3) 取消刪除：confirm 按取消後列仍在，localStorage 也未動
    // （Playwright 預設就會 dismiss，仍顯式註冊以表達意圖）
    page.once("dialog", dialog => void dialog.dismiss());
    await deleteButton.click();
    await expect(parkedTemplateRow).toBeVisible();
    expect(await page.evaluate(() => window.localStorage.getItem("showmeway_profiles") ?? "")).toContain("我的探索之旅");

    // (4) 確認刪除：confirm 訊息逐字比對（fullwidth 標點），接受後列消失
    page.once("dialog", dialog => {
        expect(dialog.message()).toBe("要刪除行程「我的探索之旅 (範本)」嗎？此動作無法復原。");
        void dialog.accept();
    });
    await deleteButton.click();
    await expect(status).toContainText("已刪除");
    await expect(parkedTemplateRow).toHaveCount(0);
    await expect(deleteButton).toHaveCount(0);

    // 重新載入後：作用中行程仍是測試行程，被刪除的 profile 不會復活
    await page.reload();
    await expect(page.getByRole("heading", { level: 2, name: "測試行程" })).toBeVisible();
    expect(await page.evaluate(() => window.localStorage.getItem("showmeway_profiles") ?? "")).not.toContain("我的探索之旅");
});
