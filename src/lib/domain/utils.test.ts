import {
    afterEach,
    describe,
    expect,
    it,
    vi,
} from "vitest";
import {
    addDaysIso,
    compareTripDates,
    daysBetweenIso,
    formatBackupTime,
    formatDateRange,
    formatDayDate,
    formatYearMonth,
    getTodayIsoString,
    insertAtClamped,
    isCalendarDate,
    isTripLongPast,
    parseLocalDate,
    splitDayDate,
    toLocalIsoDate,
    toUtcIsoDate,
} from "./utils";

describe("parseLocalDate", () => {
    it("parses YYYY-MM-DD in local time (no UTC day-shift)", () => {
        const d = parseLocalDate("2026-06-11");
        expect(d.getFullYear()).toBe(2026);
        expect(d.getMonth()).toBe(5); // June (0-indexed)
        expect(d.getDate()).toBe(11);
        expect(d.getHours()).toBe(0);
    });

    it("falls back to native Date for full ISO datetime strings", () => {
        const d = parseLocalDate("2026-06-11T14:00:00+08:00");
        expect(isNaN(d.getTime())).toBe(false);
    });
});

describe("formatBackupTime", () => {
    it("formats ISO datetime into localized string", () => {
        const result = formatBackupTime("2026-06-11T14:30:00");
        expect(result).toMatch(/06\/11\(.+?\)\s+14:30/);
    });

    it("returns raw string on invalid date", () => {
        expect(formatBackupTime("invalid-date")).toBe("invalid-date");
    });
});

describe("parseLocalDate vs native UTC parsing", () => {
    afterEach(() => {
        vi.unstubAllEnvs();
    });

    it("keeps the calendar day west of UTC where native parsing shifts it", () => {
        vi.stubEnv("TZ", "America/New_York");
        // native parse reads YYYY-MM-DD as UTC midnight → previous local day
        expect(new Date("2026-06-11").getDate()).toBe(10);
        const d = parseLocalDate("2026-06-11");
        expect(d.getDate()).toBe(11);
        expect(d.getHours()).toBe(0);
        expect(toLocalIsoDate(d)).toBe("2026-06-11");
    });
});

describe("splitDayDate", () => {
    it("splits into the date and the weekday", () => {
        // 2026-06-11 is a Thursday
        expect(splitDayDate("2026-06-11")).toEqual({ mmdd: "06/11", weekday: "四" });
    });

    it("maps Sunday (weekday 0) to 日", () => {
        expect(splitDayDate("2026-06-14")).toEqual({ mmdd: "06/14", weekday: "日" });
    });

    it("keeps invalid input as the date with no weekday", () => {
        expect(splitDayDate("not-a-date")).toEqual({ mmdd: "not-a-date", weekday: "" });
    });

    it("reads the LOCAL calendar day, so no UTC day shift", () => {
        // Parsed as UTC midnight this is 2026-06-10 (Wednesday) west of UTC.
        expect(splitDayDate("2026-06-11").weekday).toBe("四");
    });
});

describe("formatDayDate", () => {
    it("formats to MM/DD(weekday) in Chinese", () => {
        // 2026-06-11 is a Thursday
        expect(formatDayDate("2026-06-11")).toBe("06/11(四)");
    });

    it("returns the raw string for invalid input", () => {
        expect(formatDayDate("not-a-date")).toBe("not-a-date");
    });

    it("maps Sunday (weekday 0) to 日", () => {
        // 2026-06-14 is a Sunday
        expect(formatDayDate("2026-06-14")).toBe("06/14(日)");
    });
});

describe("getTodayIsoString", () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    it("returns a YYYY-MM-DD string", () => {
        expect(getTodayIsoString()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it("uses the local calendar date even just before midnight", () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date(2026, 5, 11, 23, 59));
        expect(getTodayIsoString()).toBe("2026-06-11");
    });
});

