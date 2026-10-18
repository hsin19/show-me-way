// Itinerary/timeline business logic: what counts as "current", what to feature
// next, hotel-night bookkeeping, and the plain-text day report. Split out of
// utils.ts because this changes with product UX (a new event-status rule, a new
// report field), unlike the calendar math utils.ts keeps, which changes only
// when a date bug is fixed.

import {
    daysBetweenIso,
    formatDayDate,
    toLocalIsoDate,
    tripDayOf,
} from "./utils";

/**
 * What a timeline item says about when: `time` is free text written for people, and
 * `start` / `end` are ISO (`YYYY-MM-DD` or `YYYY-MM-DDTHH:mm`) written for the app. The
 * screen prefers `time`, the clock logic prefers `start`; each falls back to the other.
 */
interface Timed {
    time?: string;
    start?: string;
    end?: string;
}

export interface CountdownTrip {
    start: string; // YYYY-MM-DD
    /** Local date-time without an offset; derived from day 1's first event, never authored. */
    departure: string;
}

/**
 * Time left until the trip's first event, for the overview's prep card; null from the
 * first trip day on, and once that event has begun — which a day 1 opening before
 * `DAY_ROLLOVER_HOUR` does while the trip day is still the eve.
 */
export function getCountdownText(trip: CountdownTrip, now: Date = new Date()): string | null {
    if (tripDayOf(now) >= trip.start) return null;

    const diff = new Date(trip.departure).getTime() - now.getTime();
    if (diff <= 0) return null;
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    if (days > 0) return `倒數 ${days} 天 ${hours} 小時`;

    const mins = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    return `即將出發 ${hours}時 ${mins}分`;
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
 * Minutes after `dayDate`'s local midnight at which the item starts: `start`'s time of
 * day when it has one, otherwise what `time` begins with. Either is counted on `start`'s
 * date when there is one, so a start on the next date lands past 1440 just as the
 * "25:30" notation does.
 */
export function eventStartMinutes(event: Timed, dayDate: string): number | null {
    const [date, clock] = event.start?.split("T") ?? [];
    const minutes = parseEventStartMinutes(clock ?? event.time ?? "");
    if (minutes === null) return null;
    return (date ? daysBetweenIso(dayDate, date) * 24 * 60 : 0) + minutes;
}

/**
 * The time chip's text: `time` as written, or else `start` – `end`. On a card that sits on
 * `dayDate`, a value reads against that day the way a ticket marks an arrival on another
 * date (`00:55 +1`), and a bare date on the day itself says nothing. Without a `dayDate`
 * (a hotel in 住宿) a value leads with MM/DD.
 */
export function formatEventTime(event: Timed, dayDate?: string): string {
    if (event.time) return event.time;
    const part = (iso: string) => {
        const [date = "", clock] = iso.split("T");
        if (dayDate) {
            const offset = daysBetweenIso(dayDate, date);
            const shift = offset === 0 ? "" : `${offset > 0 ? "+" : ""}${offset}`;
            return [clock, shift].filter(Boolean).join(" ");
        }
        const mmdd = `${date.slice(5, 7)}/${date.slice(8, 10)}`;
        return clock ? `${mmdd} ${clock}` : mmdd;
    };
    return [event.start, event.end].filter(value => value !== undefined).map(part).filter(Boolean).join(" – ");
}

/**
 * `now` as minutes after `dayDate`'s local midnight, the scale `eventStartMinutes` uses:
 * 01:40 the morning after reads 1540, as late as a "25:40" event.
 */
function minutesIntoDay(dayDate: string, now: Date): number {
    return daysBetweenIso(dayDate, toLocalIsoDate(now)) * 24 * 60 + now.getHours() * 60 + now.getMinutes();
}

/**
 * Index of the "current" event: the last one already started at `now`. Untimed events
 * can never be current, and null means nothing has started yet. Display (YAML) order
 * decides — the list is not re-sorted — so with out-of-order times the last started
 * entry wins.
 *
 * Measures `now` from `dayDate` whatever day it is: check `dayDate === tripDayOf(now)`
 * yourself before treating the result as today's in-progress event.
 */
export function findCurrentEventIndex(
    events: readonly Timed[],
    dayDate: string,
    now: Date = new Date(),
): number | null {
    const nowMinutes = minutesIntoDay(dayDate, now);
    let current: number | null = null;
    for (const [i, event] of events.entries()) {
        const start = eventStartMinutes(event, dayDate);
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
 * Untimed events are never dimmed. A current event stays current until the next one
 * starts, and the day's last until midnight: `end` is not read here, so nothing clears
 * it sooner.
 */
export function classifyTimelineEvents(
    events: readonly Timed[],
    dayDate: string,
    now: Date = new Date(),
): EventTimeStatus[] | null {
    if (dayDate !== tripDayOf(now)) return null;
    const currentIdx = findCurrentEventIndex(events, dayDate, now);
    return events.map((event, i) => {
        if (eventStartMinutes(event, dayDate) === null) return "no-time";
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
 * The event to feature on the overview's today card: the next unresolved one, or
 * the one in progress when nothing further is scheduled. Null when `dayDate` is
 * not today or the day has nothing to announce.
 */
export function getNextEventInfo(
    events: ReadonlyArray<Timed & { title: string; status?: "done" | "skipped"; }>,
    dayDate: string,
    now: Date = new Date(),
): NextEventInfo | null {
    if (dayDate !== tripDayOf(now)) return null;
    const currentIdx = findCurrentEventIndex(events, dayDate, now);
    const nowMinutes = minutesIntoDay(dayDate, now);
    for (const event of events.slice((currentIdx ?? -1) + 1)) {
        // Manually resolved events are never announced as what's next.
        if (event.status) continue;
        const start = eventStartMinutes(event, dayDate);
        if (start === null) continue;
        return {
            kind: "upcoming",
            title: event.title,
            time: startClock(event, start),
            // The clamp is belt-and-braces: an event after the current one must
            // start later than now, or it would be the current one.
            minutesUntil: Math.max(0, start - nowMinutes),
        };
    }
    // A checked-off / skipped anchor is no longer "in progress" — fall back to
    // the countdown label instead of contradicting the card's strikethrough.
    const current = currentIdx === null ? undefined : events[currentIdx];
    if (!current || current.status) return null;
    return {
        kind: "current",
        title: current.title,
        time: startClock(current, eventStartMinutes(current, dayDate) ?? 0),
    };
}

/** `start`'s own time of day, so a start on the next date reads 00:55 rather than 24:55. */
function startClock(event: Timed, minutes: number): string {
    return event.start?.split("T")[1] ?? formatEventMinutes(minutes);
}

export function formatNextEventLabel(info: NextEventInfo): string {
    return info.kind === "upcoming"
        ? `接下來 ${info.time} ${info.title}`
        : `進行中：${info.title}`;
}

/**
 * The event a freshly-opened day panel should auto-scroll to: the current one,
 * skipped forward past anything already resolved (done/skipped) rather than
 * opening on a struck-through card — the same rule `getNextEventInfo` follows
 * for the today card. Null when `dayDate` is not today, nothing has started
 * yet, or every event from the current one onward is resolved.
 */
export function findScrollTargetEventIndex(
    events: ReadonlyArray<Timed & { status?: "done" | "skipped"; }>,
    dayDate: string,
    now: Date = new Date(),
): number | null {
    if (dayDate !== tripDayOf(now)) return null;
    let eventIdx = findCurrentEventIndex(events, dayDate, now);
    while (eventIdx !== null && events[eventIdx]?.status) {
        eventIdx = eventIdx + 1 < events.length ? eventIdx + 1 : null;
    }
    return eventIdx;
}

/**
 * Is `date` a night spent at this hotel? Check-in day yes, checkout day no — the
 * two hotels share a changeover date and the night belongs to the new one, which
 * is what stops both from highlighting. Every 今晚住宿 answer in the app comes
 * from here so they cannot disagree.
 */
export function isOvernightStay(
    hotel: { start: string; end: string; },
    date: string,
): boolean {
    return date >= hotel.start.slice(0, 10) && date < hotel.end.slice(0, 10);
}

/** Is `date` this hotel's checkout day? Drives the auto-inserted 退房 node. */
export function isCheckoutDay(hotel: { end: string; }, date: string): boolean {
    return date === hotel.end.slice(0, 10);
}

/** The 報平安 message for one day. Plain text, so it pastes cleanly into LINE. */
export function buildDayReport(
    dayData: {
        day: number;
        date: string;
        title: string;
        timeline: ReadonlyArray<Timed & { title: string; status?: "done" | "skipped"; }>;
    },
    hotels: ReadonlyArray<{ title: string; address?: string; start: string; end: string; }>,
    tripName: string,
): string {
    const lines = [`【${tripName}】Day ${dayData.day}｜${formatDayDate(dayData.date)}｜${dayData.title}`];
    const hotel = hotels.find(h => isOvernightStay(h, dayData.date));
    if (hotel) {
        lines.push(`今晚住宿：${hotel.title}`);
        if (hotel.address) lines.push(`地址：${hotel.address}`);
    } else {
        lines.push("今晚住宿：未安排");
    }
    lines.push("", "今日行程：");
    if (dayData.timeline.length === 0) {
        lines.push("（無安排）");
    } else {
        for (const event of dayData.timeline) {
            const line = `・${[formatEventTime(event, dayData.date), event.title].filter(Boolean).join(" ")}`;
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
