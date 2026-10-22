import { SCHEMA_URL } from "$lib/config";
import {
    dump as dumpYaml,
    loadAll as loadYamlDocuments,
    YAMLException,
} from "js-yaml";
import { safeParse } from "valibot";
import {
    formatEventMinutes,
    parseEventStartMinutes,
} from "./timeline";
import { describeIssue } from "./trip-issues";
import {
    type ChecklistItem,
    type ItineraryDocument,
    itinerarySchema,
    type TimelineEvent,
} from "./trip-schema";
import {
    addDaysIso,
    daysBetweenIso,
    isCalendarDate,
    isCalendarDateTime,
} from "./utils";

export type { Attachment, ChecklistItem, HotelInfo, TimelineEvent } from "./trip-schema";

type AuthoredDay = ItineraryDocument["days"][number];

export interface DayItinerary extends Omit<AuthoredDay, "pace" | "timeline"> {
    /** Derived: 1-based position after `normalizeTripData` sorts and gap-fills by date. Never authored, never serialized. */
    day: number;
    /** `DEFAULT_PACE` when the author leaves it out. */
    pace: string;
    timeline: TimelineEvent[];
}

type TripInfo = Omit<ItineraryDocument["trip"], "id"> & {
    /**
     * The trip's own identity, minted by `normalizeTripData` when absent and — unlike
     * the derived fields below — kept in the saved YAML, so it travels with an export,
     * a share link and the Drive copy. That is what lets a device that has lost its
     * local sync state work out which cloud file is this trip again.
     *
     * Machine-managed: never authored, never edited by hand, and never regenerated for
     * a trip that already has one. A trip that loses it becomes a stranger to its own
     * Drive file, so every path that rewrites the whole document (the AI editor) has to
     * carry it across.
     */
    id: string;
    /**
     * Derived from `days`, not authored: the first and last dates present, and
     * day 1's first event as the countdown target. Always set on a loaded trip
     * and always absent from saved YAML -- see `normalizeTripData`.
     */
    start: string; // YYYY-MM-DD
    end: string; // YYYY-MM-DD
    departure: string; // local date-time, e.g. 2026-06-11T14:00:00
};

export interface TripData {
    trip: TripInfo;
    todo: ChecklistItem[];
    packing: ChecklistItem[];
    days: DayItinerary[];
}

/**
 * A fresh identity for a trip or a profile slot. The fallback covers a non-secure context,
 * where `crypto.randomUUID` is undefined; uniqueness within one device is all either use
 * needs.
 */
export function genTripId(): string {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
        return crypto.randomUUID();
    }
    return `t-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

const SCHEMA_LINE = `# yaml-language-server: $schema=${SCHEMA_URL}\n`;

let runtimeIdSeq = 0;

function attachRuntimeIds(data: TripData): TripData {
    for (const day of data.days) {
        for (const ev of day.timeline) {
            ev._id = `ev-${runtimeIdSeq++}`;
        }
    }
    for (const item of data.todo) {
        item._id = `todo-${runtimeIdSeq++}`;
    }
    for (const item of data.packing) {
        item._id = `pack-${runtimeIdSeq++}`;
    }
    return data;
}

/**
 * `loadAll` rather than `load`: on an empty or comment-only stream (the editor
 * cleared down to the `$schema` modeline) `load` throws its own English message,
 * bypassing the zh-TW ones below. `loadAll` reports that as `[]` instead, so the
 * wording stays this module's.
 */
export function parseYaml(yaml: string): unknown {
    const docs = loadYamlDocuments(yaml, null, { maxAliases: 100 });
    if (docs.length > 1) throw new Error("YAML 只能包含一份行程 (請移除多餘的 --- 文件分隔)");
    return docs[0];
}

/** Title and pace of a gap day the author skipped, and the pace fallback for a day that omits it. */
const DEFAULT_DAY_TITLE = "自由活動";
const DEFAULT_PACE = "自由安排行程";

/**
 * Every skipped date between two authored days becomes a free day, so a year
 * typed as 2062 would mint thirteen thousand of them and — because the gap days
 * are persisted — write them all into the YAML on the next save. No real trip
 * leaves a gap this long between two days it bothers to describe.
 */
const MAX_DAY_GAP = 90;

