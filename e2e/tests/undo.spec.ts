import {
    expect,
    seedItinerary,
    test,
} from "./fixtures";

// 刪除／復原流程：App.svelte 的刪除 handler 會先 persist、再以帶「復原」動作的
// toast（role=status，4500ms 窗口）提供 undo，undo 透過 insertAtClamped 把快照
// 插回原本的 index。刪除與復原之間不可 reload 或切換分頁 — toast 狀態只存在
// 記憶體中。

test("清單項目刪除後可復原並保留原本位置", async ({ page }) => {
    await seedItinerary(page);
    await page.goto("/");

    await page.locator("nav").getByRole("button", { name: "準備", exact: true }).click();
    await expect(page.getByRole("heading", { name: "行前準備與打包" })).toBeVisible();

    // 先補一個項目，讓「復原後回到第一位」的斷言有意義（fixture 只有一筆 todo）。
    const input = page.getByLabel("待辦事項 — 新增項目");
    await input.fill("另一個待辦");
    await input.press("Enter");
    await expect(page.getByRole("checkbox", { name: "另一個待辦" })).toBeVisible();

    // 刪除種子項目（列內的垃圾桶按鈕 aria-label 是「刪除項目」）
    const seededItem = page.getByRole("checkbox", { name: "測試待辦項目" });
    await page
        .locator("li")
        .filter({ has: seededItem })
        .getByRole("button", { name: "刪除項目" })
        .click();
    await expect(seededItem).toHaveCount(0);

    // toast 帶「復原」動作 — 立即點擊（4500ms 窗口內）
    const toast = page.getByRole("status");
    await expect(toast).toContainText("已刪除");
    await toast.getByRole("button", { name: "復原" }).click();

    // insertAtClamped 應把項目放回原本的 index 0（第一位）
    await expect(seededItem).toBeVisible();
    await expect(page.getByRole("checkbox").first()).toHaveAccessibleName("測試待辦項目");

    // 復原結果已 persist 回 YAML，重新載入後仍在
    await page.reload();
    await page.locator("nav").getByRole("button", { name: "準備", exact: true }).click();
    await expect(page.getByRole("checkbox", { name: "測試待辦項目" })).toBeVisible();
    await expect(page.getByRole("checkbox").first()).toHaveAccessibleName("測試待辦項目");
});

test("消費紀錄刪除後可復原並於重新載入後保留", async ({ page }) => {
    await seedItinerary(page);
    await page.goto("/");

    await page.locator("nav").getByRole("button", { name: "記帳", exact: true }).click();
    await expect(page.getByRole("heading", { name: "匯率與消費記帳" })).toBeVisible();

    await page.getByLabel("消費項目名稱").fill("測試消費");
    await page.getByLabel("金額", { exact: true }).fill("100");
    await page.getByRole("button", { name: "記一筆" }).click();

    // fixture 無 currency → 台幣模式；金額出現在「已花費」統計磚與紀錄列
    await expect(page.getByText("-NT$100")).toHaveCount(2);

    // 刪除該筆紀錄（紀錄列按鈕 aria-label 是「刪除紀錄」）
    await page.getByRole("button", { name: "刪除紀錄" }).click();
    await expect(page.getByText("-NT$100")).toHaveCount(0);

    const toast = page.getByRole("status");
    await expect(toast).toContainText("紀錄已刪除");
    await toast.getByRole("button", { name: "復原" }).click();
    await expect(page.getByText("-NT$100")).toHaveCount(2);

    await page.reload();
    await page.locator("nav").getByRole("button", { name: "記帳", exact: true }).click();
    await expect(page.getByText("-NT$100")).toHaveCount(2);
});
