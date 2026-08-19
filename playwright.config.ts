import {
    defineConfig,
    devices,
} from "@playwright/test";

// E2E smoke against the BUILT app: `vite build` then `vite preview` serves dist/
// on the fixed preview port 8046 (vite.config.ts, strictPort). Tests are hermetic:
// fixtures.ts blocks all external hosts and (locally) the personal
// itinerary.local.yaml, and service workers are disabled so page.route()
// interception always sees every request (the PWA service worker would otherwise
// answer YAML fetches from its own cache, bypassing route handlers).
const BASE_URL = "http://localhost:8046";

export default defineConfig({
    testDir: "./e2e/tests",
    outputDir: "./e2e/test-results",
    fullyParallel: true,
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 2 : 0,
    workers: process.env.CI ? 1 : undefined,
    reporter: [["html", { outputFolder: "./e2e/playwright-report", open: "never" }], ["list"]],
    use: {
        baseURL: BASE_URL,
        trace: "on-first-retry",
        serviceWorkers: "block",
        // 日期邏輯以本地時間解析（CLAUDE.md）；固定時區讓 CI（UTC)與本機一致。
        timezoneId: "Asia/Taipei",
        // TabPager 會把選中的 chip smooth-scroll 進視野（尊重 prefers-reduced-motion）；
        // 關閉動畫讓定位立即完成——smoke/today 兩支測試對 scrollLeft 與 chip 位置的
        // 斷言就是靠這個才不會 race，別移除。
        contextOptions: { reducedMotion: "reduce" },
    },
    projects: [
        // The app is designed for phones; test at a mobile viewport.
        { name: "mobile-chromium", use: { ...devices["Pixel 7"] } },
    ],
    webServer: {
        // Builds by default so `pnpm run test:e2e` is self-contained. `check` sets
        // E2E_SKIP_BUILD because it runs `build` on the line immediately before —
        // that adjacency is the ONLY thing making a stale dist/ impossible, so do
        // not set the flag anywhere the build is not guaranteed to have just run.
        command: process.env.E2E_SKIP_BUILD
            ? "pnpm exec vite preview"
            : "pnpm exec vite build && pnpm exec vite preview",
        url: BASE_URL,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
    },
});