describe("toLocalIsoDate", () => {
    it("formats the local calendar date with zero-padding", () => {
        expect(toLocalIsoDate(new Date(2026, 0, 5))).toBe("2026-01-05");
    });

    it("round-trips with parseLocalDate", () => {
        expect(toLocalIsoDate(parseLocalDate("2026-06-11"))).toBe("2026-06-11");
    });
});

describe("formatDateRange", () => {
    it("formats a start/end range", () => {
        expect(formatDateRange("2026-06-11", "2026-06-16")).toBe("2026.06.11 – 06.16");
    });

    it("falls back gracefully on invalid dates", () => {
        expect(formatDateRange("bad", "worse")).toBe("bad – worse");
    });
});

describe("toUtcIsoDate", () => {
    it("reads the UTC calendar day, which is what js-yaml gives a bare date", () => {
        expect(toUtcIsoDate(new Date("2026-06-11T00:00:00Z"))).toBe("2026-06-11");
    });

    it("pads single-digit months and days", () => {
        expect(toUtcIsoDate(new Date("2026-01-02T00:00:00Z"))).toBe("2026-01-02");
    });
});

describe("addDaysIso", () => {
    it("steps forward and backward by whole days", () => {
        expect(addDaysIso("2026-06-11", 1)).toBe("2026-06-12");
        expect(addDaysIso("2026-06-11", 0)).toBe("2026-06-11");
        expect(addDaysIso("2026-06-11", -1)).toBe("2026-06-10");
    });

    it("rolls over months, years and leap days", () => {
        expect(addDaysIso("2026-06-30", 1)).toBe("2026-07-01");
        expect(addDaysIso("2026-12-31", 1)).toBe("2027-01-01");
        expect(addDaysIso("2024-02-28", 1)).toBe("2024-02-29");
        expect(addDaysIso("2026-02-28", 1)).toBe("2026-03-01");
    });
});

describe("daysBetweenIso", () => {
    it("counts whole days forward and backward", () => {
        expect(daysBetweenIso("2026-06-11", "2026-06-11")).toBe(0);
        expect(daysBetweenIso("2026-06-11", "2026-06-14")).toBe(3);
        expect(daysBetweenIso("2026-06-14", "2026-06-11")).toBe(-3);
    });

    it("crosses month, year and leap-day boundaries", () => {
        expect(daysBetweenIso("2025-12-31", "2026-01-01")).toBe(1);
        expect(daysBetweenIso("2024-02-28", "2024-03-01")).toBe(2);
        expect(daysBetweenIso("2026-01-01", "2062-01-01")).toBe(13149);
    });
});

describe("isCalendarDate", () => {
    it("accepts real dates including leap day", () => {
        expect(isCalendarDate("2026-06-11")).toBe(true);
        expect(isCalendarDate("2024-02-29")).toBe(true);
        expect(isCalendarDate("2026-12-31")).toBe(true);
    });

    it("rejects a day, month or leap day that does not exist", () => {
        expect(isCalendarDate("2026-02-30")).toBe(false);
        expect(isCalendarDate("2026-02-29")).toBe(false);
        expect(isCalendarDate("2026-13-01")).toBe(false);
        expect(isCalendarDate("2026-04-31")).toBe(false);
        expect(isCalendarDate("2026-00-10")).toBe(false);
    });
});

describe("insertAtClamped", () => {
    it("reinserts at the original index without mutating the input", () => {
        const arr = ["a", "c"];
        const out = insertAtClamped(arr, 1, "b");
        expect(out).toEqual(["a", "b", "c"]);
        expect(arr).toEqual(["a", "c"]); // input untouched
    });

    it("clamps a stale index past the end to the back", () => {
        expect(insertAtClamped(["a"], 5, "z")).toEqual(["a", "z"]);
    });

    it("clamps a negative index to the front", () => {
        expect(insertAtClamped(["a", "b"], -3, "z")).toEqual(["z", "a", "b"]);
    });

    it("inserts into an empty array", () => {
        expect(insertAtClamped([], 2, "only")).toEqual(["only"]);
    });
});

