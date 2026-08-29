import {
    expect,
    FIXTURE_YAML,
    seedItinerary,
    stubMissingLocalItinerary,
    test,
} from "./fixtures";

// `days[].region` 是 `days[].title` 的舊名。已安裝的 PWA 在 localStorage
// (`showmeway_user_yaml`) 裡存的是舊 YAML，升級後不能壞掉：normalizeTripData
// 會把 region 讀成 title，而下一次寫回時 serializeToYaml 只輸出 title。
// 這支測試守的是 localStorage 這條真實路徑（單元測試 src/lib/domain/trip.test.ts 只走
// validateYaml），因為使用者不會為了升級去手動改檔案。

// 只替換 4 空格縮排的 day 標題 — timeline 事件的 `title` 縮排是 8 空格，
// 一律替換會把事件名稱也改掉。
const LEGACY_YAML = FIXTURE_YAML.replace(/^ {4}title: (測試區域.)$/gm, "    region: $1");

test("舊版 region 資料：載入不壞，且下次存檔自動改寫成 title", async ({ page }) => {
    // 前提檢查：fixture 改名後這支測試若沒跟著改，就不再測到遷移。
    expect(LEGACY_YAML).toContain("region: 測試區域一");
    expect(LEGACY_YAML).not.toContain("title: 測試區域一");

    await stubMissingLocalItinerary(page);
    await seedItinerary(page, LEGACY_YAML);
    await page.goto("/");

    // 舊欄位被當成 title 讀出來 — 日程卡的大標題就是 title。
    await page.locator("button[data-day]").first().click();
    await expect(page.getByRole("heading", { name: "測試區域一" })).toBeVisible();

    // 觸發一次寫回：清單的勾選狀態存在行程 YAML 裡，所以勾一下就會 persist。
    await page.locator("nav").getByRole("button", { name: "工具", exact: true }).click();
    await page.getByRole("checkbox", { name: "測試待辦項目" }).check();

    const stored = await page.evaluate(() => window.localStorage.getItem("showmeway_user_yaml"));
    expect(stored).toContain("title: 測試區域一");
    expect(stored).not.toContain("region:");

    // 改寫後重新載入仍然正常（沒有寫出一份自己讀不回來的 YAML）。
    await page.reload();
    await page.locator("button[data-day]").first().click();
    await expect(page.getByRole("heading", { name: "測試區域一" })).toBeVisible();
});
