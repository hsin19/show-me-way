import {
    describe,
    expect,
    it,
} from "vitest";
import {
    formatDateRange,
    formatDayDate,
    getCountdownText,
    getTodayIsoString,
    parseLocalDate,
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

describe("formatDayDate", () => {
    it("formats to MM/DD(weekday) in Chinese", () => {
        // 2026-06-11 is a Thursday
        expect(formatDayDate("2026-06-11")).toBe("06/11(四)");
    });

    it("returns the raw string for invalid input", () => {
        expect(formatDayDate("not-a-date")).toBe("not-a-date");
    });
});

describe("getTodayIsoString", () => {
    it("returns a YYYY-MM-DD string", () => {
        expect(getTodayIsoString()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
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

describe("getCountdownText", () => {
    const trip = {
        start: "2026-06-11",
        end: "2026-06-16",
        departure: "2026-06-11T14:00:00+08:00",
    };

    it("shows in-progress during the trip", () => {
        expect(getCountdownText(trip, new Date("2026-06-13T10:00:00+08:00")))
            .toBe("✈️ 冒險進行中！");
    });

    it("shows completed after the trip", () => {
        expect(getCountdownText(trip, new Date("2026-06-20T10:00:00+08:00")))
            .toBe("🗺️ 旅程圓滿結束");
    });

    it("counts down days + hours before the trip", () => {
        // 3 days before departure
        const now = new Date("2026-06-08T14:00:00+08:00");
        expect(getCountdownText(trip, now)).toBe("⏳ 倒數 3 天 0 小時");
    });

    it("shows hours + minutes when under a day to go (before the trip starts)", () => {
        const now = new Date("2026-06-10T22:00:00+08:00");
        expect(getCountdownText(trip, now)).toBe("⏳ 即將出發 16時 0分");
    });
});