describe("formatYearMonth", () => {
    it("formats ISO date string into YYYY.MM", () => {
        expect(formatYearMonth("2026-06-11")).toBe("2026.06");
        expect(formatYearMonth("2025-12-25T10:00:00")).toBe("2025.12");
        expect(formatYearMonth("2024/04/01")).toBe("2024.04");
    });

    it("returns empty string on empty/null input", () => {
        expect(formatYearMonth("")).toBe("");
        expect(formatYearMonth(null)).toBe("");
        expect(formatYearMonth(undefined)).toBe("");
    });
});

describe("compareTripDates", () => {
    const today = "2026-08-24";

    it("sorts upcoming trips by closest first", () => {
        expect(compareTripDates("2026-09-01", "2026-10-15", today)).toBeLessThan(0);
        expect(compareTripDates("2026-12-01", "2026-09-01", today)).toBeGreaterThan(0);
    });

    it("sorts past trips by most recent first", () => {
        expect(compareTripDates("2026-07-01", "2025-01-01", today)).toBeLessThan(0);
        expect(compareTripDates("2024-05-01", "2026-06-01", today)).toBeGreaterThan(0);
    });

    it("places upcoming trips before past trips", () => {
        expect(compareTripDates("2026-09-01", "2026-07-01", today)).toBeLessThan(0);
        expect(compareTripDates("2026-07-01", "2026-09-01", today)).toBeGreaterThan(0);
    });

    it("places undated trips at the end", () => {
        expect(compareTripDates("2026-09-01", null, today)).toBeLessThan(0);
        expect(compareTripDates(undefined, "2026-09-01", today)).toBeGreaterThan(0);
        expect(compareTripDates(null, undefined, today)).toBe(0);
    });

    // The window between the grace boundary and today: a trip you are on, or just back
    // from, is the one you want at the top — not filed behind everything still to come.
    it("puts a trip inside the grace window ahead of every upcoming one", () => {
        expect(compareTripDates("2026-08-08", "2026-09-01", today)).toBeLessThan(0);
        expect(compareTripDates("2026-12-01", "2026-08-08", today)).toBeGreaterThan(0);
    });

    it("splits on the same boundary the switcher folds by", () => {
        // 30 days back is still current, so it leads; one day earlier is history.
        expect(compareTripDates("2026-07-25", "2026-12-01", today)).toBeLessThan(0);
        expect(compareTripDates("2026-07-24", "2026-12-01", today)).toBeGreaterThan(0);
        expect(isTripLongPast("2026-07-25", today)).toBe(false);
        expect(isTripLongPast("2026-07-24", today)).toBe(true);
    });
});

describe("isTripLongPast", () => {
    const TODAY = "2026-08-27";

    it("keeps a future trip and one that has not yet outlived the grace period", () => {
        expect(isTripLongPast("2026-11-05", TODAY)).toBe(false);
        expect(isTripLongPast(TODAY, TODAY)).toBe(false);
        // 30 days back is the boundary itself, and the boundary still counts as current.
        expect(isTripLongPast("2026-07-28", TODAY)).toBe(false);
    });

    it("folds away a trip that started before the grace period", () => {
        expect(isTripLongPast("2026-07-27", TODAY)).toBe(true);
        expect(isTripLongPast("2025-01-01", TODAY)).toBe(true);
    });

    it("never folds away a record that says nothing about when it happened", () => {
        expect(isTripLongPast(undefined, TODAY)).toBe(false);
        expect(isTripLongPast(null, TODAY)).toBe(false);
        expect(isTripLongPast("   ", TODAY)).toBe(false);
    });

    it("reads only the date half of a timestamp, and trims before slicing", () => {
        expect(isTripLongPast("2026-07-27T23:59:00Z", TODAY)).toBe(true);
        expect(isTripLongPast(" 2026-11-05 ", TODAY)).toBe(false);
    });
});
