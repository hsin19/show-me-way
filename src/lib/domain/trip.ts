import {
    dump as dumpYaml,
    loadAll as loadYamlDocuments,
} from "js-yaml";
import { safeParse } from "valibot";
import { type ExpenseItem } from "./ledger";
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
} from "./utils";

export type { ChecklistItem, ConfirmationInfo, HotelInfo } from "./trip-schema";

type AuthoredDay = ItineraryDocument["days"][number];

export interface DayItinerary extends Omit<AuthoredDay, "day" | "region" | "pace" | "timeline"> {
    /** Derived: 1-based position after `normalizeTripData` sorts and gap-fills by date. Never authored, never serialized. */
    day: number;
    /** `DEFAULT_PACE` when the author leaves it out. */
    pace: string;
    timeline: TimelineEvent[];
}

type TripInfo = Omit<ItineraryDocument["trip"], "id" | "start" | "end" | "departure"> & {
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
    /** Optional in source YAML, normalized to `[]` on load. Lives in the itinerary YAML so spending travels with the profile and share links. */
    expenses: ExpenseItem[];
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

// Absolute URL, not a relative one: an exported or shared YAML has to resolve
// the schema from wherever it is opened. GitHub raw rather than the deployed
// site, so the line survives a hosting move and follows `main` without a deploy.
const SCHEMA_LINE = "# yaml-language-server: $schema=https://raw.githubusercontent.com/hsin19/show-me-way/main/schema/showmeway-schema.json\n";

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
    for (const item of data.expenses) {
        item._id = `exp-${runtimeIdSeq++}`;
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

/** `days[].region` is `title`'s old name; installed PWAs still hold YAML written with it. */
function migrateLegacyRegion(raw: unknown): void {
    const days = (raw as { days?: unknown; } | null)?.days;
    if (!Array.isArray(days)) return;
    for (const day of days) {
        if (!day || typeof day !== "object" || Array.isArray(day)) continue;
        const record = day as { title?: unknown; region?: unknown; };
        if (record.title === undefined && typeof record.region === "string") record.title = record.region;
        delete record.region;
    }
}

/**
 * The countdown target, replacing the `trip.departure` authors used to hand-write:
 * day 1's first event, at local midnight when that event carries no usable time.
 * Deliberately offset-free -- the trip's own timezone is where the user reads it.
 */
function deriveDeparture(firstDay: DayItinerary): string {
    const minutes = parseEventStartMinutes(firstDay.timeline[0]?.time ?? "") ?? 0;
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
        const prev = ordered[i - 1];
        const cur = ordered[i];
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
    migrateLegacyRegion(raw);
    const parsed = safeParse(itinerarySchema, raw, { abortEarly: true });
    if (!parsed.success) throw new Error(describeIssue(parsed.issues[0]));
    const doc = parsed.output;

    for (const [i, hotel] of doc.trip.hotels.entries()) {
        for (const field of ["checkIn", "checkOut"] as const) {
            if (!isCalendarDate(hotel[field])) throw new Error(`hotels 第 ${i + 1} 項的 ${field} 不是有效的日期 (${hotel[field]})`);
        }
    }

    const filledDays: DayItinerary[] = [];
    let cursor: string | null = null;
    for (const authored of sortAuthoredDays(doc.days)) {
        while (cursor !== null && cursor < authored.date) {
            filledDays.push({ day: 0, date: cursor, title: DEFAULT_DAY_TITLE, pace: DEFAULT_PACE, timeline: [] });
            cursor = addDaysIso(cursor, 1);
        }
        // `pace` is re-added last whether authored or defaulted, so a defaulted one does not reorder keys on the next round-trip.
        const { pace, ...rest } = authored;
        filledDays.push({ day: 0, ...rest, pace: pace ?? DEFAULT_PACE });
        cursor = addDaysIso(authored.date, 1);
    }
    filledDays.forEach((day, index) => day.day = index + 1);

    // `id` sits right after `name` whether authored or minted, for the same round-trip stability as `pace`.
    const { name, id, ...rest } = doc.trip;
    const trip: TripInfo = {
        name,
        id: id?.trim() || genTripId(),
        ...rest,
        start: filledDays[0].date,
        end: filledDays[filledDays.length - 1].date,
        departure: deriveDeparture(filledDays[0]),
    };

    const normalized: TripData = {
        trip,
        days: filledDays,
        todo: doc.todo ?? [],
        packing: doc.packing ?? [],
        expenses: doc.expenses ?? [],
    };

    return attachRuntimeIds(normalized);
}

/**
 * The YAML written to storage, exports and share links. Canonicalization rather
 * than a round-trip: array order survives, comments and hand-authored key order
 * do not.
 */
export function serializeToYaml(data: TripData): string {
    const clean = JSON.parse(JSON.stringify(data)) as TripData;
    const trip = clean.trip as Partial<TripInfo>;
    delete trip.start;
    delete trip.end;
    delete trip.departure;
    for (const day of clean.days) {
        delete (day as { day?: number; }).day;
        for (const ev of day.timeline) {
            delete ev._id;
        }
    }
    for (const item of [...clean.todo, ...clean.packing, ...clean.expenses]) {
        delete item._id;
        delete (item as { id?: string; }).id;
    }

    const body = dumpYaml(clean, {
        lineWidth: -1,
        quoteStyle: "single",
        forceQuotes: false,
        noRefs: true,
    });

    return SCHEMA_LINE + body;
}

/** `_id` for an item created at runtime: unique for the session, and stripped again on save. */
export function createChecklistItemId(prefix: "todo" | "pack"): string {
    return `${prefix}-${runtimeIdSeq++}`;
}

/** `_id` for a record created at runtime: unique for the session, and stripped again on save. */
export function createExpenseId(): string {
    return `exp-${runtimeIdSeq++}`;
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
        const message = e instanceof Error ? e.message : "無效的 YAML 語法";
        throw new Error(message, { cause: e });
    }
}
