// Itinerary/timeline business logic: what counts as "current", what to feature
// next, hotel-night bookkeeping, and the plain-text day report. Split out of
// utils.ts because this changes with product UX (a new event-status rule, a new
// report field), unlike the calendar math utils.ts keeps, which changes only
// when a date bug is fixed.

import {
    formatDayDate,
    parseLocalDate,
    toLocalIsoDate,
} from "./utils";

export interface CountdownTrip {
    start: string; // YYYY-MM-DD
    end: string; // YYYY-MM-DD
    /** Local date-time without an offset; derived from day 1's first event, never authored. */
    departure: string;
}

/**
 * The hero's phase label: 進行中 / 已結束, or a countdown to the trip's first event.
 * There is deliberately no "already left" case: `departure` is derived to sit on
 * `start`, so it cannot be in the past while the trip has not begun.
 */
export function getCountdownText(trip: CountdownTrip, now: Date = new Date()): string {
    const departureDate = new Date(trip.departure);
    const startDate = parseLocalDate(trip.start);
    const endDate = new Date(trip.end + "T23:59:59");

    if (now >= startDate && now <= endDate) return "✈️ 冒險進行中！";
    if (now > endDate) return "🗺️ 旅程圓滿結束";

    const diff = departureDate.getTime() - now.getTime();
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    if (days > 0) return `⏳ 倒數 ${days} 天 ${hours} 小時`;

    const mins = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    return `⏳ 即將出發 ${hours}時 ${mins}分`;
}

/**
 * Start time of a free-form `event.time` as minutes since local midnight:
 * "14:00 - 17:25" → 840, "22:00 之後" → 1320. Null for anything unparseable
 * ("整天", "", "14:75"), which callers treat as an event with no time.
 *
 * Hours past 23 are accepted ("25:30" → 1530, the after-midnight timetable
 * notation) and sort after every same-day time, so such an event never turns
 * "current" before the day rolls over.
 */
export function parseEventStartMinutes(time: string): number | null {
    const match = /^(\d{1,2}):(\d{2})/.exec(time.trimStart());
    if (!match) return null;
    const minutes = Number(match[2]);
    if (minutes > 59) return null;
    return Number(match[1]) * 60 + minutes;
}

/**
 * Index of the "current" event: the last one already started at `now`'s local
 * time of day. Untimed events can never be current, and null means nothing has
 * started yet. Display (YAML) order decides — the list is not re-sorted — so with
 * out-of-order times the last started entry wins.
 *
 * Date-agnostic: check `dayDate === toLocalIsoDate(now)` yourself before treating
 * the result as today's in-progress event.
 */
export function findCurrentEventIndex(
    events: ReadonlyArray<{ time: string; }>,
    now: Date = new Date(),
): number | null {
    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    let current: number | null = null;
    for (let i = 0; i < events.length; i++) {
        const start = parseEventStartMinutes(events[i].time);
        if (start !== null && start <= nowMinutes) current = i;
    }
    return current;
}

export type EventTimeStatus = "past" | "current" | "upcoming" | "no-time";

/**
 * Time styling for one day's timeline, parallel to `events`. Null means "style
 * nothing" — `dayDate` is not today — so every day panel can take one code path.
 *
 * Position, not the clock, decides past vs. upcoming: everything above the
 * current card reads as done even when the literal times are out of order.
 * Untimed events are never dimmed, and the current event stays current until
 * midnight, since an event has no end time to clear it.
 */
export function classifyTimelineEvents(
    events: ReadonlyArray<{ time: string; }>,
    dayDate: string,
    now: Date = new Date(),
): EventTimeStatus[] | null {
    if (dayDate !== toLocalIsoDate(now)) return null;
    const currentIdx = findCurrentEventIndex(events, now);
    return events.map((event, i) => {
        if (parseEventStartMinutes(event.time) === null) return "no-time";
        if (currentIdx === null) return "upcoming";
        if (i === currentIdx) return "current";
        return i < currentIdx ? "past" : "upcoming";
    });
}

export interface NextEventInfo {
    /** "upcoming": a later timed event exists today; "current": everything has started. */
    kind: "upcoming" | "current";
    title: string;
    /** Normalized zero-padded start time, e.g. "09:30". */
    time: string;
    /** Minutes from `now` until start; only for kind "upcoming". */
    minutesUntil?: number;
}

