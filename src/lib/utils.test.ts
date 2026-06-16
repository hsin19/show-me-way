import {
    describe,
    expect,
    it,
} from "vitest";
import {
    buildDayReport,
    classifyTimelineEvents,
    findCurrentEventIndex,
    formatDateRange,
    formatDayDate,
    formatNextEventLabel,
    getCountdownText,
    getNextEventInfo,
    getTodayIsoString,
    isCheckoutDay,
    isOvernightStay,
    mapDirections,
    mapSearch,
    parseEventStartMinutes,
    parseLocalDate,
    toLocalIsoDate,
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

describe("toLocalIsoDate", () => {
    it("formats the local calendar date with zero-padding", () => {
        expect(toLocalIsoDate(new Date(2026, 0, 5))).toBe("2026-01-05");
    });

    it("round-trips with parseLocalDate", () => {
        expect(toLocalIsoDate(parseLocalDate("2026-06-11"))).toBe("2026-06-11");
    });
});

describe("parseEventStartMinutes", () => {
    it("parses HH:MM", () => {
        expect(parseEventStartMinutes("09:30")).toBe(570);
    });

    it("takes the start of a time range", () => {
        expect(parseEventStartMinutes("14:00 - 17:25")).toBe(840);
    });

    it("parses a time with trailing free text", () => {
        expect(parseEventStartMinutes("22:00 之後")).toBe(1320);
    });

    it("parses single-digit hours and leading whitespace", () => {
        expect(parseEventStartMinutes("9:05")).toBe(545);
        expect(parseEventStartMinutes(" 14:00")).toBe(840);
    });

    it("accepts the after-midnight timetable notation (25:30)", () => {
        expect(parseEventStartMinutes("25:30")).toBe(1530);
    });

    it("returns null for unparseable input", () => {
        expect(parseEventStartMinutes("整天")).toBeNull();
        expect(parseEventStartMinutes("")).toBeNull();
        expect(parseEventStartMinutes("下午")).toBeNull();
    });

    it("returns null for invalid minutes", () => {
        expect(parseEventStartMinutes("14:75")).toBeNull();
        expect(parseEventStartMinutes("14:5")).toBeNull();
    });
});

describe("findCurrentEventIndex", () => {
    const timed = (...times: string[]) => times.map(time => ({ time }));

    it("returns the last started event when now is between two events", () => {
        expect(findCurrentEventIndex(timed("08:00", "12:00", "18:00"), new Date(2026, 5, 11, 14, 30)))
            .toBe(1);
    });

    it("returns null before the first event", () => {
        expect(findCurrentEventIndex(timed("08:00", "12:00"), new Date(2026, 5, 11, 6, 0)))
            .toBeNull();
    });

    it("returns the last timed event after everything started", () => {
        expect(findCurrentEventIndex(timed("08:00", "12:00", "18:00"), new Date(2026, 5, 11, 23, 0)))
            .toBe(2);
    });

    it("treats an exact start time as started (inclusive)", () => {
        expect(findCurrentEventIndex(timed("08:00", "12:00"), new Date(2026, 5, 11, 12, 0)))
            .toBe(1);
    });

    it("skips events without a parseable time", () => {
        expect(findCurrentEventIndex(timed("整天", "10:00", "自由活動", "15:00"), new Date(2026, 5, 11, 12, 0)))
            .toBe(1);
    });

    it("returns null for empty or fully untimed lists", () => {
        expect(findCurrentEventIndex([], new Date(2026, 5, 11, 12, 0))).toBeNull();
        expect(findCurrentEventIndex(timed("整天", "自由"), new Date(2026, 5, 11, 12, 0))).toBeNull();
    });

    it("picks the last started entry in display order for out-of-order times", () => {
        expect(findCurrentEventIndex(timed("10:00", "14:00", "11:00"), new Date(2026, 5, 11, 11, 30)))
            .toBe(2);
    });

    it("never selects an after-midnight (25:30) entry on the same day", () => {
        expect(findCurrentEventIndex(timed("25:30"), new Date(2026, 5, 11, 23, 59)))
            .toBeNull();
    });
});

describe("classifyTimelineEvents", () => {
    const today = "2026-06-11";
    const timed = (...times: string[]) => times.map(time => ({ time }));

    it("returns null when the day is not now's local date", () => {
        const now = new Date(2026, 5, 11, 14, 30);
        expect(classifyTimelineEvents(timed("08:00"), "2026-06-10", now)).toBeNull();
        expect(classifyTimelineEvents(timed("08:00"), "2026-06-12", now)).toBeNull();
        expect(classifyTimelineEvents(timed("08:00"), "not-a-date", now)).toBeNull();
    });

    it("classifies past / current / upcoming mid-day", () => {
        expect(classifyTimelineEvents(timed("08:00", "12:00", "18:00"), today, new Date(2026, 5, 11, 14, 30)))
            .toEqual(["past", "current", "upcoming"]);
    });

    it("keeps untimed events as no-time (never dimmed)", () => {
        expect(classifyTimelineEvents(timed("08:00", "整天", "12:00"), today, new Date(2026, 5, 11, 14, 30)))
            .toEqual(["past", "no-time", "current"]);
    });

    it("marks everything upcoming before the first event", () => {
        expect(classifyTimelineEvents(timed("08:00", "12:00"), today, new Date(2026, 5, 11, 6, 0)))
            .toEqual(["upcoming", "upcoming"]);
    });

    it("keeps the last event current after everything started", () => {
        expect(classifyTimelineEvents(timed("08:00", "12:00"), today, new Date(2026, 5, 11, 23, 0)))
            .toEqual(["past", "current"]);
    });

    it("returns an empty array for an empty timeline on today", () => {
        expect(classifyTimelineEvents([], today, new Date(2026, 5, 11, 14, 30))).toEqual([]);
    });

    it("uses display-order semantics for out-of-order times", () => {
        expect(classifyTimelineEvents(timed("10:00", "14:00", "11:00"), today, new Date(2026, 5, 11, 11, 30)))
            .toEqual(["past", "past", "current"]);
    });

    it("treats just-after-midnight as today (local time, no UTC shift)", () => {
        expect(classifyTimelineEvents(timed("08:00"), today, new Date(2026, 5, 11, 0, 30)))
            .toEqual(["upcoming"]);
    });
});

describe("getNextEventInfo / formatNextEventLabel", () => {
    const today = "2026-06-11";
    const events = [
        { time: "08:00", title: "早餐" },
        { time: "整天", title: "自由活動" },
        { time: "14:00", title: "景福宮" },
    ];

    it("returns the first timed event after the current one", () => {
        const info = getNextEventInfo(events, today, new Date(2026, 5, 11, 12, 30));
        expect(info).toEqual({
            kind: "upcoming",
            title: "景福宮",
            time: "14:00",
            minutesUntil: 90,
        });
    });

    it("normalizes single-digit hours with zero-padding", () => {
        const info = getNextEventInfo([{ time: "9:30", title: "出發" }], today, new Date(2026, 5, 11, 8, 0));
        expect(info?.time).toBe("09:30");
    });

    it("falls back to the current event when everything has started", () => {
        const info = getNextEventInfo(events, today, new Date(2026, 5, 11, 23, 0));
        expect(info).toEqual({ kind: "current", title: "景福宮", time: "14:00" });
    });

    it("returns null outside today or without timed events", () => {
        const now = new Date(2026, 5, 11, 12, 0);
        expect(getNextEventInfo(events, "2026-06-12", now)).toBeNull();
        expect(getNextEventInfo([{ time: "整天", title: "自由" }], today, now)).toBeNull();
        expect(getNextEventInfo([], today, now)).toBeNull();
    });

    it("skips manually resolved events when announcing what's next", () => {
        const withSkipped = [
            { time: "08:00", title: "早餐" },
            { time: "14:00", title: "景福宮", status: "skipped" as const },
            { time: "16:00", title: "市場" },
        ];
        const info = getNextEventInfo(withSkipped, today, new Date(2026, 5, 11, 12, 30));
        expect(info).toEqual({ kind: "upcoming", title: "市場", time: "16:00", minutesUntil: 210 });
    });

    it("falls back to null instead of 'current' when the anchor is checked off", () => {
        const allDone = [
            { time: "08:00", title: "早餐", status: "done" as const },
            { time: "14:00", title: "景福宮", status: "done" as const },
        ];
        expect(getNextEventInfo(allDone, today, new Date(2026, 5, 11, 23, 0))).toBeNull();
    });

    it("formats the capsule label", () => {
        expect(formatNextEventLabel({ kind: "upcoming", title: "景福宮", time: "14:00", minutesUntil: 90 }))
            .toBe("接下來 14:00 景福宮");
        expect(formatNextEventLabel({ kind: "current", title: "景福宮", time: "14:00" }))
            .toBe("進行中：景福宮");
    });
});

describe("isOvernightStay", () => {
    const hotel = { checkIn: "2026-06-11", checkOut: "2026-06-14" };

    it("counts the check-in day and nights up to (not including) checkout", () => {
        expect(isOvernightStay(hotel, "2026-06-11")).toBe(true); // check-in day
        expect(isOvernightStay(hotel, "2026-06-13")).toBe(true); // last night
        expect(isOvernightStay(hotel, "2026-06-14")).toBe(false); // checkout day
        expect(isOvernightStay(hotel, "2026-06-10")).toBe(false); // before
        expect(isOvernightStay(hotel, "2026-06-15")).toBe(false); // after
    });

    it("assigns a changeover day to the next hotel only (no double stay)", () => {
        const a = { checkIn: "2026-06-11", checkOut: "2026-06-14" };
        const b = { checkIn: "2026-06-14", checkOut: "2026-06-16" };
        const changeover = "2026-06-14";
        expect(isOvernightStay(a, changeover)).toBe(false);
        expect(isOvernightStay(b, changeover)).toBe(true);
    });
});

describe("isCheckoutDay", () => {
    it("is true only on the checkout date", () => {
        const hotel = { checkOut: "2026-06-14" };
        expect(isCheckoutDay(hotel, "2026-06-14")).toBe(true);
        expect(isCheckoutDay(hotel, "2026-06-13")).toBe(false);
        expect(isCheckoutDay(hotel, "2026-06-15")).toBe(false);
    });

    it("on a changeover day fires for the departing hotel while the next hotel is the overnight stay", () => {
        const a = { checkIn: "2026-06-11", checkOut: "2026-06-14" };
        const b = { checkIn: "2026-06-14", checkOut: "2026-06-16" };
        const changeover = "2026-06-14";
        expect(isCheckoutDay(a, changeover)).toBe(true); // 退房 A 顯示在頂端
        expect(isOvernightStay(b, changeover)).toBe(true); // 回飯店 B 顯示在底端
    });
});

describe("buildDayReport", () => {
    const hotels = [
        { name: "弘大公寓", address: "首爾麻浦區楊花路 123", checkIn: "2026-06-11", checkOut: "2026-06-14" },
        { name: "明洞飯店", address: "首爾中區明洞街 45", checkIn: "2026-06-14", checkOut: "2026-06-16" },
    ];

    it("composes header, tonight's hotel with address, and the timeline summary", () => {
        const day = {
            day: 1,
            date: "2026-06-11",
            region: "弘大・延南洞",
            timeline: [
                { time: "09:30", title: "早餐" },
                { time: "整天", title: "自由活動" },
            ],
        };
        expect(buildDayReport(day, hotels, "首爾自由行")).toBe(
            [
                "【首爾自由行】Day 1｜06/11(四)｜弘大・延南洞",
                "今晚住宿：弘大公寓",
                "地址：首爾麻浦區楊花路 123",
                "",
                "今日行程：",
                "・09:30 早餐",
                "・整天 自由活動",
            ].join("\n"),
        );
    });

    it("marks checked-off and skipped events so the report mirrors real progress", () => {
        const day = {
            day: 1,
            date: "2026-06-11",
            region: "弘大",
            timeline: [
                { time: "09:30", title: "早餐", status: "done" as const },
                { time: "12:00", title: "拉麵店", status: "skipped" as const },
                { time: "14:00", title: "景福宮" },
            ],
        };
        const report = buildDayReport(day, hotels, "首爾自由行");
        expect(report).toContain("・09:30 早餐 ✓");
        expect(report).toContain("・12:00 拉麵店（略過）");
        expect(report).toContain("・14:00 景福宮");
        expect(report).not.toContain("景福宮 ✓");
    });

    it("assigns the changeover night to the next hotel (checkout day excluded)", () => {
        const day = { day: 4, date: "2026-06-14", region: "明洞", timeline: [{ time: "10:00", title: "換飯店" }] };
        expect(buildDayReport(day, hotels, "首爾自由行")).toContain("今晚住宿：明洞飯店");
    });

    it("reports 未安排 when no hotel covers the night (e.g. departure day)", () => {
        const day = { day: 6, date: "2026-06-16", region: "回程", timeline: [{ time: "18:00", title: "回程班機" }] };
        expect(buildDayReport(day, hotels, "首爾自由行")).toContain("今晚住宿：未安排");
    });

    it("handles an empty timeline and an empty hotel list", () => {
        const day = { day: 2, date: "2026-06-12", region: "自由活動", timeline: [] };
        const report = buildDayReport(day, [], "首爾自由行");
        expect(report).toContain("今晚住宿：未安排");
        expect(report).toContain("今日行程：\n（無安排）");
    });

    it("omits a blank time from the event line", () => {
        const day = { day: 3, date: "2026-06-13", region: "弘大", timeline: [{ time: "", title: "睡到自然醒" }] };
        expect(buildDayReport(day, hotels, "首爾自由行")).toContain("・睡到自然醒");
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

describe("mapSearch", () => {
    it("uses Naver when provider is 'naver'", () => {
        expect(mapSearch("엘양호텔", "naver")).toBe("https://map.naver.com/p/search/%EC%97%98%EC%96%91%ED%98%B8%ED%85%94");
    });

    it("uses Google Maps for 'google'", () => {
        expect(mapSearch("Tokyo Tower", "google")).toBe("https://www.google.com/maps/search/?api=1&query=Tokyo%20Tower");
    });

    it("falls back to Google Maps when provider is undefined or unknown", () => {
        const googlePrefix = "https://www.google.com/maps/search/?api=1&query=";
        expect(mapSearch("x")).toBe(`${googlePrefix}x`);
        expect(mapSearch("x", "kakao")).toBe(`${googlePrefix}x`);
    });

    it("encodes the query string", () => {
        expect(mapSearch("a b&c", "naver")).toBe("https://map.naver.com/p/search/a%20b%26c");
    });
});

describe("mapDirections", () => {
    it("builds a Google transit-directions URL with the destination encoded", () => {
        expect(mapDirections("東京タワー & 周辺", "google")).toBe(
            "https://www.google.com/maps/dir/?api=1&destination=%E6%9D%B1%E4%BA%AC%E3%82%BF%E3%83%AF%E3%83%BC%20%26%20%E5%91%A8%E8%BE%BA&travelmode=transit",
        );
    });

    it("omits origin so the route starts from the current location", () => {
        expect(mapDirections("Tokyo Tower")).not.toContain("origin=");
    });

    it("falls back to the Naver search page (no stable directions URL)", () => {
        expect(mapDirections("엘양호텔", "naver")).toBe(mapSearch("엘양호텔", "naver"));
        expect(mapDirections("엘양호텔", "naver")).toBe("https://map.naver.com/p/search/%EC%97%98%EC%96%91%ED%98%B8%ED%85%94");
    });

    it("uses Google for undefined or unknown providers", () => {
        const googlePrefix = "https://www.google.com/maps/dir/?api=1&destination=";
        expect(mapDirections("x")).toBe(`${googlePrefix}x&travelmode=transit`);
        expect(mapDirections("x", "kakao")).toBe(`${googlePrefix}x&travelmode=transit`);
    });
});
