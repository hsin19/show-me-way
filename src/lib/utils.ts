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
 * Get current local date in YYYY-MM-DD format
 */
export function getTodayIsoString(): string {
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, "0");
    const dd = String(now.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
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
