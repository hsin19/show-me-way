import { eventStartMinutes } from "./timeline";
import {
    createRuntimeId,
    type DayItinerary,
    DEFAULT_DAY_TITLE,
    DEFAULT_PACE,
    type HotelInfo,
    type TimelineEvent,
    type TripData,
} from "./trip";
import {
    addDaysIso,
    daysBetweenIso,
} from "./utils";

/*
 * Edit mode works on a copy of the whole trip that the cards change in place: an input writes
 * straight into it, and inserting, removing or moving an entry is an array operation on it.
 * Nothing here touches storage; the copy is what gets saved, through `validateYaml`, once.
 *
 * An optional text cleared to nothing is removed, not kept as '', so a field left alone keeps
 * its bytes and a cleared one leaves the YAML. Blank rows in a list go on the way out
 * (`tidyDraft`), and so does an entry added and never filled in.
 */

/** `clock` times an event by `start` / `end`, past midnight included; `text` shows `time` as written. */
export type TimeMode = "text" | "clock";

export function timeModeOf(event: TimelineEvent): TimeMode {
    return event.start === undefined ? "text" : "clock";
}

/** `HH:mm` of an ISO value, or empty for a bare date or none. */
export function clockOf(iso: string | undefined): string {
    return iso?.split("T")[1] ?? "";
}

export function dateOf(iso: string | undefined): string {
    return iso?.slice(0, 10) ?? "";
}

/** Sets an optional text field, or removes it once cleared. */
export function setText<T extends object>(target: T, key: keyof T, value: string): void {
    if (value.trim()) (target as Record<keyof T, unknown>)[key] = value;
    else delete (target as Record<keyof T, unknown>)[key];
}

const CLOCK_SPAN = /^(\d{1,2}):(\d{2})(?:\s*[-–~～]\s*(\d{1,2}):(\d{2}))?/;

function clock(hours: string | undefined, minutes: string | undefined): string {
    // A time input holds no "25:30", the after-midnight notation, so that one is left to pick.
    if (hours === undefined || minutes === undefined || Number(hours) > 23 || Number(minutes) > 59) return "";
    return `${hours.padStart(2, "0")}:${minutes}`;
}

/** Switches how `event`, on `dayDate`, is timed, carrying what the fields it leaves say into the ones it moves to. */
export function setTimeMode(event: TimelineEvent, mode: TimeMode, dayDate: string): void {
    if (timeModeOf(event) === mode) return;
    if (mode === "text") {
        const start = clockOf(event.start);
        const end = clockOf(event.end);
        if (!event.time && start) event.time = end ? `${start} - ${end}` : start;
        delete event.start;
        delete event.end;
        return;
    }
    const match = CLOCK_SPAN.exec(event.time?.trim() ?? "");
    const start = clock(match?.[1], match?.[2]);
    setStartClock(event, start, dayDate);
    if (start) setEndClock(event, clock(match?.[3], match?.[4]));
    // The card shows `time` over `start`, so a text left behind would hide the time just set.
    delete event.time;
}

/** Keeps the start's date, or `dayDate` for an event that had none; an empty clock leaves the bare date. */
export function setStartClock(event: TimelineEvent, value: string, dayDate: string): void {
    const date = dateOf(event.start) || dayDate;
    event.start = value ? `${date}T${value}` : date;
}

/** On the start's date, or the next when it would come before the start, as a red-eye lands. */
export function setEndClock(event: TimelineEvent, value: string): void {
    const date = dateOf(event.start);
    if (!value || !date) {
        delete event.end;
        return;
    }
    const sameDay = `${date}T${value}`;
    event.end = sameDay < event.start! ? `${addDaysIso(date, 1)}T${value}` : sameDay;
}

/** `iso` on `date`, keeping its time of day; empty when the date is cleared. */
export function withDate(iso: string, date: string): string {
    const time = clockOf(iso);
    return date && time ? `${date}T${time}` : date;
}

/** `iso` at `value` o'clock, or its bare date when the clock is cleared. */
export function withClock(iso: string, value: string): string {
    const date = dateOf(iso);
    return date && value ? `${date}T${value}` : date;
}

/** Why `event` would not save, in zh-TW, or null. */
export function eventIssue(event: TimelineEvent): string | null {
    if (!event.title.trim()) return "標題不能空白";
    if (timeModeOf(event) === "text") return event.time?.trim() ? null : "時間不能空白";
    if (event.end !== undefined && event.end < event.start!) return "結束時間早於開始時間";
    return null;
}

/** Why `hotel` would not save, in zh-TW, or null. */
export function hotelIssue(hotel: HotelInfo): string | null {
    if (!hotel.title.trim()) return "名稱不能空白";
    if (!hotel.start || !hotel.end) return "請填入住和退房日期";
    if (hotel.end < hotel.start) return "退房早於入住";
    return null;
}

export function newEvent(dayDate: string): TimelineEvent {
    return { _id: createRuntimeId("ev"), start: dayDate, title: "" };
}

