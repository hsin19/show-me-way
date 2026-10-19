import { dump as dumpYaml } from "js-yaml";
import { parseEventStartMinutes } from "./timeline";
import {
    parseYaml,
    serializeToYaml,
    validateYaml,
} from "./trip";
import { ENTRY_FIELDS } from "./trip-schema";
import {
    addDaysIso,
    daysBetweenIso,
    isCalendarDate,
} from "./utils";

/*
 * The AI's changes to a trip as targeted edits rather than a rewritten document: the model
 * names what to change and this applies it. A whole-document reply ran to tens of thousands
 * of tokens — slow enough to drop on a phone's connection — and any field the model failed
 * to copy back was silently gone. Here what an edit does not mention cannot change.
 *
 * Targets are found by what the model reads off the YAML: a day by its `date`, an event by
 * that date plus its `title`, a hotel by its `title`, a checklist item by its `text` — the
 * whole value or any opening that only one entry has, since copying a long todo back word
 * for word is most of what a model writes. Edits apply in order, each to the result of the
 * one before, and all or none: the first that does not land throws, naming it.
 *
 * A field the schema does not know is refused rather than left to `validateYaml`, which
 * would drop it without a word and leave an edit that changes nothing; so is a batch that
 * changes nothing at all. The result is validated in full and returned canonical, so callers
 * treat it as any other incoming YAML.
 */

const OP_LABELS = {
    update_event: "修改事件",
    add_event: "新增事件",
    remove_event: "刪除事件",
    move_event: "搬移事件",
    update_day: "修改當天資訊",
    add_day: "新增一天",
    remove_day: "刪除一天",
    update_hotel: "修改住宿",
    add_hotel: "新增住宿",
    remove_hotel: "刪除住宿",
    update_trip: "修改行程資訊",
    add_item: "新增清單項目",
    update_item: "修改清單項目",
    remove_item: "刪除清單項目",
} as const;

export type EditOp = keyof typeof OP_LABELS;

export const EDIT_OPS = Object.keys(OP_LABELS) as EditOp[];

export interface ItineraryEdit {
    /** Unchecked: it comes from the model, and an op this module does not know is reported as such. */
    op: string;
    /** The day an event is on now, or a day's own date; for a hotel, its check-in date when the title alone is ambiguous. */
    date?: string;
    /** An event's or hotel's current title, or an opening of it only one has. */
    title?: string;
    list?: string;
    /** A checklist item's current text, or an opening of it only one item has. */
    text?: string;
    toDate?: string;
    /** The title of the event a new or moved one goes after; without it, the event is placed by its time. */
    after?: string;
    /** A YAML mapping, string or already parsed: the whole new entry for `add_*`, the fields to change for `update_*` (null removes one). */
    yaml?: unknown;
}

type Mapping = Record<string, unknown>;

interface Doc {
    trip: Mapping & { hotels: Mapping[]; };
    days: (Mapping & { date: string; timeline: Mapping[]; })[];
    todo?: Mapping[];
    packing?: Mapping[];
}

function isMapping(value: unknown): value is Mapping {
    return !!value && typeof value === "object" && !Array.isArray(value);
}

function fragment(edit: ItineraryEdit, kind: keyof typeof ENTRY_FIELDS): Mapping {
    let value = edit.yaml;
    if (typeof value === "string") {
        try {
            value = parseYaml(value);
        } catch (e) {
            throw new Error(`yaml 格式有誤（${(e instanceof Error ? e.message : String(e)).split("\n")[0]}）`, { cause: e });
        }
    }
    if (!isMapping(value)) throw new Error("yaml 要是一組「欄位: 值」");
    const known = ENTRY_FIELDS[kind];
    const unknown = Object.keys(value).find(key => !known.includes(key));
    if (unknown) throw new Error(`不認得「${unknown}」這個欄位（可用的有 ${known.join("、")}）`);
    return value;
}

/** Sets each of `fields` on `target`: a value replaces the field whole, arrays included, and null removes it. */
function merge(target: Mapping, fields: Mapping, refused: readonly string[] = []): void {
    const keys = Object.keys(fields);
    if (keys.length === 0) throw new Error("沒有要改的欄位");
    for (const key of keys) {
        if (refused.includes(key)) throw new Error(`${key} 不能用這項修改改`);
        if (fields[key] === null) delete target[key];
        else target[key] = fields[key];
    }
}

