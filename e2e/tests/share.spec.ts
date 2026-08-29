import type {
    BrowserContext,
    Page,
} from "@playwright/test";
import { encodeShareToken } from "../../src/lib/share";
import {
    expect,
    FIXTURE_YAML,
    seedItinerary,
    test,
} from "./fixtures";

// Share-link flows (src/lib/share.ts + maybeImportSharedItinerary in App.svelte):
// a `#s=<token>` hash carries a whole compressed itinerary. An unrecognised trip is
// imported non-destructively — the current trip is parked as a profile, never
// overwritten — while a link carrying a trip this device already holds (same trip.id)
// offers to replace that copy first, and a copy only behind that. The hash is always
// stripped afterwards so a refresh never re-prompts.
// Tokens are built in Node with the app's own encodeShareToken (share.ts is
// pure; CompressionStream/btoa exist in Node 18+).

// Derived from FIXTURE_YAML with distinct names/dates, so assertions can tell
// the imported trip from the seeded one. The id has to differ too: this stands for
// someone else's trip, and sharing the seed's id would land on the replace-mine flow
// these tests are not about.
const SHARED_YAML = FIXTURE_YAML
    .replace("id: t-fixture", "id: t-shared")
    .replace("name: 測試行程", "name: 分享行程")
    .replaceAll("2099-01-01", "2099-02-01")
    .replaceAll("2099-01-02", "2099-02-02")
    .replace("測試區域一", "分享區域一")
    .replace("測試區域二", "分享區域二")
    .replace("測試事件一", "分享事件一")
    .replace("測試事件二", "分享事件二")
    .replace("第一天的測試事件", "分享行程的第一天事件")
    .replace("第二天的測試事件", "分享行程的第二天事件")
    .replace("測試待辦項目", "分享待辦項目");

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

    // 原行程被停放為設定檔（非破壞性匯入）：切換器（行程管理頁）裡看得到、可切回
    await page.locator("nav").getByRole("button", { name: "工具", exact: true }).click();
    await page.getByRole("button", { name: "行程管理", exact: true }).click();
    await page.getByRole("button", { name: /目前行程/ }).click();
    await expect(page.getByRole("button", { name: /測試行程.*切換/ })).toBeVisible();
});

test("分享連結匯入：無原行程時直接匯入無彈窗", async ({ page }) => {
    const token = await encodeShareToken(SHARED_YAML);

    let dialogTriggered = false;
    page.on("dialog", () => {
        dialogTriggered = true;
    });

    await page.goto(`/#s=${token}`);

    await expect(page.getByRole("status")).toContainText("已匯入");
    expect(dialogTriggered).toBe(false);
    await expect(page.getByRole("heading", { level: 2, name: "分享行程" })).toBeVisible();
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

/** 每個本機行程的 trip.id：active 一個，加上停放中的每一個。 */
async function localTripIds(page: Page): Promise<{ active: string | null; parked: (string | null)[]; }> {
    return page.evaluate(() => {
        const idOf = (yaml: string | null) => yaml?.match(/^\s+id:\s*(\S+)/m)?.[1] ?? null;
        const parked = JSON.parse(localStorage.getItem("showmeway_profiles") ?? "[]") as { yaml: string; }[];
        return { active: idOf(localStorage.getItem("showmeway_user_yaml")), parked: parked.map(p => idOf(p.yaml)) };
    });
}

/**
 * 分享自己的行程，回傳連結。收件端刻意用同一個 context 的新分頁，所以共用 localStorage ——
 * 那正是「連結帶進來的行程本機已經有」的情境。
 */
async function shareOwnTrip(page: Page, context: BrowserContext): Promise<string> {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await seedItinerary(page);
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 2, name: "測試行程" })).toBeVisible();

    // 分享行程按鈕在總覽 hero 卡（與每日的分享今日行程對稱）。
    // headless Chromium 沒有 navigator.share → 走剪貼簿 fallback 並跳 toast
    await page.getByRole("button", { name: "分享行程", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("分享連結已複製");

    const sharedUrl = await page.evaluate(() => navigator.clipboard.readText());
    expect(sharedUrl).toContain("#s=");
    return sharedUrl;
}

/** 依序回答對話框：true 按確定、false 按取消。用完之後多出來的一律取消。 */
function answerDialogs(page: Page, answers: boolean[]): { asked: () => number; } {
    let asked = 0;
    page.on("dialog", dialog => void (answers[asked++] ? dialog.accept() : dialog.dismiss()));
    return { asked: () => asked };
}

test("分享行程按鈕：連結帶回同一趟行程時，第一個選項是覆蓋原本那份", async ({ page, context }) => {
    const sharedUrl = await shareOwnTrip(page, context);
    const before = await localTripIds(page);

    const receiver = await context.newPage();
    answerDialogs(receiver, [true]);
    await receiver.goto(sharedUrl);

    await expect(receiver.getByRole("status")).toContainText("已用分享連結更新行程");
    await expect(receiver.getByRole("heading", { level: 2, name: "測試行程" })).toBeVisible();

    // 同一趟就是同一趟：沒有多出第二份，身分也沒換 —— 換掉的話雲端那個檔案就認不得它了。
    const after = await localTripIds(receiver);
    expect(after.parked).toHaveLength(0);
    expect(after.active).toBe(before.active);
    // 覆蓋前先進了備份環，所以行程管理還原得回來。
    const backups = await receiver.evaluate(() => JSON.parse(localStorage.getItem("showmeway_yaml_backups") ?? "[]").length as number);
    expect(backups).toBeGreaterThan(0);
});

test("分享行程按鈕：拒絕覆蓋後可以改成另存副本，副本會拿到自己的 trip.id", async ({ page, context }) => {
    const sharedUrl = await shareOwnTrip(page, context);
    const before = await localTripIds(page);

    const receiver = await context.newPage();
    // 第一問（覆蓋）取消、第二問（副本）確定。
    const dialogs = answerDialogs(receiver, [false, true]);
    await receiver.goto(sharedUrl);

    await expect(receiver.getByRole("status")).toContainText("已匯入");
    expect(dialogs.asked()).toBe(2);

    // 兩份共用同一個 trip.id 會讓它們搶同一個雲端檔案，所以副本一定要換身分。
    const after = await localTripIds(receiver);
    expect(after.parked).toEqual([before.active]);
    expect(after.active).toBeTruthy();
    expect(after.active).not.toBe(before.active);
});

test("分享行程按鈕：兩問都拒絕時什麼都不動，網址 token 仍被清除", async ({ page, context }) => {
    const sharedUrl = await shareOwnTrip(page, context);
    const before = await localTripIds(page);

    const receiver = await context.newPage();
    const dialogs = answerDialogs(receiver, [false, false]);
    await receiver.goto(sharedUrl);

    await expect(receiver.getByRole("heading", { level: 2, name: "測試行程" })).toBeVisible();
    expect(dialogs.asked()).toBe(2);
    expect(await localTripIds(receiver)).toEqual(before);
    expect(receiver.url()).not.toContain("#s=");
});
