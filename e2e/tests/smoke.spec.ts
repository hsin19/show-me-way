import {
    expect,
    seedItinerary,
    test,
} from "./fixtures";

// The one smoke case that needs a real browser: that the 總覽 chip stays put while
// the day chips scroll is layout (scrollLeft and client rects), which happy-dom does
// not compute. The rest of the smoke suite — boot, fallback template, day switching,
// check-in and checklist persistence, the error screen — runs in-process in
// src/app-tests/smoke.test.ts.

// TabPager renders the 總覽 chip OUTSIDE the scroller (pinnedCount=1), so it
// cannot scroll away however long the trip is. Asserted structurally rather than
// by offset: the point is that it is not part of the scrolling content.
test("日程列：總覽 chip 不隨日期捲動離開", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    // Ten days so the strip overflows well past the sticky range.
    const days = Array.from({ length: 10 }, (_, i) => i + 1)
        .map(d =>
            `  - day: ${d}\n    date: '2099-01-${String(d).padStart(2, "0")}'\n`
            + `    title: 區域${d}\n    pace: 悠閒\n    timeline:\n`
            + `      - time: '09:00'\n        title: 第${d}天事件\n        type: standard\n        desc: 說明\n`
        )
        .join("");
    await seedItinerary(
        page,
        `trip:\n  name: 長行程\n  start: '2099-01-01'\n  end: '2099-01-10'\n`
            + `  departure: '2099-01-01T08:00:00+08:00'\n  hotels: []\ndays:\n${days}`,
    );
    await page.goto("/");

    await page.locator("button[data-day]").last().click();
    await expect(page.getByRole("heading", { name: "區域10" })).toBeVisible();

    const overview = page.getByRole("button", { name: "總覽" });
    await expect(overview).toBeVisible();

    const pinned = await page.evaluate(() => {
        const scroller = document.querySelector("[data-pager-scroller]") as HTMLElement;
        const chip = [...document.querySelectorAll("button")].find(b => b.textContent?.trim() === "總覽")!;
        return {
            scrolled: scroller.scrollLeft > 0,
            insideScroller: scroller.contains(chip),
            // Still left of the scrolling region, i.e. leading the row.
            leadsRow: chip.getBoundingClientRect().right <= scroller.getBoundingClientRect().left + 1,
        };
    });
    expect(pinned.scrolled).toBe(true);
    expect(pinned.insideScroller).toBe(false);
    expect(pinned.leadsRow).toBe(true);
});
