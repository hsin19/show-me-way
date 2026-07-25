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
// builds its own trip around the current date instead.
//
// The opposite branch — a trip that is not currently running lands on the day-0
// overview — is already covered by smoke.spec.ts with the far-future fixture.
function build() {
    // Today per Asia/Taipei, matching playwright.config.ts's timezoneId, so the
    // fixture and the app agree on which day is today. The offsets are then
    // applied to that CALENDAR DATE through UTC, not to the local instant:
    // `setDate` preserves local wall-clock time, so on a runner whose own zone
    // observes DST a ±3-day span can shift by an hour and collapse two days onto
    // one Taipei date (reproducible with TZ=Europe/Berlin around spring-forward).
    // UTC has no DST, so N days is always exactly N days. The remaining flake
    // window is a run that crosses Taipei midnight between this `new Date()` and
    // the page load.
    const todayIso = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Taipei" });
    const [year, month, day] = todayIso.split("-").map(Number);
    const base = Date.UTC(year, month - 1, day);
    const dayOf = (offset: number) => new Date(base + offset * 86_400_000).toISOString().slice(0, 10);
    const days = [-3, -2, -1, 0, 1, 2, 3].map((off, i) =>
        `  - day: ${i + 1}\n    date: '${dayOf(off)}'\n    title: 區域${i + 1}\n    pace: 悠閒\n`
        + `    timeline:\n      - time: '00:30'\n        title: 第${i + 1}天事件\n        type: standard\n        desc: 說明\n`
    ).join("");
    return {
        todayIso,
        yaml: `trip:\n  name: 今天定位測試\n  start: '${dayOf(-3)}'\n  end: '${dayOf(3)}'\n`
            + `  departure: '${dayOf(-3)}T08:00:00+08:00'\n  hotels: []\ndays:\n${days}`,
    };
}

test("開啟時自動定位到今天：面板、今天標記與 chip 進入視野", async ({ page }) => {
    const { yaml, todayIso } = build();
    await stubMissingLocalItinerary(page);
    await seedItinerary(page, yaml);
    await page.goto("/");

    // Day 4 is today → lands on that panel, not the overview.
    await expect(page.getByRole("heading", { name: "區域4" })).toBeVisible();

    const state = await page.evaluate(() => {
        const marked = document.querySelector('button[data-day][aria-current="date"]');
        const scroller = document.querySelector("[data-pager-scroller]") as HTMLElement;
        const r = marked?.getBoundingClientRect();
        const sr = scroller.getBoundingClientRect();
        return {
            markedLabel: marked?.textContent?.replace(/\s+/g, " ").trim() ?? null,
            hasDot: !!marked?.querySelector(".bg-must"),
            srOnly: marked?.textContent?.includes("今天") ?? false,
            // Fully inside the scroller = it was scrolled into view.
            inView: !!r && r.left >= sr.left - 1 && r.right <= sr.right + 1,
        };
    });
    // The marked chip must be day 4 AND carry today's date, so a marker that
    // latched onto the wrong day cannot pass.
    expect(state.markedLabel).toContain("DAY 04");
    expect(state.markedLabel).toContain(todayIso.slice(5).replace("-", "/"));
    expect(state.hasDot).toBe(true);
    expect(state.srOnly).toBe(true);
    expect(state.inView).toBe(true);
});
