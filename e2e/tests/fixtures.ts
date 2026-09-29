import { FIXTURE_YAML } from "$lib/testing/fixture-trip";
import {
    expect,
    type Page,
    test as base,
} from "@playwright/test";

export { FIXTURE_YAML };

const BASE_ORIGIN = "http://localhost:8046";

// Every request leaving the app's own origin is aborted, so a test can never
// depend on (or leak to) Open-Meteo, jsDelivr, or Gemini. Same-origin asset
// and YAML requests pass through untouched.
//
// The install offer is pre-declined for the same reason: `pwa-install.svelte.ts`
// raises it on a 3.5s timer in EVERY browser, so any test that outlives that
// timer would get a toast over the bottom of the viewport — and its 安裝 / ✕
// buttons are `pointer-events-auto`, so they swallow taps aimed at the nav.
// Written unconditionally (unlike the itinerary seed): nothing in the app ever
// reads this key back expecting its own value.
export const test = base.extend({
    context: async ({ context }, use) => {
        await context.route(
            url => url.origin !== BASE_ORIGIN,
            route => route.abort(),
        );
        await context.addInitScript(key => {
            window.localStorage.setItem(key, String(Date.now()));
        }, "showmeway_pwa_install_dismissed");
        await use(context);
    },
});

export { expect };

// Must be called before page.goto(): the app reads the key during startup, and
// writing localStorage after load is ignored until a reload. The script re-runs
// on every navigation (including page.reload()), so it only seeds when the key
// is absent — otherwise it would wipe the YAML the app persisted mid-test and
// reload-persistence assertions could never pass.
export async function seedItinerary(page: Page, yaml: string = FIXTURE_YAML): Promise<void> {
    await page.addInitScript(([key, value]) => {
        if (!window.localStorage.getItem(key)) {
            window.localStorage.setItem(key, value);
        }
    }, ["showmeway_user_yaml", yaml] as const);
}

// 本機 dist/ 可能包含個人的 itinerary.local.yaml（gitignored）；強制 404 讓
// 回退鏈一定跳過它，行為與乾淨的 CI 環境一致（page.route 優先於 context 層的攔截）。
export async function stubMissingLocalItinerary(page: Page): Promise<void> {
    await page.route("**/itinerary.local.yaml", route => route.fulfill({ status: 404, body: "not found" }));
}

/**
 * Route every copy into a page-local buffer readable with `readCopiedText`. Replaces
 * `context.grantPermissions(["clipboard-read"])`, which WebKit does not support, and
 * removes `navigator.share` so both engines take the app's clipboard fallback — headless
 * Chromium has no share sheet, headless WebKit would otherwise open one nobody can answer.
 * Register before `page.goto`, like the other init scripts.
 */
export async function captureClipboard(page: Page): Promise<void> {
    await page.addInitScript(() => {
        const buffer = { text: "" };
        Object.defineProperty(window, "__copiedText", { get: () => buffer.text });
        Object.defineProperty(navigator, "clipboard", {
            configurable: true,
            value: {
                writeText: (text: string) => {
                    buffer.text = String(text);
                    return Promise.resolve();
                },
                readText: () => Promise.resolve(buffer.text),
            },
        });
        Object.defineProperty(navigator, "share", { configurable: true, value: undefined });
    });
}

/** The last text the app copied on this page; empty until it copies something. */
export function readCopiedText(page: Page): Promise<string> {
    return page.evaluate(() => (window as unknown as { __copiedText: string; }).__copiedText);
}