/**
 * A `desc:` with nothing after it parses to `null`, and the app has always read
 * that as "absent" — blank for an optional field, "missing" for a required one.
 * Deleting those keys up front lets the schema stay `optional()` and its types
 * `string | undefined`. List elements are left alone: a bare `- ` is a mistake
 * worth naming (「不可為空白列表項」).
 */
function dropNullFields(value: unknown): void {
    if (Array.isArray(value)) {
        for (const item of value) dropNullFields(item);
        return;
    }
    if (!value || typeof value !== "object") return;
    const record = value as Record<string, unknown>;
    for (const key of Object.keys(record)) {
        if (record[key] === null) delete record[key];
        else dropNullFields(record[key]);
    }
}

/** A hotel's older field names, by the event field each now is. `trip:validate` reports them as renamed, not dropped. */
export const LEGACY_HOTEL_FIELDS = { name: "title", checkIn: "start", checkOut: "end" } as const;

/**
 * Read a hotel's older field names as the event's, so YAML written with them — on a phone,
 * in a backup, behind a share link someone else holds — still loads instead of failing on
 * a missing required field. The next save writes the new names, and the old ones leave
 * with the other unknown keys.
 */
function adoptLegacyHotelFields(trip: unknown): void {
    const hotels = (trip as { hotels?: unknown; }).hotels;
    if (!Array.isArray(hotels)) return;
    for (const hotel of hotels) {
        if (!hotel || typeof hotel !== "object") continue;
        const record = hotel as Record<string, unknown>;
        for (const [legacy, current] of Object.entries(LEGACY_HOTEL_FIELDS)) {
            if (!(current in record) && legacy in record) record[current] = record[legacy];
        }
    }
}

/**
 * What the schema cannot say about an item's `start` / `end`: a value on the calendar and
 * the clock, an `end` that has a `start` and does not precede it. ISO strings compare as
 * times, and a bare date reads as that day's midnight.
 */
function checkSpan(where: string, item: { start?: string; end?: string; }): void {
    for (const field of ["start", "end"] as const) {
        const value = item[field];
        if (value !== undefined && !isCalendarDateTime(value)) throw new Error(`${where}的 ${field} 不是有效的日期或時間 (${value})`);
    }
    if (item.end === undefined) return;
    if (item.start === undefined) throw new Error(`${where}有 end 卻缺少 start 屬性`);
    if (item.end < item.start) throw new Error(`${where}的 end (${item.end}) 早於 start (${item.start})`);
}

/**
 * The countdown target: day 1's first event, at local midnight when that event
 * carries no usable time.
 * Deliberately offset-free -- the trip's own timezone is where the user reads it.
 */
function deriveDeparture(firstDay: DayItinerary): string {
    const first = firstDay.timeline[0];
    if (first?.start?.includes("T")) return `${first.start}:00`;
    const minutes = parseEventStartMinutes(first?.time ?? "") ?? 0;
    const wrapped = minutes % (24 * 60);
    return `${firstDay.date}T${formatEventMinutes(wrapped)}:00`;
}

/**
 * Sort the authored days by date and reject what the schema cannot see: a date
 * that passes the pattern but is not on the calendar, two days on the same date,
 * and a gap wide enough to be a typo. Indices in the messages are the author's
 * order, which is the order the editor shows.
 */
function sortAuthoredDays(days: readonly AuthoredDay[]): AuthoredDay[] {
    const ordered = days.map((day, index) => ({ day, index }));
    for (const { day, index } of ordered) {
        if (!isCalendarDate(day.date)) throw new Error(`days 第 ${index + 1} 項的 date 不是有效的日期 (${day.date})`);
    }
    ordered.sort((a, b) => a.day.date.localeCompare(b.day.date));
    for (let i = 1; i < ordered.length; i++) {
        const prev = ordered[i - 1]!;
        const cur = ordered[i]!;
        if (prev.day.date === cur.day.date) {
            throw new Error(`days 第 ${prev.index + 1} 項與第 ${cur.index + 1} 項的 date 重複 (${cur.day.date})`);
        }
        const gap = daysBetweenIso(prev.day.date, cur.day.date);
        if (gap > MAX_DAY_GAP) {
            throw new Error(`days 第 ${prev.index + 1} 項 (${prev.day.date}) 與第 ${cur.index + 1} 項 (${cur.day.date}) 相隔 ${gap} 天，超過 ${MAX_DAY_GAP} 天的上限，請確認日期是否打錯`);
        }
    }
    return ordered.map(entry => entry.day);
}

