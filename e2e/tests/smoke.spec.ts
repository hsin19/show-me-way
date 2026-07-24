import {
    expect,
    seedItinerary,
    stubMissingLocalItinerary,
    test,
} from "./fixtures";

// Smoke suite for the built app (vite build + vite preview): boots the PWA,
// walks the bottom tabs (行程/工具/AI — 準備/記帳/常用語/行程管理/App 設定 are sub-pages
// inside 工具) and the overview tool entries, and verifies that edits
// round-trip through the YAML in localStorage (showmeway_user_yaml) across a
// reload. All assertions use the app's real Traditional Chinese UI strings —
// punctuation is fullwidth where the UI uses fullwidth (｜ U+FF5C, — U+2014).

test("種子行程載入：顯示行程總覽且無執行期錯誤", async ({ page }) => {
    const pageErrors: Error[] = [];
    page.on("pageerror", err => pageErrors.push(err));

    await seedItinerary(page);
    await page.goto("/");

    await expect(page.getByRole("heading", { level: 2, name: "測試行程" })).toBeVisible();
    // App.svelte rewrites document.title to trip.name once the YAML is loaded.
    await expect(page).toHaveTitle("測試行程");
    // One chip per day in the day strip (the 總覽 chip carries no data-day).
    await expect(page.locator("button[data-day]")).toHaveCount(2);

    expect(pageErrors.map(e => e.message).join("\n")).toBe("");
});

test("無使用者資料時回退載入預設範本", async ({ page }) => {
    await stubMissingLocalItinerary(page);
    await page.goto("/");

    await expect(page).toHaveTitle("我的探索之旅 (範本)");
});

test("日程切換：各天顯示對應事件後可返回總覽", async ({ page }) => {
    await seedItinerary(page);
    await page.goto("/");

    await page.locator("button[data-day]").first().click();
    await expect(page.getByRole("heading", { name: /Day 1｜/ })).toBeVisible();
    await expect(page.getByText("測試事件一")).toBeVisible();

    await page.locator("button[data-day]").nth(1).click();
    await expect(page.getByRole("heading", { name: /Day 2｜/ })).toBeVisible();
    await expect(page.getByText("測試事件二")).toBeVisible();

    await page.getByRole("button", { name: "總覽" }).click();
    await expect(page.getByRole("heading", { level: 2, name: "測試行程" })).toBeVisible();
});

test("事件打卡：標記完成並於重新載入後保留", async ({ page }) => {
    await seedItinerary(page);
    await page.goto("/");

    await page.locator("button[data-day]").first().click();
    const card = page.locator("[data-timeline-event]").first();
    await card.getByRole("button", { name: "標記為已完成" }).click();
    await expect(card.getByRole("button", { name: "取消已完成標記" })).toBeVisible();

    await page.reload();
    await page.locator("button[data-day]").first().click();
    await expect(
        page.locator("[data-timeline-event]").first().getByRole("button", { name: "取消已完成標記" }),
    ).toBeVisible();
});

test("清單：勾選與新增項目並於重新載入後保留", async ({ page }) => {
    await seedItinerary(page);
    await page.goto("/");

    await page.locator("nav").getByRole("button", { name: "工具", exact: true }).click();
    await expect(page.getByRole("heading", { name: "行前準備與打包" })).toBeVisible();

    // 勾選既有項目（<button role="checkbox">，非 <input>）
    const seededItem = page.getByRole("checkbox", { name: "測試待辦項目" });
    await expect(seededItem).not.toBeChecked();
    await seededItem.click();
    await expect(seededItem).toBeChecked();

    // 新增一個項目（aria-label 是「待辦事項 — 新增項目」，em dash）
    const input = page.getByLabel("待辦事項 — 新增項目");
    await input.fill("新增的測試項目");
    await input.press("Enter");
    await expect(page.getByRole("checkbox", { name: "新增的測試項目" })).toBeVisible();

    await page.reload();
    await page.locator("nav").getByRole("button", { name: "工具", exact: true }).click();
    await expect(page.getByRole("checkbox", { name: "測試待辦項目" })).toBeChecked();
    await expect(page.getByRole("checkbox", { name: "新增的測試項目" })).toBeVisible();
});

test("記帳：新增一筆消費並於重新載入後保留", async ({ page }) => {
    await seedItinerary(page);
    await page.goto("/");

    // 記帳是工具分頁的子頁
    await page.locator("nav").getByRole("button", { name: "工具", exact: true }).click();
    await page.getByRole("button", { name: "記帳", exact: true }).click();
    await expect(page.getByRole("heading", { name: "匯率與消費記帳" })).toBeVisible();

    await page.getByLabel("消費項目名稱").fill("測試消費");
    await page.getByLabel("金額", { exact: true }).fill("100");
    await page.getByRole("button", { name: "記一筆" }).click();

    // fixture 無 currency → 台幣模式（NT$）；金額同時出現在「已花費」統計磚與紀錄列
    await expect(page.getByText("測試消費")).toBeVisible();
    await expect(page.getByText("-NT$100")).toHaveCount(2);

    await page.reload();
    await page.locator("nav").getByRole("button", { name: "工具", exact: true }).click();
    await page.getByRole("button", { name: "記帳", exact: true }).click();
    await expect(page.getByText("-NT$100")).toHaveCount(2);
});

test("工具分頁：常用語頁可開啟並返回行程", async ({ page }) => {
    await seedItinerary(page);
    await page.goto("/");

    // fixture 未指定 trip.lang → 回退英文字卡組，chip 仍會顯示
    await page.locator("nav").getByRole("button", { name: "工具", exact: true }).click();
    await page.getByRole("button", { name: "常用語", exact: true }).click();
    await expect(page.getByRole("heading", { name: "實用常用語" })).toBeVisible();

    await page.locator("nav").getByRole("button", { name: "行程", exact: true }).click();
    await expect(page.getByRole("heading", { level: 2, name: "測試行程" })).toBeVisible();
});

// The chip row overflows a narrow phone and will only get longer, so selecting a
// chip has to scroll it into view — otherwise deep-linking (e.g. the overview's
// phase card jumping to 記帳) lands on a page whose active chip is off screen.
test("工具分頁：選中的 chip 會捲進視野（窄螢幕）", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await seedItinerary(page);
    await page.goto("/");
    await page.locator("nav").getByRole("button", { name: "工具", exact: true }).click();

    const lastChip = page.getByRole("button", { name: "App 設定", exact: true });
    await lastChip.click();
    await expect(page.getByRole("heading", { level: 3, name: "外觀" })).toBeVisible();

    // Fully inside the scroller, not clipped at its trailing edge.
    const fits = await lastChip.evaluate(chip => {
        const row = chip.closest(".edge-fade")!;
        const c = chip.getBoundingClientRect(), r = row.getBoundingClientRect();
        return c.left >= r.left - 1 && c.right <= r.right + 1;
    });
    expect(fits).toBe(true);
});

test("無效的使用者 YAML：顯示錯誤畫面與設定入口", async ({ page }) => {
    await seedItinerary(page, "days: []\n");
    await page.goto("/");

    await expect(page.getByText("無法載入或解析行程資料。請開啟設定確認 YAML 語法。")).toBeVisible();
    await expect(page.getByRole("button", { name: "開啟設定並貼上 YAML" })).toBeVisible();
});