function required(value: string | undefined, name: string): string {
    const trimmed = value?.trim();
    if (!trimmed) throw new Error(`缺少 ${name}`);
    return trimmed;
}

function findDay(doc: Doc, date: string | undefined) {
    const wanted = required(date, "date");
    const day = doc.days.find(d => d.date === wanted);
    if (!day) throw new Error(`行程裡沒有 ${wanted} 這一天`);
    return day;
}

function findOne(items: Mapping[], key: string, value: string, where: string): number {
    const matching = (test: (field: string) => boolean) =>
        items.flatMap((item, index) => {
            const field = item[key];
            return typeof field === "string" && test(field.trim()) ? [index] : [];
        });
    const exact = matching(field => field === value);
    if (exact.length > 1) throw new Error(`${where}有 ${exact.length} 個「${value}」，對不到是哪一個`);
    if (exact.length === 1) return exact[0]!;
    const opening = matching(field => field.startsWith(value));
    if (opening.length > 1) throw new Error(`${where}有 ${opening.length} 個以「${value}」開頭的，對不到是哪一個`);
    if (opening.length === 0) throw new Error(`${where}找不到「${value}」`);
    return opening[0]!;
}

function findEvent(doc: Doc, edit: ItineraryEdit) {
    const day = findDay(doc, edit.date);
    return { day, index: findOne(day.timeline, "title", required(edit.title, "title"), `${day.date} `) };
}

function findHotel(doc: Doc, edit: ItineraryEdit): number {
    const title = required(edit.title, "title");
    const checkIn = edit.date?.trim();
    const hotels = checkIn ? doc.trip.hotels.filter(h => typeof h.start === "string" && h.start.startsWith(checkIn)) : doc.trip.hotels;
    const index = findOne(hotels, "title", title, checkIn ? `${checkIn} 入住的住宿裡` : "住宿裡");
    return doc.trip.hotels.indexOf(hotels[index]!);
}

function checklist(doc: Doc, list: string | undefined): Mapping[] {
    if (list !== "todo" && list !== "packing") throw new Error("list 要是 todo 或 packing");
    return (doc[list] ??= []);
}

/** Minutes past the day's midnight an event starts at, for placing one that names no neighbour. */
function startMinutes(event: Mapping): number | null {
    const start = typeof event.start === "string" ? event.start : "";
    if (start.includes("T")) return parseEventStartMinutes(start.slice(11));
    return typeof event.time === "string" ? parseEventStartMinutes(event.time) : null;
}

function insertEvent(timeline: Mapping[], event: Mapping, after: string | undefined, date: string): void {
    const neighbour = after?.trim();
    if (neighbour) {
        timeline.splice(findOne(timeline, "title", neighbour, `${date} `) + 1, 0, event);
        return;
    }
    const minutes = startMinutes(event);
    const later = minutes === null ? -1 : timeline.findIndex(other => (startMinutes(other) ?? -1) > minutes);
    if (later === -1) timeline.push(event);
    else timeline.splice(later, 0, event);
}

/** Moves an event's `start` / `end` with it, which would otherwise fail validation on its new day. */
function shiftDates(event: Mapping, days: number): void {
    for (const key of ["start", "end"]) {
        const value = event[key];
        if (typeof value === "string" && isCalendarDate(value.slice(0, 10))) event[key] = addDaysIso(value.slice(0, 10), days) + value.slice(10);
    }
}

