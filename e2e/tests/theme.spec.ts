import {
    expect,
    seedItinerary,
    test,
} from "./fixtures";

// Light/dark theme mechanism. `data-theme` on <html> is the single switch: the
// inline boot script in index.html sets it before first paint, and app.css
// overrides the design tokens under `:root[data-theme="light"]`. That boot
// script deliberately duplicates readThemePref/resolveTheme from
// src/lib/theme.svelte.ts (a module script would run too late and flash), so
// these tests exist mainly to keep the two copies agreeing.

const THEME_KEY = "showmeway_theme";

// Must match --color-accent per theme in src/app.css.
const DARK_ACCENT = "#4cc2f7";
const LIGHT_ACCENT = "#9a3412";

// The callback runs in the browser, so THEME_KEY has to be passed in as an
// argument — closing over the module constant would throw a ReferenceError
// there, silently leaving the preference unset.
async function seedTheme(page: import("@playwright/test").Page, pref: string): Promise<void> {
    await page.addInitScript(([key, value]) => window.localStorage.setItem(key, value), [THEME_KEY, pref] as const);
}

function accent(page: import("@playwright/test").Page): Promise<string> {
    return page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--color-accent").trim());
}

test("明確選淺色：即使系統偏好深色也翻轉 data-theme、accent 與 theme-color", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await seedItinerary(page);
    await seedTheme(page, "light");
    await page.goto("/");

    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    expect(await accent(page)).toBe(LIGHT_ACCENT);

    // Two metas exist: index.html's plus the one vite-plugin-pwa injects from
    // manifest.theme_color. Both must end up on the light value, and that value
    // is read out of --color-bg-main rather than duplicated in JS — so assert
    // they agree with the stylesheet instead of hardcoding the color here.
    const bgMain = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--color-bg-main").trim());
    const contents = await page.locator('meta[name="theme-color"]').evaluateAll(
        metas => metas.map(m => m.getAttribute("content")),
    );
    expect(contents.length).toBeGreaterThan(1);
    expect(new Set(contents)).toEqual(new Set([bgMain]));
    // Sanity-check that the light page really is the paper tone, not the dark one.
    expect(bgMain).not.toBe("#0f172a");
});

test("明確選深色：即使系統偏好淺色也維持深色", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await seedItinerary(page);
    await seedTheme(page, "dark");
    await page.goto("/");

    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    expect(await accent(page)).toBe(DARK_ACCENT);
});

test("跟隨系統：依 prefers-color-scheme 決定，且切換時即時反應", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await seedItinerary(page);
    await seedTheme(page, "system");
    await page.goto("/");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

    // initTheme() keeps a matchMedia listener while the preference is `system`,
    // so this needs no reload.
    await page.emulateMedia({ colorScheme: "light" });
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    expect(await accent(page)).toBe(LIGHT_ACCENT);
});

test("未設定偏好時預設為跟隨系統，且不寫入 localStorage", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await seedItinerary(page);
    await page.goto("/");

    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    // Nothing is persisted until the user actually picks a theme.
    expect(await page.evaluate(key => localStorage.getItem(key), THEME_KEY)).toBeNull();
});

// Three of these were below AA when the light palette was first written (accent
// on its own chip fill, muted on the page, and 預訂), so this is a guard, not a
// formality — every color here carries information rather than decoration.
test("兩個主題的資訊性文字都要通過 WCAG AA", async ({ page }) => {
    await seedItinerary(page);

    for (const pref of ["dark", "light"] as const) {
        await seedTheme(page, pref);
        await page.goto("/");

        const failures = await page.evaluate(() => {
            const cs = getComputedStyle(document.documentElement);
            const rgba = (v: string): number[] => {
                const hex = v.match(/^#([0-9a-f]{3,8})$/i)?.[1];
                if (!hex) return (v.match(/[\d.]+/g) ?? []).map(Number);
                const w = hex.length <= 4 ? [...hex].map(c => c + c).join("") : hex;
                const b = [0, 2, 4, 6].map(i => parseInt(w.slice(i, i + 2) || "ff", 16));
                return [b[0], b[1], b[2], (isNaN(b[3]) ? 255 : b[3]) / 255];
            };
            const tok = (n: string) => rgba(cs.getPropertyValue(n).trim());
            const over = (f: number[], b: number[]) => [0, 1, 2].map(i => f[i] * (f[3] ?? 1) + b[i] * (1 - (f[3] ?? 1)));
            const lum = (c: number[]) => {
                const f = (v: number) => (v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
                return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
            };
            const ratio = (a: number[], b: number[]) => {
                const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
                return (hi + 0.05) / (lo + 0.05);
            };

            const card = over(tok("--color-card-bg"), [255, 255, 255]);
            const pageBg = over(tok("--color-bg-main"), [255, 255, 255]);
            const accent = tok("--color-accent");
            // The `bg-accent/15` action chips put accent text on its own tint.
            const accentChip = over([accent[0], accent[1], accent[2], 0.15], card);

            const cases: [string, number[], number[]][] = [
                ["text-primary/card", tok("--color-text-primary"), card],
                ["text-secondary/card", tok("--color-text-secondary"), card],
                ["text-muted/card", tok("--color-text-muted"), card],
                ["text-muted/page", tok("--color-text-muted"), pageBg],
                ["accent/card", accent, card],
                ["accent/accent-chip", accent, accentChip],
                ["accent-contrast/accent", tok("--color-accent-contrast"), over(accent, card)],
                ["booked/card", tok("--color-booked"), card],
                ["must/card", tok("--color-must"), card],
                ["option/card", tok("--color-option"), card],
                ["positive/card", tok("--color-positive"), card],
            ];
            return cases
                .map(([label, fg, bg]) => [label, ratio(over(fg, bg), bg)] as const)
                .filter(([, r]) => r < 4.5)
                .map(([label, r]) => `${label} = ${r.toFixed(2)}:1`);
        });

        expect(failures, `${pref} 主題有文字對比低於 AA 4.5:1`).toEqual([]);
    }
});

test("放大卡的全黑遮罩不隨主題改變（給司機看的最高對比）", async ({ page }) => {
    await seedItinerary(page);
    await seedTheme(page, "light");
    await page.goto("/");

    const scrim = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--color-scrim").trim());
    expect(scrim).toBe("#000000f2");
});
