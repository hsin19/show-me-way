import { screen } from "@testing-library/dom";
import {
    expect,
    test,
} from "vitest";
import {
    type AppPage,
    createPage,
    launchApp,
    navTab,
} from "./harness";

// 隱私權政策（PrivacyPolicy.svelte）是 App 裡唯一有自己網址的頁面：/privacy。Google 的
// OAuth 同意畫面連到這個網址，所以直接開它要馬上看到本文 —— 不等行程載入、不落在首頁，
// 也沒有底部的分頁列。從 App 設定點進去時網址會換成 /privacy，「回到 App」和瀏覽器的
// 上一頁都要回到原本的畫面。

const policy = () => screen.findByRole("heading", { level: 1, name: /隱私權政策/ });
const pathname = (page: AppPage) => new URL(page.url()).pathname;

async function openFromAppSettings(page: AppPage): Promise<void> {
    await page.user.click(navTab("工具"));
    await page.user.click(screen.getByRole("button", { name: "App 設定" }));
    await page.user.click(await screen.findByRole("link", { name: "隱私權政策" }));
    await policy();
}

test("直接開 /privacy：看得到本文，沒有底部導覽，分頁標題是政策名稱", async () => {
    const page = createPage();
    await page.goto("/privacy");

    await policy();
    expect(screen.queryByRole("navigation")).toBeNull();
    expect(document.title).toBe("隱私權政策 (Privacy Policy) - ShowMeWay");
});

test("從 App 設定點進去：網址換成 /privacy，回到 App 後仍停在 App 設定", async () => {
    const page = await launchApp();
    await openFromAppSettings(page);
    expect(pathname(page)).toBe("/privacy");

    await page.user.click(screen.getByRole("link", { name: "回到 App" }));

    await screen.findByRole("heading", { level: 2, name: "App 設定" });
    expect(pathname(page)).toBe("/");
    expect(screen.queryByRole("heading", { name: /隱私權政策/ })).toBeNull();
    expect(screen.getByRole("navigation")).toBeTruthy();
});

test("從 App 設定點進去後按瀏覽器的上一頁，也回到 App 設定", async () => {
    const page = await launchApp();
    await openFromAppSettings(page);

    window.history.back();

    await screen.findByRole("heading", { level: 2, name: "App 設定" });
    expect(pathname(page)).toBe("/");
});

// build 也會寫一份 privacy.html；沒有把它轉址到 /privacy 的主機會直接在這個網址提供它。
test("直接開 /privacy.html 也是政策頁", async () => {
    const page = createPage();
    await page.goto("/privacy.html");

    await policy();
    expect(screen.queryByRole("navigation")).toBeNull();
});

// 直接開網址時沒有「上一頁」可回（來源可能是 Google 的審核頁），回到 App 就是進首頁。
test("直接開 /privacy 再按回到 App：進到 App 首頁", async () => {
    const page = createPage();
    await page.goto("/privacy");

    await page.user.click(await screen.findByRole("link", { name: "回到 App" }));

    await screen.findByRole("heading", { level: 2, name: "測試行程" });
    expect(pathname(page)).toBe("/");
});
