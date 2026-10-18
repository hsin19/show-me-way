import {
    expect,
    seedItinerary,
    stubMissingLocalItinerary,
    test,
} from "./fixtures";
test.use({ viewport: { width: 390, height: 844 } });

// syncToToday (App.svelte) jumps to today's day on load and again when the app
// returns to the foreground on a later date. FIXTURE_YAML deliberately uses 2099
// dates so nothing is ever "today" — which leaves this path uncovered, and a
// regression in it would only surface to a real traveler mid-trip. So this suite
// pins the page's clock inside a trip of its own instead.
//
// The opposite branch — a trip that is not currently running lands on the day-0
// overview — is covered by src/app-tests/smoke.test.ts with the far-future fixture.
//
// Neither test has an app-test counterpart: each ends on layout happy-dom does not
// compute (the chip scrolled into view; the event line ellipsed), and there every
// rect is zero, so those checks would pass without testing anything.

// Noon in Asia/Taipei, playwright.config.ts's timezoneId, on day 4 of the trip below —
// past its 00:30 event, so the today card has something in progress to show.
const NOW = new Date("2026-10-11T12:00:00+08:00");

function tripYaml(eventTitle?: string): string {
    const days = ["08", "09", "10", "11", "12", "13", "14"].map((dd, i) =>
        `  - date: '2026-10-${dd}'\n    title: 區域${i + 1}\n    timeline:\n`
        + `      - time: '00:30'\n        title: ${eventTitle ?? `第${i + 1}天事件`}\n`
    ).join("");
    return `trip:\n  name: 今天定位測試\n  hotels: []\ndays:\n${days}`;
}

test("開啟時自動定位到今天：面板、今天標記與 chip 進入視野", async ({ page }) => {
    await page.clock.install({ time: NOW });
    await stubMissingLocalItinerary(page);
    await seedItinerary(page, tripYaml());
    await page.goto("/");

    // Day 4 is today → lands on that panel, not the overview.
    await expect(page.getByRole("heading", { name: "區域4" })).toBeVisible();

    const state = await page.evaluate(() => {
        const marked = document.querySelector('button[data-day][aria-current="date"]');
        return {
            markedLabel: marked?.textContent?.replace(/\s+/g, " ").trim() ?? null,
            // Today's edge is its own border recolored, so it has to differ from both
            // a selected chip's (transparent) and an idle one's.
            edge: marked ? getComputedStyle(marked).borderColor : null,
            idleEdge: getComputedStyle(document.querySelector("button[data-day]:not([aria-current])")!).borderColor,
            srOnly: marked?.textContent?.includes("今天") ?? false,
        };
    });
    // The marked chip must be day 4 AND carry today's date, so a marker that
    // latched onto the wrong day cannot pass.
    expect(state.markedLabel).toContain("DAY 04");
    expect(state.markedLabel).toContain("10/11");
    expect(state.edge).not.toBe("rgba(0, 0, 0, 0)");
    expect(state.edge).not.toBe(state.idleEdge);
    expect(state.srOnly).toBe(true);

    // Fully inside the scroller = it was scrolled into view. Polled: the row's scroll is not
    // guaranteed to have landed the instant the heading shows (seen once on a loaded runner).
    await expect.poll(() =>
        page.evaluate(() => {
            const r = document.querySelector('button[data-day][aria-current="date"]')?.getBoundingClientRect();
            const sr = document.querySelector("[data-pager-scroller]")!.getBoundingClientRect();
            return !!r && r.left >= sr.left - 1 && r.right <= sr.right + 1;
        })
    ).toBe(true);
});

// Mid-trip the overview's today card carries the current/next event, whose title is
// arbitrarily long. It must ellipse on one line rather than wrap. Only reachable with
// a "today" inside the trip, hence this suite rather than the far-future smoke tests.
// The switcher shares the date's row, and at the iPhone width it must stay on it.
test("行程進行中：今天卡片截斷過長的事件標題，切換行程與日期同一行", async ({ page }) => {
    await page.clock.install({ time: NOW });
    await stubMissingLocalItinerary(page);
    await seedItinerary(page, tripYaml("聖母百花大教堂前往領主廣場沿途散步順道逛皮件小店與中央市場"));
    await page.goto("/");

    // Today's panel is the landing spot; the today card lives on the overview.
    await page.getByRole("button", { name: "總覽" }).click();
    const nextEvent = page.locator("[data-next-event]");
    await expect(nextEvent).toBeVisible();
    // Guard the premise: this only tests truncation if the line really is the long
    // event title (getNextEventInfo returning null would render no line at all).
    await expect(nextEvent).toContainText("聖母百花大教堂");

    const layout = await page.evaluate(() => {
        const line = document.querySelector("[data-next-event]") as HTMLElement;
        const switcher = document.querySelector('button[aria-label="切換行程選單"]') as HTMLElement;
        const date = switcher.parentElement!.querySelector("p") as HTMLElement;
        const panel = switcher.closest(".panel") as HTMLElement;
        const dateRect = date.getBoundingClientRect();
        const swRect = switcher.getBoundingClientRect();
        return {
            truncated: line.scrollWidth > line.clientWidth,
            singleLine: line.getBoundingClientRect().height < 24,
            // Vertical overlap, not equal tops: the pill is taller than the date line
            // and `items-center` centres them.
            sameRow: dateRect.bottom > swRect.top && swRect.bottom > dateRect.top,
            insidePanel: swRect.right <= panel.getBoundingClientRect().right,
        };
    });
    expect(layout.truncated).toBe(true);
    expect(layout.singleLine).toBe(true);
    expect(layout.sameRow).toBe(true);
    expect(layout.insidePanel).toBe(true);
});
