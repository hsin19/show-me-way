import { encodeShareToken } from "../../src/lib/share";
import {
    expect,
    seedItinerary,
    test,
} from "./fixtures";

// Share-link flows (src/lib/share.ts + maybeImportSharedItinerary in App.svelte):
// a `#s=<token>` hash carries a whole compressed itinerary. Importing is
// non-destructive — the current trip is parked as a profile, never overwritten —
// and the hash is always stripped afterwards so a refresh never re-prompts.
// Tokens are built in Node with the app's own encodeShareToken (share.ts is
// pure; CompressionStream/btoa exist in Node 18+).

// Same shape as FIXTURE_YAML (passes normalizeTripData) with distinct names,
// so assertions can tell the imported trip from the seeded one.
const SHARED_YAML = `trip:
  name: 分享行程
  start: '2099-02-01'
  end: '2099-02-02'
  departure: '2099-02-01T08:00:00+08:00'
  hotels: []
days:
  - day: 1
    date: '2099-02-01'
    region: 分享區域一
    pace: 輕鬆漫遊
    timeline:
      - time: '09:00'
        title: 分享事件一
        type: standard
        desc: 分享行程的第一天事件
  - day: 2
    date: '2099-02-02'
    region: 分享區域二
    pace: 輕鬆漫遊
    timeline:
      - time: '10:00'
        title: 分享事件二
        type: standard
        desc: 分享行程的第二天事件
todo:
  - text: 分享待辦項目
`;

test("分享連結匯入：接受後成為新行程，原行程保留可切回", async ({ page }) => {
    await seedItinerary(page);
    const token = await encodeShareToken(SHARED_YAML);

    // confirm() 在 goto 期間觸發；Playwright 預設會自動取消，須先掛 handler。
    // 訊息先存起來、離開 handler 後再斷言，避免 handler 內拋錯變成 unhandled rejection。
    let dialogMessage = "";
    page.on("dialog", dialog => {
        dialogMessage = dialog.message();
        void dialog.accept();
    });

    await page.goto(`/#s=${token}`);

    await expect(page.getByRole("status")).toContainText("已匯入");
    expect(dialogMessage).toBe("偵測到分享的行程，要匯入為新行程嗎？（目前行程會保留，可隨時切回）");
    await expect(page.getByRole("heading", { level: 2, name: "分享行程" })).toBeVisible();
    // clearShareHash：匯入後網址不再帶 token，重新整理不會再跳提示
    expect(page.url()).not.toContain("#s=");

    // 原行程被停放為設定檔（非破壞性匯入）：切換器裡看得到、可切回
    await page.getByRole("button", { name: /目前行程/ }).click();
    await expect(page.getByRole("button", { name: "測試行程 切換" })).toBeVisible();
});

test("分享連結匯入：取消後維持原行程，網址 token 仍被清除", async ({ page }) => {
    await seedItinerary(page);
    const token = await encodeShareToken(SHARED_YAML);

    page.on("dialog", dialog => void dialog.dismiss());
    await page.goto(`/#s=${token}`);

    await expect(page.getByRole("heading", { level: 2, name: "測試行程" })).toBeVisible();
    expect(page.url()).not.toContain("#s=");
});

test("無效的分享 token：提示內容無效並照常載入原行程", async ({ page }) => {
    await seedItinerary(page);

    // token 須通過 parseShareToken 的 base64url 字元檢查（否則被靜默忽略、
    // 不會有 toast），但解壓失敗 → 走「內容無效」錯誤路徑。
    await page.goto("/#s=not-a-valid-token");

    await expect(page.getByRole("status")).toContainText("分享連結內容無效");
    await expect(page.getByRole("heading", { level: 2, name: "測試行程" })).toBeVisible();
    expect(page.url()).not.toContain("#s=");
});

test("分享行程按鈕：複製的連結可在新頁面匯入（round-trip）", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await seedItinerary(page);
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 2, name: "測試行程" })).toBeVisible();

    // headless Chromium 沒有 navigator.share → 走剪貼簿 fallback 並跳 toast
    await page.getByRole("button", { name: "分享行程" }).click();
    await expect(page.getByRole("status")).toContainText("分享連結已複製");

    const sharedUrl = await page.evaluate(() => navigator.clipboard.readText());
    expect(sharedUrl).toContain("#s=");

    // 同一個 context 的新分頁共用 localStorage（已有現有行程）→ 匯入為新行程
    const receiver = await context.newPage();
    receiver.on("dialog", dialog => void dialog.accept());
    await receiver.goto(sharedUrl);

    await expect(receiver.getByRole("status")).toContainText("已匯入");
    await expect(receiver.getByRole("heading", { level: 2, name: "測試行程" })).toBeVisible();
});
