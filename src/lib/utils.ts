/**
 * Parse a plain YYYY-MM-DD as a LOCAL date; anything with a time component goes
 * to native `Date`. Use this, never `new Date(str)`: that parses a plain date as
 * UTC midnight, landing on the previous day (and weekday) west of UTC.
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
 * The date in the two pieces the chips and the overview list size separately:
 * "2026-06-11" -> { mmdd: "06/11", weekday: "四" }. Unparseable input comes back
 * as `mmdd` verbatim with no weekday.
 */
export function splitDayDate(isoDateStr: string): { mmdd: string; weekday: string; } {
    const date = parseLocalDate(isoDateStr);
    if (isNaN(date.getTime())) return { mmdd: isoDateStr, weekday: "" };
    const mm = String(date.getMonth() + 1).padStart(2, "0");
    const dd = String(date.getDate()).padStart(2, "0");
    const weekdays = ["日", "一", "二", "三", "四", "五", "六"];
    return { mmdd: `${mm}/${dd}`, weekday: weekdays[date.getDay()] };
}

/** "2026-06-11" -> "06/11(四)" */
export function formatDayDate(isoDateStr: string): string {
    const { mmdd, weekday } = splitDayDate(isoDateStr);
    return weekday ? `${mmdd}(${weekday})` : mmdd;
}

/** Counterpart of `parseLocalDate`. Use this, never `toISOString()`, which shifts the day across the UTC line. */
export function toLocalIsoDate(date: Date): string {
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, "0");
    const dd = String(date.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
}

export function getTodayIsoString(): string {
    return toLocalIsoDate(new Date());
}

/** A backup's ISO timestamp as a local "06/11(四) 14:30". */
export function formatBackupTime(savedAt: string): string {
    const date = new Date(savedAt);
    if (isNaN(date.getTime())) return savedAt;
    const hh = String(date.getHours()).padStart(2, "0");
    const mm = String(date.getMinutes()).padStart(2, "0");
    return `${formatDayDate(toLocalIsoDate(date))} ${hh}:${mm}`;
}

/** "2026-06-11" -> "2026.06" */
export function formatYearMonth(dateStr?: string | null): string {
    if (!dateStr) return "";
    const match = /^(\d{4})[-/.](\d{2})/.exec(dateStr.trim());
    if (match) {
        return `${match[1]}.${match[2]}`;
    }
    const d = new Date(dateStr);
    if (!isNaN(d.getTime())) {
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, "0");
        return `${y}.${m}`;
    }
    return "";
}

/**
 * Sort trips by departure date with closest upcoming trip first, then recent past trips,
 * and trips without dates at the end.
 */
export function compareTripDates(
    dateA?: string | null,
    dateB?: string | null,
    referenceToday = getTodayIsoString(),
): number {
    // trim first: slicing a leading-space value to 10 chars would drop its last digit.
    const a = dateA?.trim().slice(0, 10);
    const b = dateB?.trim().slice(0, 10);

    if (!a && !b) return 0;
    if (!a) return 1;
    if (!b) return -1;

    const isFutureA = a >= referenceToday;
    const isFutureB = b >= referenceToday;

    if (isFutureA && isFutureB) {
        return a.localeCompare(b);
    }
    if (!isFutureA && !isFutureB) {
        return b.localeCompare(a);
    }
    return isFutureA ? -1 : 1;
}

/**
 * The UTC calendar day of a `Date` as YYYY-MM-DD -- for a Date that already
 * *means* a bare date, which is how js-yaml hands back an unquoted `2026-10-01`
 * (UTC midnight). `toLocalIsoDate` is for a Date meaning a local instant; west of
 * UTC the two disagree by a day, so the wrong one silently shifts every date.
 */
export function toUtcIsoDate(date: Date): string {
    const yyyy = date.getUTCFullYear();
    const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(date.getUTCDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
}

/** Shift a plain YYYY-MM-DD by whole days; plain date in, plain date out. */
export function addDaysIso(dateStr: string, days: number): string {
    const [y, m, d] = dateStr.split("-").map(Number);
    return toUtcIsoDate(new Date(Date.UTC(y, m - 1, d + days)));
}

/** ("2026-06-11", "2026-06-16") -> "2026.06.11 – 06.16" */
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
 * Reinsert `item` at `index`, clamped to the current bounds. For delete-undo: the
 * list can have changed while the toast was up, so the remembered index must be
 * allowed to be stale rather than throw.
 */
export function insertAtClamped<T>(arr: T[], index: number, item: T): T[] {
    const next = [...arr];
    next.splice(Math.min(Math.max(index, 0), next.length), 0, item);
    return next;
}

/**
 * Where Svelte's JS transitions and programmatic smooth scrolling ask about
 * reduced motion — app.css's media query only reaches CSS animations. Call it at
 * the point of use, not once at boot, so flipping the OS setting takes effect on
 * the next interaction.
 */
export function prefersReducedMotion(): boolean {
    if (typeof window === "undefined") return false;
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
