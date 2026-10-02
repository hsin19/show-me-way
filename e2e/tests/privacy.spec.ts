import type { Page } from "@playwright/test";
import {
    expect,
    seedItinerary,
    test,
} from "./fixtures";

// The privacy page is rendered by vite.config.ts, not mounted by the App, so the in-process
// harness never sees it: what ships is the dist/privacy.html the build writes, and only
// the built app can show what that file carries and that the App reaches it.

const policyHeading = (page: Page) => page.getByRole("heading", { level: 1, name: /隱私權政策/ });

// A fetch that runs no script is what a link checker, a crawler or the review of Google's
// consent screen gets, and `request` makes exactly that one.
test("隱私權政策網址的原始 HTML 不靠腳本就帶著標題與本文", async ({ request }) => {
    const response = await request.get("/privacy");
    expect(response.ok()).toBe(true);
    const html = await response.text();

    expect(html).toContain("<title>隱私權政策 (Privacy Policy) - ShowMeWay</title>");
    // One anchor from each thing a reviewer looks for: the Limited Use statement, the
    // scopes it covers, and the disclosure of what leaves the device.
    expect(html).toContain("Limited Use requirements");
    expect(html).toContain("https://www.googleapis.com/auth/drive.file");
    expect(html).toContain("加密分享連結");
    // A static page: the App's bundle never loads here.
    expect(html).not.toContain('<script type="module"');
});

// The page keeps index.html's pre-paint script, so the theme picked in the App carries
// over although no app code runs there.
test("從 App 設定進到政策頁：沿用 App 選的主題，回到 App 回首頁", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await seedItinerary(page);
    await page.addInitScript(() => window.localStorage.setItem("showmeway_theme", "light"));
    await page.goto("/");
    await page.getByRole("navigation").getByRole("button", { name: "工具" }).click();
    await page.getByRole("button", { name: "App 設定" }).click();
    await page.getByRole("link", { name: "隱私權政策" }).click();

    await expect(policyHeading(page)).toBeVisible();
    expect(new URL(page.url()).pathname).toBe("/privacy");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");

    await page.getByRole("link", { name: "回到 App" }).click();
    await expect(page.getByRole("navigation")).toBeVisible();
    expect(new URL(page.url()).pathname).toBe("/");
});