/**
 * The only real gate on itinerary data; its zh-TW messages are shown to the user
 * verbatim. `itinerarySchema` checks the shape and strips keys it does not know,
 * so a misspelt field disappears on the next save rather than travelling along
 * — the generated JSON Schema is where the editor points it out.
 */
function normalizeTripData(raw: unknown): TripData {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("YAML 內容為空或格式不正確");
    dropNullFields(raw);
    // Before the schema runs, so a file with no `days` hears that rather than the first nit inside `trip`.
    const outline = raw as { trip?: unknown; days?: unknown; };
    if (!outline.trip || !Array.isArray(outline.days)) throw new Error("YAML 缺少必要的結構 (trip 或 days 區塊)");
    adoptLegacyHotelFields(outline.trip);
    const parsed = safeParse(itinerarySchema, raw, { abortEarly: true });
    if (!parsed.success) throw new Error(describeIssue(parsed.issues[0]));
    const doc = parsed.output;

    for (const [i, hotel] of doc.trip.hotels.entries()) checkSpan(`hotels 第 ${i + 1} 項`, hotel);
    for (const [d, day] of doc.days.entries()) {
        for (const [e, event] of day.timeline.entries()) {
            const where = `days 第 ${d + 1} 項的 timeline 第 ${e + 1} 項`;
            if (event.time === undefined && event.start === undefined) throw new Error(`${where}缺少 time 或 start 屬性`);
            checkSpan(where, event);
            // On its day or past midnight into the next, as "25:30" may be. Anything further is
            // a typo — a wrong year — that would otherwise show as "08:00 -365", count as
            // started since midnight and, on day 1, set a departure already behind us. An
            // invalid `day.date` is left for `sortAuthoredDays` to name.
            const startDate = event.start?.slice(0, 10);
            if (startDate && isCalendarDate(day.date) && startDate !== day.date && startDate !== addDaysIso(day.date, 1)) {
                throw new Error(`${where}的 start (${event.start}) 要在當天 (${day.date}) 或隔天`);
            }
        }
    }

    const filledDays: DayItinerary[] = [];
    let cursor: string | null = null;
    for (const authored of sortAuthoredDays(doc.days)) {
        // `pace` goes last on every day — gap-filled, authored or defaulted — because a saved
        // gap day comes back as an authored one, and a key that moved would make the next
        // save's bytes differ from this one's: storage holds only canonical bytes, so
        // serializeToYaml ∘ validateYaml has to be a fixpoint.
        while (cursor !== null && cursor < authored.date) {
            filledDays.push({ day: 0, date: cursor, title: DEFAULT_DAY_TITLE, timeline: [], pace: DEFAULT_PACE });
            cursor = addDaysIso(cursor, 1);
        }
        const { pace, ...rest } = authored;
        filledDays.push({ day: 0, ...rest, pace: pace ?? DEFAULT_PACE });
        cursor = addDaysIso(authored.date, 1);
    }
    filledDays.forEach((day, index) => day.day = index + 1);

    // `id` sits right after `name` whether authored or minted, for the same round-trip stability as `pace`.
    const { name, id, ...rest } = doc.trip;
    const firstDay = filledDays[0]!;
    const lastDay = filledDays[filledDays.length - 1]!;
    const trip: TripInfo = {
        name,
        id: id?.trim() || genTripId(),
        ...rest,
        start: firstDay.date,
        end: lastDay.date,
        departure: deriveDeparture(firstDay),
    };

    const normalized: TripData = {
        trip,
        days: filledDays,
        todo: doc.todo ?? [],
        packing: doc.packing ?? [],
    };

    return attachRuntimeIds(normalized);
}

/**
 * The YAML written to storage, share links and Drive. Canonicalization rather
 * than a round-trip: array order survives, comments and hand-authored key order
 * do not, and every key the schema does not declare is already gone by the time
 * data reaches here. Every save path comes through — a checklist toggle included.
 */
