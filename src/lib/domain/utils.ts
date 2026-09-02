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
 * How long after its start date a trip still counts as current.
 *
 * A cloud trip record carries only `startDate`, never an end date, so "is it over" has
 * to be guessed from the start alone. A month is long enough to cover any trip a person
 * would plan with this app, which means the guess errs towards still showing a trip that
 * has in fact ended rather than folding away one the user is on.
 */
const TRIP_RECENCY_GRACE_DAYS = 30;

/**
 * Whether a trip started long enough ago to be certainly over — what the switcher folds
 * behind its "load earlier" row.
 *
 * An absent or unparseable date is NOT long past: a record that says nothing about when
 * it happened is the last thing that should disappear from a list.
 */
export function isTripLongPast(startDate?: string | null, referenceToday = getTodayIsoString()): boolean {
    const start = startDate?.trim().slice(0, 10);
    if (!start) return false;
    return start < addDaysIso(referenceToday, -TRIP_RECENCY_GRACE_DAYS);
}

/**
 * Sort trips by date: the one you are on or just back from first, then upcoming trips by
 * how soon, then older trips most-recent-first, and undated trips at the end.
 *
 * The leading group is `isTripLongPast`'s complement rather than `date >= today`, and
 * deliberately the same predicate the switcher folds by — otherwise a trip could be shown
 * as current and sorted as history at the same time. It is also the better answer on its
 * own: a trip that started last week outranks every future one, because you are probably
 * still on it.
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

    const isCurrentA = !isTripLongPast(a, referenceToday);
    const isCurrentB = !isTripLongPast(b, referenceToday);

    if (isCurrentA && isCurrentB) {
        return a.localeCompare(b);
    }
    if (!isCurrentA && !isCurrentB) {
        return b.localeCompare(a);
    }
    return isCurrentA ? -1 : 1;
}

/**
 * The UTC calendar day of a `Date` as YYYY-MM-DD -- for a Date built with
 * `Date.UTC` to *mean* a bare date, which is how the plain-date arithmetic below
 * avoids DST. `toLocalIsoDate` is for a Date meaning a local instant; west of UTC
 * the two disagree by a day, so the wrong one silently shifts every date.
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

/** Whole days from `fromIso` to `toIso` (negative when `toIso` is earlier); plain dates, so DST cannot make it fractional. */
export function daysBetweenIso(fromIso: string, toIso: string): number {
    const [y1, m1, d1] = fromIso.split("-").map(Number);
    const [y2, m2, d2] = toIso.split("-").map(Number);
    return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86_400_000);
}

/**
 * Whether a string that already matches YYYY-MM-DD names a real calendar day.
 * `Date` silently rolls `2026-02-30` over to March 2nd, so the check is a
 * round-trip through `Date.UTC` rather than a NaN test.
 */
export function isCalendarDate(iso: string): boolean {
    const [y, m, d] = iso.split("-").map(Number);
    return toUtcIsoDate(new Date(Date.UTC(y, m - 1, d))) === iso;
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
