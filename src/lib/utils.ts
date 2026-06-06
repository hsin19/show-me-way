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
