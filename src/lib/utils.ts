/**
 * Parse a YYYY-MM-DD string as a date in the LOCAL timezone.
 * `new Date("2026-06-11")` parses as UTC midnight, which can shift the day
 * (and weekday) in timezones west of UTC. This builds the date locally instead.
 * Falls back to native Date for full ISO datetime strings (with time component).
 */
export function parseLocalDate(dateStr: string): Date {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
    if (match) {
        const [, y, m, d] = match;
        return new Date(Number(y), Number(m) - 1, Number(d));
    }
    return new Date(dateStr);
}

/**
 * Format an ISO date string (YYYY-MM-DD) into a localized Chinese display format: MM/DD(W)
 * Example: "2026-06-11" -> "06/11(四)"
 */
export function formatDayDate(isoDateStr: string): string {
    const date = parseLocalDate(isoDateStr);
    if (isNaN(date.getTime())) return isoDateStr;
    const mm = String(date.getMonth() + 1).padStart(2, "0");
    const dd = String(date.getDate()).padStart(2, "0");
    const weekdays = ["日", "一", "二", "三", "四", "五", "六"];
    const w = weekdays[date.getDay()];
    return `${mm}/${dd}(${w})`;
}

/**
 * Format a Date as YYYY-MM-DD using its LOCAL calendar date. Counterpart of
 * `parseLocalDate` — `toISOString()` would shift the day across the UTC line.
 */
export function toLocalIsoDate(date: Date): string {
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, "0");
    const dd = String(date.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
}

/**
 * Get current local date in YYYY-MM-DD format
 */
export function getTodayIsoString(): string {
    return toLocalIsoDate(new Date());
}

export interface CountdownTrip {
    start: string; // YYYY-MM-DD
    end: string; // YYYY-MM-DD
    departure: string; // ISO date-time
}

/**
 * Compute the home-screen countdown label for a trip relative to `now`.
 * Pure function (no Date.now side effects) so it can be unit-tested.
 */
export function getCountdownText(trip: CountdownTrip, now: Date = new Date()): string {
    const departureDate = new Date(trip.departure);
    const startDate = parseLocalDate(trip.start);
    const endDate = new Date(trip.end + "T23:59:59");

    // During the trip
    if (now >= startDate && now <= endDate) return "✈️ 冒險進行中！";
    // After the trip
    if (now > endDate) return "🗺️ 旅程圓滿結束";

    // Before the trip: count down to the flight
    const diff = departureDate.getTime() - now.getTime();
    if (diff <= 0) return "✈️ 飛機已起飛！";

    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    if (days > 0) return `⏳ 倒數 ${days} 天 ${hours} 小時`;

    const mins = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    return `⏳ 即將出發 ${hours}時 ${mins}分`;
}

/**
 * Extract the start time from a free-form `event.time` string as minutes
 * since local midnight. Matches a leading H:MM / HH:MM after trimming leading
 * whitespace — "14:00 - 17:25" → 840, "22:00 之後" → 1320. Minutes must be
 * 00-59; hours may exceed 23 ("25:30" → 1530, the after-midnight timetable
 * notation), which sorts after every same-day time and therefore never becomes
 * "current" before the day rolls over. Returns null for anything unparseable
 * ("整天", "", "14:75") — the event is then treated as having no time.
 */
export function parseEventStartMinutes(time: string): number | null {
    const match = /^(\d{1,2}):(\d{2})/.exec(time.trimStart());
    if (!match) return null;
    const minutes = Number(match[2]);
    if (minutes > 59) return null;
    return Number(match[1]) * 60 + minutes;
}

