import { eventStartMinutes } from "./timeline";
import type { TimelineEvent } from "./trip";
import { addDaysIso } from "./utils";

/*
 * The fields edit mode puts on an event card and how they land back on the event. The form
 * covers what a phone mid-trip changes — the title, the time, the description, the address —
 * and every other field rides along untouched. So does any field the form shows but the user
 * left alone: a multi-line `desc` read back from an input would lose its trailing newline,
 * and an event saved unchanged has to serialize to the same bytes or it reads as an edit.
 *
 * `start` and `end` are edited as a time of day only; their dates stay, since moving an
 * event to another day is a move, not an edit.
 */

/** `text` shows `time` as written; `clock` times the event by `start` / `end`, past midnight included. */
export type TimeMode = "text" | "clock";

/** Every value as an input holds it; `start` / `end` are `HH:mm`, or empty. */
export interface EventForm {
    title: string;
    mode: TimeMode;
    time: string;
    start: string;
    end: string;
    desc: string;
    address: string;
}

function clockOf(iso: string | undefined): string {
    return iso?.split("T")[1] ?? "";
}

export function eventFormOf(event: TimelineEvent): EventForm {
    return {
        title: event.title,
        mode: event.start === undefined ? "text" : "clock",
        time: event.time ?? "",
        start: clockOf(event.start),
        end: clockOf(event.end),
        desc: event.desc ?? "",
        address: event.address ?? "",
    };
}

export function isFormDirty(event: TimelineEvent, form: EventForm): boolean {
    const before = eventFormOf(event);
    return (Object.keys(before) as (keyof EventForm)[]).some(key => form[key] !== before[key]);
}

const CLOCK_SPAN = /^(\d{1,2}):(\d{2})(?:\s*[-–~～]\s*(\d{1,2}):(\d{2}))?/;

function clock(hours: string | undefined, minutes: string | undefined): string {
    // A time input holds no "25:30", the after-midnight notation, so that one is left to pick.
    if (hours === undefined || minutes === undefined || Number(hours) > 23 || Number(minutes) > 59) return "";
    return `${hours.padStart(2, "0")}:${minutes}`;
}

/** Switches `form` to `mode`, carrying what the fields it leaves say into the empty ones it moves to. */
export function setTimeMode(form: EventForm, mode: TimeMode): void {
    if (form.mode === mode) return;
    form.mode = mode;
    if (mode === "text") {
        if (!form.time && form.start) form.time = form.end ? `${form.start} - ${form.end}` : form.start;
        return;
    }
    if (form.start || form.end) return;
    const match = CLOCK_SPAN.exec(form.time.trim());
    form.start = clock(match?.[1], match?.[2]);
    form.end = form.start ? clock(match?.[3], match?.[4]) : "";
}

/**
 * `event`, which sits on `dayDate`, with `form` applied. Throws a zh-TW message for a form
 * that would not make a valid event.
 */
export function applyEventForm(event: TimelineEvent, form: EventForm, dayDate: string): TimelineEvent {
    const before = eventFormOf(event);
    const next: TimelineEvent = { ...event };
    for (const key of ["title", "desc", "address"] as const) {
        if (form[key] === before[key]) continue;
        const value = form[key].trim();
        if (key === "title") next.title = value;
        else if (value) next[key] = value;
        else delete next[key];
    }
    if (!next.title) throw new Error("標題不能空白");

    const switched = form.mode !== before.mode;
    if (form.mode === "text") {
        if (switched || form.time !== before.time) {
            next.time = form.time.trim();
            if (!next.time) throw new Error("時間不能空白");
        }
        if (switched) {
            delete next.start;
            delete next.end;
        }
    } else if (switched || form.start !== before.start || form.end !== before.end) {
        if (!form.start) throw new Error("請選開始時間");
        const date = event.start?.slice(0, 10) ?? dayDate;
        next.start = `${date}T${form.start}`;
        if (form.end) {
            // A new end before its start is past midnight, as a red-eye lands; an existing one keeps the date it has.
            let end = `${event.end?.slice(0, 10) ?? date}T${form.end}`;
            if (event.end === undefined && end < next.start) end = `${addDaysIso(date, 1)}T${form.end}`;
            if (end < next.start) throw new Error("結束時間早於開始時間");
            next.end = end;
        } else if (before.end) {
            delete next.end;
        }
        // The card shows `time` over `start`, so a text left behind would hide the time just set.
        delete next.time;
    }
    return next;
}

/**
 * Puts `next` in place of the event at `index`. It stays there unless its start changed and
 * no longer fits between its timed neighbours; then it goes before the first event that
 * starts later, or last. Untimed events never decide where it goes: the author's order is
 * the only order they have.
 */
export function placeEditedEvent(timeline: TimelineEvent[], index: number, next: TimelineEvent, dayDate: string): void {
    const minutes = eventStartMinutes(next, dayDate);
    const moved = minutes !== null && minutes !== eventStartMinutes(timeline[index]!, dayDate);
    timeline.splice(index, 1);
    let at = index;
    if (moved) {
        const starts = timeline.map(event => eventStartMinutes(event, dayDate));
        const previous = starts.slice(0, index).findLast(start => start !== null) ?? -Infinity;
        const following = starts.slice(index).find(start => start !== null) ?? Infinity;
        if (minutes < previous || minutes > following) {
            const later = starts.findIndex(start => (start ?? -1) > minutes);
            at = later === -1 ? timeline.length : later;
        }
    }
    timeline.splice(at, 0, next);
}