export function newHotel(checkIn: string): HotelInfo {
    return { title: "", start: checkIn, end: addDaysIso(checkIn, 1) };
}

/** Swaps the entry at `index` with its neighbour above (-1) or below (1); nothing at either end. */
export function moveItem<T>(list: T[], index: number, delta: -1 | 1): void {
    const to = index + delta;
    if (to < 0 || to >= list.length) return;
    [list[index], list[to]] = [list[to]!, list[index]!];
}

/**
 * Moves the event at `index` to where its start belongs, unless it still fits between its
 * timed neighbours: an order the user arranged by hand stays. Untimed events never decide
 * where it goes, as the author's order is the only one they have.
 */
export function settleEvent(timeline: TimelineEvent[], index: number, dayDate: string): void {
    const event = timeline[index]!;
    const minutes = eventStartMinutes(event, dayDate);
    if (minutes === null) return;
    const starts = timeline.map(other => eventStartMinutes(other, dayDate));
    const previous = starts.slice(0, index).findLast(start => start !== null) ?? -Infinity;
    const following = starts.slice(index + 1).find(start => start !== null) ?? Infinity;
    if (minutes >= previous && minutes <= following) return;
    timeline.splice(index, 1);
    starts.splice(index, 1);
    const later = starts.findIndex(start => (start ?? -1) > minutes);
    timeline.splice(later === -1 ? timeline.length : later, 0, event);
}

/**
 * `days` covering `start`–`end`: a day outside goes, a date with no day gets a free one, as
 * a gap between two authored days does when the trip loads. Numbered for the day strip;
 * `normalizeTripData` numbers them again on save.
 */
export function resizeDays(days: DayItinerary[], start: string, end: string): DayItinerary[] {
    const byDate = new Map(days.map(day => [day.date, day]));
    const resized: DayItinerary[] = [];
    for (let date = start; date <= end; date = addDaysIso(date, 1)) {
        resized.push(byDate.get(date) ?? { day: 0, date, title: DEFAULT_DAY_TITLE, timeline: [], pace: DEFAULT_PACE });
    }
    resized.forEach((day, index) => day.day = index + 1);
    return resized;
}

/**
 * Moves the event at `index` of `from` onto `to`. Its `start` / `end` shift by as many days,
 * so it keeps its time of day and stays on its day (or past midnight into the next) as
 * validation requires; there it goes where that time belongs.
 */
export function moveEventToDay(from: DayItinerary, index: number, to: DayItinerary): void {
    const [event] = from.timeline.splice(index, 1);
    if (!event) return;
    const days = daysBetweenIso(from.date, to.date);
    for (const key of ["start", "end"] as const) {
        const value = event[key];
        if (value) event[key] = addDaysIso(dateOf(value), days) + value.slice(10);
    }
    to.timeline.push(event);
    settleEvent(to.timeline, to.timeline.length - 1, to.date);
}

/** Every Drive file `trip` links to: its events', its hotels' and its own attachments. */
export function attachmentIds(trip: TripData): Set<string> {
    const entries = [...trip.days.flatMap(day => day.timeline), ...trip.trip.hotels];
    return new Set([...entries.flatMap(entry => entry.attachments ?? []), ...(trip.trip.attachments ?? [])].map(attachment => attachment.fileId));
}

function isBlank(value: unknown): boolean {
    if (typeof value === "string") return !value.trim();
    if (Array.isArray(value)) return value.every(isBlank);
    if (value && typeof value === "object") return Object.values(value).every(isBlank);
    return value === undefined;
}

const LISTS = ["bullets", "stops", "links", "attachments", "alternatives"] as const;

function tidyLists(entry: TimelineEvent | HotelInfo): void {
    for (const key of LISTS) {
        const list = entry[key] as unknown[] | undefined;
        if (!list) continue;
        const kept = list.filter(item => !isBlank(item));
        if (kept.length === 0) delete entry[key];
        else if (kept.length < list.length) (entry as Record<string, unknown>)[key] = kept;
    }
}

/** Nothing written in it but its place on the timeline: an event added and left empty. */
function isUnwritten(entry: TimelineEvent | HotelInfo): boolean {
    return isBlank({ ...entry, _id: undefined, type: undefined, status: undefined, start: clockOf(entry.start), end: clockOf(entry.end) });
}

/** Drops blank list rows and entries added but never written in, before `draft` is checked and saved. */
export function tidyDraft(draft: TripData): void {
    for (const day of draft.days) {
        day.timeline = day.timeline.filter(event => !isUnwritten(event));
        day.timeline.forEach(tidyLists);
    }
    draft.trip.hotels = draft.trip.hotels.filter(hotel => !isUnwritten(hotel));
    draft.trip.hotels.forEach(tidyLists);
    if (draft.trip.attachments) {
        draft.trip.attachments = draft.trip.attachments.filter(item => !isBlank(item));
        if (draft.trip.attachments.length === 0) delete draft.trip.attachments;
    }
}
