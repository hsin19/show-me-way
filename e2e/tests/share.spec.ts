import type { Page } from "@playwright/test";
import {
    captureClipboard,
    expect,
    readCopiedText,
    seedItinerary,
    test,
} from "./fixtures";

// The one share flow kept in a real browser, as an engine check: the share flows run
// in-process in src/app-tests/share.test.ts on Node's CompressionStream and
// SubtleCrypto, and this is where the app's own seal (deflate-raw + AES-GCM) and unseal
// run on WebKit — the engine the installed PWA uses — and on Chromium, through hop's
// CORS preflight, which a fetch stub never makes.

type HopStore = { uploaded: string; };

/**
 * POST 把 body 存起來、GET 再吐回去 —— 這樣就得到一次真的往返，跑的是 app 自己那份
 * 加解密，完全不需要伺服器。page 層級的 route 優先於 fixtures.ts 在 context 層級的 abort。
 */
async function mockHop(page: Page, store: HopStore) {
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
        // 帶 Authorization 或 JSON 的請求瀏覽器會先發 preflight；真正的 hop 由 hono/cors 回這些。
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
        return json({ id: "abcd1234", kind: "blob", payload: store.uploaded });
    });
}

test("短連結匯入：收件端解密後正常匯入，網址片段被清除", async ({ page, context }) => {
    const hop: HopStore = { uploaded: "" };
    await captureClipboard(page);
    await mockHop(page, hop);
    await seedItinerary(page);
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 2, name: "測試行程" })).toBeVisible();

    await page.getByRole("button", { name: "分享行程", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("已加密上傳");
    const sharedUrl = await readCopiedText(page);
    expect(sharedUrl).toContain("#h=");
    // 離開裝置的是密文，不是行程內容。
    expect(hop.uploaded).not.toContain("測試行程");

    // 讓本機那份和連結裡的不一樣，收件端才不會認出「已經是同一版」而略過；改的是總覽上看得到
    // 的第一天標題，畫面才分得出落地的是哪一份。兩個分頁共用同一個 localStorage。
    await page.evaluate(() => {
        const yaml = localStorage.getItem("showmeway_user_yaml")!;
        localStorage.setItem("showmeway_user_yaml", yaml.replace("title: 測試區域一", "title: 舊版區域一"));
    });

    // 同一個 context 的新分頁：本機已經有這趟行程，第一問是覆蓋原本那份。
    const receiver = await context.newPage();
    await mockHop(receiver, hop);
    receiver.on("dialog", dialog => void dialog.accept());
    await receiver.goto(sharedUrl);

    await expect(receiver.getByRole("status")).toContainText("已用分享連結更新行程");
    await expect(receiver.getByText("測試區域一").first()).toBeVisible();
    await expect(receiver.getByText("舊版區域一")).toHaveCount(0);
    expect(receiver.url()).not.toContain("#h=");
});