export function formatEventMinutes(minutes: number): string {
    const h = String(Math.floor(minutes / 60)).padStart(2, "0");
    const m = String(minutes % 60).padStart(2, "0");
    return `${h}:${m}`;
}

/**
 * The event to feature in the header capsule: the next unresolved one, or the
 * one in progress when nothing further is scheduled. Null when `dayDate` is not
 * today or the day has nothing to announce — callers fall back to
 * `getCountdownText`.
 */
export function getNextEventInfo(
    events: ReadonlyArray<{ time: string; title: string; status?: "done" | "skipped"; }>,
    dayDate: string,
    now: Date = new Date(),
): NextEventInfo | null {
    if (dayDate !== toLocalIsoDate(now)) return null;
    const currentIdx = findCurrentEventIndex(events, now);
    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    for (let i = (currentIdx ?? -1) + 1; i < events.length; i++) {
        // Manually resolved events are never announced as what's next.
        if (events[i].status) continue;
        const start = parseEventStartMinutes(events[i].time);
        if (start === null) continue;
        return {
            kind: "upcoming",
            title: events[i].title,
            time: formatEventMinutes(start),
            // The clamp is belt-and-braces: an event after the current one must
            // start later than now, or it would be the current one.
            minutesUntil: Math.max(0, start - nowMinutes),
        };
    }
    // A checked-off / skipped anchor is no longer "in progress" — fall back to
    // the countdown label instead of contradicting the card's strikethrough.
    if (currentIdx === null || events[currentIdx].status) return null;
    return {
        kind: "current",
        title: events[currentIdx].title,
        time: formatEventMinutes(parseEventStartMinutes(events[currentIdx].time) ?? 0),
    };
}

export function formatNextEventLabel(info: NextEventInfo): string {
    return info.kind === "upcoming"
        ? `接下來 ${info.time} ${info.title}`
        : `進行中：${info.title}`;
}

/**
 * Is `date` a night spent at this hotel? Check-in day yes, checkout day no — the
 * two hotels share a changeover date and the night belongs to the new one, which
 * is what stops both from highlighting. Every 今晚住宿 answer in the app comes
 * from here so they cannot disagree.
 */
export function isOvernightStay(
    hotel: { checkIn: string; checkOut: string; },
    date: string,
): boolean {
    return date >= hotel.checkIn && date < hotel.checkOut;
}

/** Is `date` this hotel's checkout day? Drives the auto-inserted 退房 node. */
export function isCheckoutDay(hotel: { checkOut: string; }, date: string): boolean {
    return date === hotel.checkOut;
}

/** The 報平安 message for one day. Plain text, so it pastes cleanly into LINE. */
export function buildDayReport(
    dayData: {
        day: number;
        date: string;
        title: string;
        timeline: ReadonlyArray<{ time: string; title: string; status?: "done" | "skipped"; }>;
    },
    hotels: ReadonlyArray<{ name: string; address: string; checkIn: string; checkOut: string; }>,
    tripName: string,
): string {
    const lines = [`【${tripName}】Day ${dayData.day}｜${formatDayDate(dayData.date)}｜${dayData.title}`];
    const hotel = hotels.find(h => isOvernightStay(h, dayData.date));
    if (hotel) {
        lines.push(`今晚住宿：${hotel.name}`, `地址：${hotel.address}`);
    } else {
        lines.push("今晚住宿：未安排");
    }
    lines.push("", "今日行程：");
    if (dayData.timeline.length === 0) {
        lines.push("（無安排）");
    } else {
        for (const event of dayData.timeline) {
            const line = `・${[event.time, event.title].filter(Boolean).join(" ")}`;
            // Check-in marks are included: the point of the report is real progress,
            // not the plan.
            lines.push(event.status === "done" ? `${line} ✓` : event.status === "skipped" ? `${line}（略過）` : line);
        }
    }
    return lines.join("\n");
}

/**
 * Search URL for a place's local-language name. The provider is the trip's
 * explicit `mapProvider` because it is a market/regulatory fact — Korea restricts
 * Google Maps data, so Naver dominates there — not something derivable from the
 * language. An unknown or absent one falls back to Google Maps, which works
 * everywhere.
 */
export function mapSearch(query: string, provider?: string): string {
    const q = encodeURIComponent(query);
    if (provider === "naver") {
        return `https://map.naver.com/p/search/${q}`;
    }
    return `https://www.google.com/maps/search/?api=1&query=${q}`;
}
