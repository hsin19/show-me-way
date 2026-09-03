import { encodeShareToken } from "$lib/domain/share";
import type {
    BrowserContext,
    Page,
} from "@playwright/test";
import {
    expect,
    FIXTURE_YAML,
    seedItinerary,
    test,
} from "./fixtures";

// Share-link flows (src/lib/domain/share.ts + maybeImportSharedItinerary in src/lib/stores/trip.svelte.ts):
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

    // token 須通過 parseShareLink 的 base64url 字元檢查（否則被靜默忽略、
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
 * 讓本機那份和連結裡的內容不一樣（改一個待辦文字），否則收件端會認出「已經是同一版」而直接略過，
 * 覆蓋／副本的分支就跑不到。在 sender 頁改就行：兩個分頁共用同一個 localStorage。
 */
async function ageLocalCopy(page: Page): Promise<void> {
    await page.evaluate(() => {
        const yaml = localStorage.getItem("showmeway_user_yaml")!;
        localStorage.setItem("showmeway_user_yaml", yaml.replace("測試待辦項目", "舊版待辦項目"));
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
    await ageLocalCopy(page);
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
    await ageLocalCopy(page);
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
    await ageLocalCopy(page);
    const before = await localTripIds(page);

    const receiver = await context.newPage();
    const dialogs = answerDialogs(receiver, [false, false]);
    await receiver.goto(sharedUrl);

    await expect(receiver.getByRole("heading", { level: 2, name: "測試行程" })).toBeVisible();
    expect(dialogs.asked()).toBe(2);
    expect(await localTripIds(receiver)).toEqual(before);
    expect(receiver.url()).not.toContain("#s=");
});

// 持久性連結會被重開來「看看有沒有更新」，沒更新才是常態；這時跳覆蓋確認只會教人按取消。
test("分享行程按鈕：連結裡的版本和本機一樣時不問也不寫，直接提示已是最新", async ({ page, context }) => {
    const sharedUrl = await shareOwnTrip(page, context);
    const before = await localTripIds(page);
    const backupsBefore = await page.evaluate(() => JSON.parse(localStorage.getItem("showmeway_yaml_backups") ?? "[]").length as number);

    const receiver = await context.newPage();
    const dialogs = answerDialogs(receiver, [true, true]);
    await receiver.goto(sharedUrl);

    await expect(receiver.getByRole("status")).toContainText("已經是連結裡的版本");
    expect(dialogs.asked()).toBe(0);
    expect(await localTripIds(receiver)).toEqual(before);
    const backupsAfter = await receiver.evaluate(() => JSON.parse(localStorage.getItem("showmeway_yaml_backups") ?? "[]").length as number);
    expect(backupsAfter).toBe(backupsBefore);
    expect(receiver.url()).not.toContain("#s=");
});

// 上面每一個測試走的都是 inline fallback：fixtures.ts 擋掉所有非 localhost 請求，
// 所以 hop 連不上、buildBestShareUrl 退回 #s=。以下的短連結（#h=<id>.<key>）測試
// 改成在 test 內用 page.route 掛上 hop 的假伺服器（page 層級優先於 context 層級的 abort）。

type HopStore = { uploaded: string; puts: { auth: string | null; url: string; }[]; };

/**
 * POST 把 body 存起來、GET 再吐回去 —— 這樣就得到一次真的往返，跑的是 app 自己那份
 * 加解密，完全不需要伺服器。PUT 同樣覆寫存起來的 body，並記下帶來的 bearer。
 */
async function mockHop(page: Page, store: HopStore, opts: { getFails?: boolean; corrupt?: boolean; } = {}) {
    await page.route(url => url.origin === "https://hop.hsin19.com", route => {
        const json = (body: unknown) =>
            route.fulfill({
                status: 200,
                contentType: "application/json",
                // fulfill 不會自己補 CORS，而這是跨來源請求。
                headers: { "access-control-allow-origin": "*" },
                body: JSON.stringify(body),
            });

        const method = route.request().method();
        // PUT 帶 Authorization，瀏覽器會先發 preflight；真正的 hop 由 hono/cors 回這些。
        if (method === "OPTIONS") {
            return route.fulfill({
                status: 204,
                headers: {
                    "access-control-allow-origin": "*",
                    "access-control-allow-methods": "GET, POST, PUT, DELETE, OPTIONS",
                    "access-control-allow-headers": "authorization,content-type",
                },
            });
        }
        if (method === "POST") {
            store.uploaded = route.request().postData() ?? "";
            return json({ id: "abcd1234", editToken: "edit-token", expiresAt: Date.now() + 365 * 86400_000 });
        }
        if (method === "PUT") {
            store.uploaded = route.request().postData() ?? "";
            store.puts.push({ auth: route.request().headers()["authorization"] ?? null, url: route.request().url() });
            return json({ id: "abcd1234", expiresAt: Date.now() + 365 * 86400_000 });
        }
        if (opts.getFails) return route.abort();
        if (opts.corrupt) return json({ payload: "AAAAAAAAAAAAAAAAAAAA" });
        return json({ id: "abcd1234", kind: "blob", payload: store.uploaded });
    });
}

async function shareOwnTripShort(page: Page, context: BrowserContext, store: HopStore): Promise<string> {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await mockHop(page, store);
    await seedItinerary(page);
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 2, name: "測試行程" })).toBeVisible();

    await page.getByRole("button", { name: "分享行程", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("已加密上傳");

    const sharedUrl = await page.evaluate(() => navigator.clipboard.readText());
    expect(sharedUrl).toContain("#h=");
    return sharedUrl;
}

test("短連結分享：上傳的是密文，連結短到可以做成 QR code", async ({ page, context }) => {
    const hop: HopStore = { uploaded: "", puts: [] };
    const sharedUrl = await shareOwnTripShort(page, context, hop);

    // 這一行就是整個功能的核心不變條件：離開裝置的是密文，不是行程內容。
    expect(hop.uploaded.length).toBeGreaterThan(0);
    expect(hop.uploaded).not.toContain("測試行程");
    expect(hop.uploaded).not.toContain("測試事件一");

    // 原本的 inline 連結是好幾千字元，做不成 QR code。正式站是
    // https://trip.hsin19.com/#h=<8 碼>.<22 碼> ≈ 58 字元。
    expect(sharedUrl.length).toBeLessThan(100);
});

// 持久性分享的核心：第二次分享不是再造一條連結，而是拿 editToken 覆寫同一個 id 的密文，
// 所以印出去的 QR code 不會過時。金鑰只在網址片段裡，PUT 的網址與 header 都不能帶到。
test("再次分享同一趟行程：更新同一條連結而不是換一條，收件端拿到新版本", async ({ page, context }) => {
    const hop: HopStore = { uploaded: "", puts: [] };
    const firstUrl = await shareOwnTripShort(page, context, hop);
    const firstUpload = hop.uploaded;

    // 改個名字再分享一次。
    await page.locator("nav").getByRole("button", { name: "工具", exact: true }).click();
    await page.getByRole("button", { name: "行程管理", exact: true }).click();
    // 行程管理頁看得到這條連結，並提供更新。
    await expect(page.getByText(/最後更新/)).toBeVisible();
    const editor = page.locator("#yaml-editor");
    await editor.fill((await editor.inputValue()).replace("name: 測試行程", "name: 測試行程二版"));
    await page.getByRole("button", { name: "儲存並解析" }).click();
    await expect(page.getByRole("heading", { level: 2, name: "測試行程二版" })).toBeVisible();

    await page.getByRole("button", { name: "分享行程", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("分享連結已更新");

    const secondUrl = await page.evaluate(() => navigator.clipboard.readText());
    expect(secondUrl).toBe(firstUrl);
    expect(hop.puts).toHaveLength(1);
    expect(hop.puts[0]!.auth).toBe("Bearer edit-token");
    expect(hop.uploaded).not.toBe(firstUpload);
    const key = firstUrl.split(".").pop()!;
    expect(hop.puts[0]!.url).not.toContain(key);
    expect(hop.uploaded).not.toContain("測試行程二版");

    // 同一條連結在另一個裝置打開，看到的是新版本。
    const receiver = await context.newPage();
    await mockHop(receiver, hop);
    answerDialogs(receiver, [true]);
    await receiver.goto(secondUrl);
    await expect(receiver.getByRole("heading", { level: 2, name: "測試行程二版" })).toBeVisible();
});

test("短連結匯入：收件端解密後正常匯入，網址片段被清除", async ({ page, context }) => {
    const hop: HopStore = { uploaded: "", puts: [] };
    const sharedUrl = await shareOwnTripShort(page, context, hop);
    await ageLocalCopy(page);

    const receiver = await context.newPage();
    await mockHop(receiver, hop);
    answerDialogs(receiver, [true]);
    await receiver.goto(sharedUrl);

    await expect(receiver.getByRole("status")).toContainText("已用分享連結更新行程");
    await expect(receiver.getByRole("heading", { level: 2, name: "測試行程" })).toBeVisible();
    expect(receiver.url()).not.toContain("#h=");
});

test("短連結匯入：取不到密文時保留網址片段 —— 金鑰只存在於那裡", async ({ page, context }) => {
    const hop: HopStore = { uploaded: "", puts: [] };
    const sharedUrl = await shareOwnTripShort(page, context, hop);

    const receiver = await context.newPage();
    await mockHop(receiver, hop, { getFails: true });
    await receiver.goto(sharedUrl);

    await expect(receiver.getByRole("status")).toContainText("請檢查網路");
    // 清掉就等於銷毀使用者剛掃進來的那把金鑰，重新整理也救不回來。
    expect(receiver.url()).toContain("#h=");
    await expect(receiver.getByRole("heading", { level: 2, name: "測試行程" })).toBeVisible();
});

test("短連結匯入：密文無法解密時提示內容無效並清除網址片段", async ({ page, context }) => {
    const hop: HopStore = { uploaded: "", puts: [] };
    const sharedUrl = await shareOwnTripShort(page, context, hop);

    const receiver = await context.newPage();
    await mockHop(receiver, hop, { corrupt: true });
    await receiver.goto(sharedUrl);

    await expect(receiver.getByRole("status")).toContainText("分享連結內容無效");
    // 重新整理不會讓它變得可解密，所以這條連結留著沒有意義。
    expect(receiver.url()).not.toContain("#h=");
});
