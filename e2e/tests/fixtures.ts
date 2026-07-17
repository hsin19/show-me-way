import {
    expect,
    type Page,
    test as base,
} from "@playwright/test";

export const BASE_ORIGIN = "http://localhost:8046";

// Minimal itinerary that passes normalizeTripData (src/lib/api.ts). Dates are
// far-future on purpose: no day ever equals "today", so the app always lands on
// the day-0 overview and never shows time-dependent UI (countdown badges,
// aria-current chips). No trip.city / trip.currency — that keeps the weather
// and exchange-rate fetch paths dormant, so tests stay hermetic. Dates and
// times stay quoted: js-yaml would otherwise parse them as UTC Date objects,
// but the app expects plain local-time strings.
export const FIXTURE_YAML = `trip:
  name: 測試行程
  start: '2099-01-01'
  end: '2099-01-02'
  departure: '2099-01-01T08:00:00+08:00'
  hotels: []
days:
  - day: 1
    date: '2099-01-01'
    region: 測試區域一
    pace: 輕鬆漫遊
    timeline:
      - time: '09:00'
        title: 測試事件一
        type: standard
        desc: 第一天的測試事件
  - day: 2
    date: '2099-01-02'
    region: 測試區域二
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
export const test = base.extend({
    context: async ({ context }, use) => {
        await context.route(
            url => url.origin !== BASE_ORIGIN,
            route => route.abort(),
        );
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
