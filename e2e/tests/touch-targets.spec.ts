import type { Page } from "@playwright/test";
import {
    expect,
    FIXTURE_YAML,
    seedItinerary,
    test,
} from "./fixtures";

test.use({ viewport: { width: 390, height: 844 } });

// Every tap target is at least 44px on its shorter side: the app is used one-handed on a
// phone while travelling. Size is layout, which happy-dom does not compute (every rect
// there is zero), so only a real browser can check it.
//
// Each screen is measured and every offender is reported together, so one failure lists
// the whole set rather than the first. A screen that measures fewer than a handful of
// controls fails too: a selector that stopped matching, or a screen that never opened,
// would otherwise pass by having nothing to check.

const MIN_SIDE = 44;
// A layout that lands on 43.6px is 44 to a thumb; subpixel rounding must not fail it.
const TOLERANCE = 0.5;

const HOTEL = [
    "  hotels:",
    "    - name: 測試飯店",
    "      address: 東京都新宿區西新宿 1-1-1",
    "      checkIn: '2099-01-01'",
    "      checkOut: '2099-01-02'",
    "      localName: テストホテル",
].join("\n");

/** Gemini's model list, so the AI tab renders its chat UI instead of the key-error panel. */
async function mockGemini(page: Page) {
    await page.route(url => url.origin === "https://generativelanguage.googleapis.com", route => {
        const cors = { "access-control-allow-origin": "*" };
        // The key travels in x-goog-api-key, which makes the browser preflight the request.
        if (route.request().method() === "OPTIONS") {
            return route.fulfill({
                status: 204,
                headers: { ...cors, "access-control-allow-methods": "GET, POST, OPTIONS", "access-control-allow-headers": "x-goog-api-key,content-type" },
            });
        }
        return route.fulfill({
            status: 200,
            contentType: "application/json",
            headers: cors,
            body: JSON.stringify({ models: [{ name: "models/gemini-2.5-flash", displayName: "Gemini 2.5 Flash", supportedGenerationMethods: ["generateContent"] }] }),
        });
    });
}

/** The visible tap targets on screen, and those whose shorter side falls under `min`. */
function measureTargets(page: Page, min: number): Promise<{ checked: number; small: string[]; }> {
    return page.evaluate(limit => {
        const selector = "button, a[href], [role=button], [role=tab], [role=radio], [role=checkbox], summary, input:not([type=hidden]), select, textarea, label";
        const seen = new Set<Element>();
        const small: string[] = [];
        let checked = 0;
        for (const el of document.querySelectorAll(selector)) {
            const style = getComputedStyle(el);
            if (style.visibility === "hidden" || style.display === "none" || style.pointerEvents === "none") continue;
            // A link inside a sentence is sized by its text; one that is its own block is a target.
            if (el instanceof HTMLAnchorElement && style.display === "inline") continue;
            if (el instanceof HTMLLabelElement && !el.querySelector("input, select, textarea")) continue;
            // A checkbox is tapped through the label around it, so the label is what is measured.
            const target = el.matches("input[type=checkbox], input[type=radio]") ? el.closest("label") ?? el : el;
            if (seen.has(target)) continue;
            seen.add(target);
            const { width, height } = target.getBoundingClientRect();
            if (width === 0 || height === 0) continue;
            checked++;
            if (Math.min(width, height) < limit) {
                const name = target.getAttribute("aria-label") ?? target.getAttribute("placeholder") ?? target.textContent ?? "";
                small.push(`${target.tagName.toLowerCase()} "${name.trim().replace(/\s+/g, " ").slice(0, 24)}" ${Math.round(width)}×${Math.round(height)}`);
            }
        }
        return { checked, small };
    }, min);
}

test("每個畫面的可點控制項，短邊都不少於 44px", async ({ page }) => {
    const yaml = FIXTURE_YAML.replace("  hotels: []", HOTEL);
    expect(yaml).not.toBe(FIXTURE_YAML);
    await seedItinerary(page, yaml);
    await page.addInitScript(() => window.localStorage.setItem("showmeway_gemini_api_key", "not-a-real-key"));
    await mockGemini(page);
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 2, name: "測試行程" })).toBeVisible();

    const offenders: string[] = [];
    const scan = async (screen: string) => {
        const { checked, small } = await measureTargets(page, MIN_SIDE - TOLERANCE);
        expect(checked, `${screen} 量到的控制項數量`).toBeGreaterThanOrEqual(3);
        offenders.push(...small.map(item => `${screen}：${item}`));
    };
    const navTab = (name: string) => page.locator("nav").getByRole("button", { name, exact: true });

    await scan("行程總覽");
    await page.getByRole("button", { name: "切換行程選單" }).click();
    await expect(page.getByRole("button", { name: "新增行程" })).toBeVisible();
    await scan("行程總覽（切換器展開）");

    await page.locator("button[data-day]").first().click();
    await expect(page.getByRole("heading", { name: "測試區域一" })).toBeVisible();
    await scan("單日行程");

    await navTab("工具").click();
    await expect(page.getByRole("heading", { name: "行前準備與打包" })).toBeVisible();
    await scan("工具／準備");

    await page.getByRole("button", { name: "行程管理", exact: true }).click();
    await expect(page.getByRole("heading", { name: "行程管理" })).toBeVisible();
    await scan("工具／行程管理");

    await page.getByRole("button", { name: "App 設定", exact: true }).click();
    await expect(page.getByRole("heading", { level: 3, name: "外觀" })).toBeVisible();
    await scan("工具／App 設定");

    await navTab("AI").click();
    await expect(page.getByLabel("輸入問題")).toBeVisible();
    await scan("AI");

    expect(offenders, `以下控制項的短邊不到 ${MIN_SIDE}px`).toEqual([]);
});