/**
 * Index (into the display-order event list) of the "current" event: the LAST
 * event whose parsed start time is <= `now`'s local time of day. Events
 * without a parseable time are skipped and can never be current. Times are
 * NOT re-sorted — for out-of-order data the last already-started entry in
 * display (YAML) order wins. Returns null when no timed event has started
 * yet, or when there are no timed events at all.
 *
 * Date-agnostic: callers must check `dayDate === toLocalIsoDate(now)` before
 * treating the result as "today's in-progress event".
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
 * Classify each event of one day for timeline highlighting. Returns an array
 * parallel to `events`, or null when `dayDate` is not `now`'s local date —
 * meaning "no time styling for this day", so every day panel shares one code
 * path.
 *
 * Within today: the event at `findCurrentEventIndex` is "current"; timed
 * events BEFORE it in display order are "past", timed events after it are
 * "upcoming" (display-order semantics — everything above the current card
 * reads as done, even if literal times are out of order); unparseable times
 * are always "no-time" (never dimmed). When nothing has started yet every
 * timed event is "upcoming". The last started event stays "current" until
 * midnight — there is no reliable end time to clear it.
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

function formatEventMinutes(minutes: number): string {
    const h = String(Math.floor(minutes / 60)).padStart(2, "0");
    const m = String(minutes % 60).padStart(2, "0");
    return `${h}:${m}`;
}

/**
 * The event to feature in the header capsule for `dayDate`. Returns null when
 * `dayDate` is not `now`'s local date or the day has no timed events (callers
 * fall back to `getCountdownText`). Otherwise: the first timed event after
 * the current one in display order (kind "upcoming"), or the current event
 * itself when nothing further is scheduled (kind "current").
 */
export function getNextEventInfo(
    events: ReadonlyArray<{ time: string; title: string; }>,
    dayDate: string,
    now: Date = new Date(),
): NextEventInfo | null {
    if (dayDate !== toLocalIsoDate(now)) return null;
    const currentIdx = findCurrentEventIndex(events, now);
    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    for (let i = (currentIdx ?? -1) + 1; i < events.length; i++) {
        const start = parseEventStartMinutes(events[i].time);
        if (start === null) continue;
        return {
            kind: "upcoming",
            title: events[i].title,
            time: formatEventMinutes(start),
            // Anything after the current event must start later than now
            // (otherwise it would BE the current one); clamp stays defensive.
            minutesUntil: Math.max(0, start - nowMinutes),
        };
    }
    if (currentIdx === null) return null;
    return {
        kind: "current",
        title: events[currentIdx].title,
        time: formatEventMinutes(parseEventStartMinutes(events[currentIdx].time) ?? 0),
    };
}

/** Render NextEventInfo as the header capsule label (zh-TW). */
export function formatNextEventLabel(info: NextEventInfo): string {
    return info.kind === "upcoming"
        ? `接下來 ${info.time} ${info.title}`
        : `進行中：${info.title}`;
}

/**
 * Format start and end date into MM/DD display range
 * Example: start: "2026-06-11", end: "2026-06-16" -> "2026.06.11 – 06.16"
 */
export function formatDateRange(startIso: string, endIso: string): string {
    const startDate = parseLocalDate(startIso);
    const endDate = parseLocalDate(endIso);
    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
        return `${startIso} – ${endIso}`;
    }
    const yyyy = startDate.getFullYear();
    const startMM = String(startDate.getMonth() + 1).padStart(2, "0");
    const startDD = String(startDate.getDate()).padStart(2, "0");
    const endMM = String(endDate.getMonth() + 1).padStart(2, "0");
    const endDD = String(endDate.getDate()).padStart(2, "0");

    return `${yyyy}.${startMM}.${startDD} – ${endMM}.${endDD}`;
}

/**
 * Build a map-search URL for a place's local-language name. Which map service
 * to use is a market/regulatory decision (e.g. Korea restricts Google Maps data,
 * so Naver dominates), not a language one — so the caller passes the trip's
 * explicit `mapProvider`. Unknown/undefined falls back to Google Maps, which
 * works everywhere.
 */
export function mapSearch(query: string, provider?: string): string {
    const q = encodeURIComponent(query);
    if (provider === "naver") {
        return `https://map.naver.com/p/search/${q}`;
    }
    return `https://www.google.com/maps/search/?api=1&query=${q}`;
}