function applyOne(doc: Doc, edit: ItineraryEdit): void {
    switch (edit.op) {
        case "update_event": {
            const { day, index } = findEvent(doc, edit);
            merge(day.timeline[index]!, fragment(edit, "event"));
            return;
        }
        case "add_event": {
            const day = findDay(doc, edit.date);
            insertEvent(day.timeline, fragment(edit, "event"), edit.after, day.date);
            return;
        }
        case "remove_event": {
            const { day, index } = findEvent(doc, edit);
            day.timeline.splice(index, 1);
            return;
        }
        case "move_event": {
            const { day, index } = findEvent(doc, edit);
            const target = findDay(doc, edit.toDate);
            const [event] = day.timeline.splice(index, 1);
            shiftDates(event!, daysBetweenIso(day.date, target.date));
            insertEvent(target.timeline, event!, edit.after, target.date);
            return;
        }
        case "update_day":
            merge(findDay(doc, edit.date), fragment(edit, "day"), ["timeline"]);
            return;
        case "add_day": {
            const day = fragment(edit, "day");
            if (typeof day.date !== "string") throw new Error("缺少 date");
            doc.days.push({ ...day, date: day.date, timeline: (day.timeline ?? []) as Mapping[] });
            return;
        }
        case "remove_day": {
            const day = findDay(doc, edit.date);
            doc.days.splice(doc.days.indexOf(day), 1);
            return;
        }
        case "update_hotel":
            merge(doc.trip.hotels[findHotel(doc, edit)]!, fragment(edit, "hotel"));
            return;
        case "add_hotel":
            doc.trip.hotels.push(fragment(edit, "hotel"));
            return;
        case "remove_hotel":
            doc.trip.hotels.splice(findHotel(doc, edit), 1);
            return;
        case "update_trip":
            // The id binds the trip to its Drive file and links; hotels have edits of their own.
            merge(doc.trip, fragment(edit, "trip"), ["id", "hotels"]);
            return;
        case "add_item":
            checklist(doc, edit.list).push(edit.yaml === undefined ? { text: required(edit.text, "text") } : fragment(edit, "item"));
            return;
        case "update_item": {
            const items = checklist(doc, edit.list);
            merge(items[findOne(items, "text", required(edit.text, "text"), "清單裡")]!, fragment(edit, "item"));
            return;
        }
        case "remove_item": {
            const items = checklist(doc, edit.list);
            items.splice(findOne(items, "text", required(edit.text, "text"), "清單裡"), 1);
            return;
        }
        default:
            throw new Error(`不認得「${edit.op}」這種修改`);
    }
}

/** At most this many characters of a target's title or text, in `describeEdits`. */
const TARGET_PREVIEW = 30;

/**
 * The edits in one line for the model to read back on a later turn: what each one touched
 * and which fields it set, not the values — those it can read off the trip it is sent.
 */
export function describeEdits(edits: readonly ItineraryEdit[]): string {
    return edits.map(edit => {
        let fields: Mapping | null = null;
        try {
            const parsed = typeof edit.yaml === "string" ? parseYaml(edit.yaml) : edit.yaml;
            if (isMapping(parsed)) fields = parsed;
        } catch {
            // Described without its fields; the edit itself was judged where it was applied.
        }
        const named = edit.title ?? edit.text ?? fields?.title ?? fields?.text;
        const target = typeof named === "string" && named.trim()
            ? `「${named.length > TARGET_PREVIEW ? `${named.slice(0, TARGET_PREVIEW)}…` : named}」`
            : "";
        const changed = edit.op.startsWith("update_") && fields ? `改了 ${Object.keys(fields).join("、")}` : "";
        // Spaced between words, but not against the 「」, as Chinese is written.
        return [[edit.op, edit.list, edit.date].filter(Boolean).join(" "), target, edit.toDate && `→ ${edit.toDate}`, changed]
            .filter((part): part is string => !!part)
            .reduce((line, part) => (line.endsWith("」") || part.startsWith("「") ? line + part : `${line} ${part}`));
    }).join("；");
}

/**
 * `baseYaml` with `edits` applied, canonical. Throws a zh-TW message: which edit did not
 * land and why, or what the edited trip fails validation on.
 */
export function applyItineraryEdits(baseYaml: string, edits: readonly ItineraryEdit[]): string {
    if (edits.length === 0) throw new Error("AI 沒有給出任何修改");
    const doc = parseYaml(baseYaml) as Doc;
    edits.forEach((edit, i) => {
        try {
            applyOne(doc, edit);
        } catch (e) {
            const label = (OP_LABELS as Record<string, string>)[edit.op] ?? edit.op;
            throw new Error(`第 ${i + 1} 項修改（${label}）沒辦法套用：${e instanceof Error ? e.message : String(e)}`, { cause: e });
        }
    });
    const edited = serializeToYaml(validateYaml(dumpYaml(doc, { lineWidth: -1, noRefs: true })));
    if (edited === serializeToYaml(validateYaml(baseYaml))) throw new Error("這些修改沒有改到行程的任何地方");
    return edited;
}
