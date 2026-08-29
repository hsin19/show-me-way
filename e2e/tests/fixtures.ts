import {
    expect,
    type Page,
    test as base,
} from "@playwright/test";

const BASE_ORIGIN = "http://localhost:8046";

// Minimal itinerary that passes normalizeTripData (src/lib/domain/trip.ts). Dates are
// far-future on purpose: no day ever equals "today", so the app always lands on
// the day-0 overview and never shows time-dependent UI (countdown badges,
// aria-current chips). No trip.city / trip.currency — that keeps the weather
// and exchange-rate fetch paths dormant, so tests stay hermetic. Dates and
// times stay quoted: js-yaml would otherwise parse them as UTC Date objects,
// but the app expects plain local-time strings. `trip.id` is load-bearing rather
// than decorative: without one the app mints and persists it on first load, and
// that rewrite makes every seeded sync record look locally dirty — which turns the
// Drive specs' carefully staged one-sided changes into conflicts.
export const FIXTURE_YAML = `trip:
  name: 測試行程
  id: t-fixture
  start: '2099-01-01'
  end: '2099-01-02'
  departure: '2099-01-01T08:00:00+08:00'
  hotels: []
days:
  - day: 1
    date: '2099-01-01'
    title: 測試區域一
    pace: 輕鬆漫遊
    timeline:
      - time: '09:00'
        title: 測試事件一
        type: standard
        desc: 第一天的測試事件
  - day: 2
    date: '2099-01-02'
    title: 測試區域二
    pace: 輕鬆漫遊
    timeline:
      - time: '10:00'
        title: 測試事件二
        type: standard
        desc: 第二天的測試事件
todo:
  - text: 測試待辦項目
`;

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
