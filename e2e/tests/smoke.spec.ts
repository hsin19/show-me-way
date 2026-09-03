import {
    expect,
    seedItinerary,
    stubMissingLocalItinerary,
    test,
} from "./fixtures";

// Smoke suite for the built app (vite build + vite preview): boots the PWA,
// walks the bottom tabs (行程/工具/AI — 準備/行程管理/App 設定 are sub-pages
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

    await expect(page).toHaveTitle("下面一way-我的探索之旅");
});

test("日程切換：各天顯示對應事件後可返回總覽", async ({ page }) => {
    await seedItinerary(page);
    await page.goto("/");

    await page.locator("button[data-day]").first().click();
    await expect(page.getByRole("heading", { name: "測試區域一" })).toBeVisible();
    await expect(page.getByText("測試事件一")).toBeVisible();

    await page.locator("button[data-day]").nth(1).click();
    await expect(page.getByRole("heading", { name: "測試區域二" })).toBeVisible();
    await expect(page.getByText("測試事件二")).toBeVisible();

    await page.getByRole("button", { name: "總覽" }).click();
    await expect(page.getByRole("heading", { level: 2, name: "測試行程" })).toBeVisible();
});

test("事件打卡：標記完成並於重新載入後保留", async ({ page }) => {
    await seedItinerary(page);
    await page.goto("/");

    await page.locator("button[data-day]").first().click();
    const card = page.locator("[data-event-id]").first();
    await card.getByRole("button", { name: "標記為已完成" }).click();
    await expect(card.getByRole("button", { name: "取消已完成標記" })).toBeVisible();

    await page.reload();
    await page.locator("button[data-day]").first().click();
    await expect(
        page.locator("[data-event-id]").first().getByRole("button", { name: "取消已完成標記" }),
    ).toBeVisible();
});

test("清單：勾選與新增項目並於重新載入後保留", async ({ page }) => {
    await seedItinerary(page);
    await page.goto("/");

    await page.locator("nav").getByRole("button", { name: "工具", exact: true }).click();
    await expect(page.getByRole("heading", { name: "行前準備與打包" })).toBeVisible();

    // 勾選既有項目（<label> 包住的 <input type="checkbox">；可及名稱來自 label 文字）
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

// TabPager renders the 總覽 chip OUTSIDE the scroller (pinnedCount=1), so it
// cannot scroll away however long the trip is. Asserted structurally rather than
// by offset: the point is that it is not part of the scrolling content.
test("日程列：總覽 chip 不隨日期捲動離開", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    // Ten days so the strip overflows well past the sticky range.
    const days = Array.from({ length: 10 }, (_, i) => i + 1)
        .map(d =>
            `  - day: ${d}\n    date: '2099-01-${String(d).padStart(2, "0")}'\n`
            + `    title: 區域${d}\n    pace: 悠閒\n    timeline:\n`
            + `      - time: '09:00'\n        title: 第${d}天事件\n        type: standard\n        desc: 說明\n`
        )
        .join("");
    await seedItinerary(
        page,
        `trip:\n  name: 長行程\n  start: '2099-01-01'\n  end: '2099-01-10'\n`
            + `  departure: '2099-01-01T08:00:00+08:00'\n  hotels: []\ndays:\n${days}`,
    );
    await page.goto("/");

    await page.locator("button[data-day]").last().click();
    await expect(page.getByRole("heading", { name: "區域10" })).toBeVisible();

    const overview = page.getByRole("button", { name: "總覽" });
    await expect(overview).toBeVisible();

    const pinned = await page.evaluate(() => {
        const scroller = document.querySelector("[data-pager-scroller]") as HTMLElement;
        const chip = [...document.querySelectorAll("button")].find(b => b.textContent?.trim() === "總覽")!;
        return {
            scrolled: scroller.scrollLeft > 0,
            insideScroller: scroller.contains(chip),
            // Still left of the scrolling region, i.e. leading the row.
            leadsRow: chip.getBoundingClientRect().right <= scroller.getBoundingClientRect().left + 1,
        };
    });
    expect(pinned.scrolled).toBe(true);
    expect(pinned.insideScroller).toBe(false);
    expect(pinned.leadsRow).toBe(true);
});

test("無效的使用者 YAML：顯示錯誤畫面與設定入口", async ({ page }) => {
    await seedItinerary(page, "days: []\n");
    await page.goto("/");

    await expect(page.getByText("無法載入或解析行程資料。請開啟設定確認 YAML 語法。")).toBeVisible();
    await expect(page.getByRole("button", { name: "開啟設定並貼上 YAML" })).toBeVisible();
});