export function serializeToYaml(data: TripData): string {
    // JSON, not structuredClone: the latter throws on the $state proxy this is handed
    // in the browser, and the unit tests (plain objects) would never notice the swap.
    const clean = JSON.parse(JSON.stringify(data)) as TripData;
    const trip = clean.trip as Partial<TripInfo>;
    // The derived fields go; `trip.id` stays. It is the trip's identity, not a restatement
    // of its contents — Drive's `appProperties.showmewayTripId` is this value, and stripping
    // it would mint a new one on the next load and orphan that cloud file.
    delete trip.start;
    delete trip.end;
    delete trip.departure;
    for (const day of clean.days) {
        delete (day as { day?: number; }).day;
        for (const ev of day.timeline) {
            delete ev._id;
        }
    }
    for (const item of [...clean.todo, ...clean.packing]) {
        delete item._id;
        // Unchecked is the default, and an item ticked and unticked again must be the same
        // bytes as one never ticked — the sync record compares bytes, not meaning.
        if (!item.checked) delete item.checked;
    }

    const body = dumpYaml(clean, {
        lineWidth: -1,
        quoteStyle: "single",
        forceQuotes: false,
        noRefs: true,
    });

    return SCHEMA_LINE + body;
}

/**
 * `data` as the trip `id` it replaces in place — a Drive pull, a shared update taken, an AI
 * edit, a download into trip:sync's working copy. In place means the same trip, so it keeps
 * that id whatever the document says: one dropped by a hand edit, never written by the
 * sender, or changed by the model must not cut the trip loose from its Drive file and links.
 */
export function asSameTrip(data: TripData, id: string): TripData {
    data.trip.id = id;
    return data;
}

/**
 * `to` with `from`'s runtime ids, entry by entry, for a trip validated from `from`'s own
 * serialization: that keeps every day, event and item where it was, so an id held across the
 * save still names the same entry and keyed lists keep their DOM. Left with its own ids when
 * the two differ in shape.
 */
export function carryRuntimeIds(from: TripData, to: TripData): TripData {
    const sameShape = from.days.length === to.days.length
        && from.days.every((day, d) => day.timeline.length === to.days[d]!.timeline.length)
        && from.todo.length === to.todo.length
        && from.packing.length === to.packing.length;
    if (!sameShape) return to;
    from.days.forEach((day, d) => day.timeline.forEach((event, e) => to.days[d]!.timeline[e]!._id = event._id));
    from.todo.forEach((item, i) => to.todo[i]!._id = item._id);
    from.packing.forEach((item, i) => to.packing[i]!._id = item._id);
    return to;
}

/** `_id` for an entry created at runtime: unique for the session, and stripped again on save. */
export function createRuntimeId(prefix: "ev" | "todo" | "pack"): string {
    return `${prefix}-${runtimeIdSeq++}`;
}

/**
 * js-yaml words its syntax errors in English, and the editor prints this gate's
 * message as it stands. Keyed by the start of js-yaml's `reason` (some carry the
 * offending name after it); a reason not listed here is passed through untranslated.
 */
const YAML_SYNTAX_HINTS: ReadonlyArray<readonly [reason: string, hint: string]> = [
    ["bad indentation of a mapping entry", "縮排不一致，或這一行的值裡有「: 」(冒號加空格)。整段文字請用引號包起來，例如 desc: '京都: 一日遊'"],
    ["tab characters must not be used in indentation", "縮排不能使用 Tab，請改用空格"],
    ["deficient indentation", "縮排不足，或引號、括號沒有成對"],
    ["duplicated mapping key", "同一層有重複的欄位名稱"],
    ["unidentified alias", "以 * 開頭的文字會被當成參照，請用引號包起來"],
];

function describeYamlSyntaxError(e: YAMLException): string {
    const hint = YAML_SYNTAX_HINTS.find(([reason]) => e.reason.startsWith(reason))?.[1] ?? e.reason;
    const head = `YAML 語法錯誤${e.mark ? `（第 ${e.mark.line + 1} 行）` : ""}：${hint}`;
    return e.mark?.snippet ? `${head}\n\n${e.mark.snippet}` : head;
}

/**
 * Gate a YAML string before it becomes the trip — the editor, share-link imports
 * and AI edits all pass through here. Returns the normalized data, or throws with
 * a zh-TW message safe to show the user (the raw parse error is on `cause`).
 */
export function validateYaml(yamlStr: string): TripData {
    try {
        return normalizeTripData(parseYaml(yamlStr));
    } catch (e: unknown) {
        const message = e instanceof YAMLException
            ? describeYamlSyntaxError(e)
            : e instanceof Error
            ? e.message
            : "無效的 YAML 語法";
        throw new Error(message, { cause: e });
    }
}
