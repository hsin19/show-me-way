import {
    dump as dumpYaml,
    loadAll as loadYamlDocuments,
} from "js-yaml";
import { type ExpenseItem } from "./ledger";
import {
    formatEventMinutes,
    parseEventStartMinutes,
} from "./timeline";
import {
    addDaysIso,
    toUtcIsoDate,
} from "./utils";

export interface ConfirmationInfo {
    /** Numeric codes must be quoted in YAML, or leading zeros are lost to number parsing. */
    code: string;
    /** Whose name the reservation is under (e.g. passport spelling). */
    name?: string;
    /** e.g. which document to present at the counter. */
    note?: string;
}

interface TimelineEvent {
    time: string;
    title: string;
    type: "booked" | "must-go" | "option" | "standard";
    /** Optional on purpose — an event without one renders a blank line rather than failing the load. */
    desc?: string;
    bullets?: string[];
    /** Place name in the destination's local language, used as the map-search query. */
    localName?: string;
    /** Direct map URL (e.g. a naver.me / maps.app.goo.gl short link); takes precedence over searching `localName`. */
    mapLink?: string;
    /** Supplementary URLs (official site, a guide article). Places this event visits belong in `stops`, backup places in `alternatives`. */
    links?: { label: string; url: string; }[];
    /**
     * The places this event walks through in order (an "A ➔ B ➔ C" stroll), each
     * with its own map + enlarge actions so any of them — not just the event's own
     * `localName` — can be shown to a driver. Rendered expanded, unlike
     * `alternatives`: these are the event's content, not a fallback. No `note`
     * field on purpose, so a stop stays one row.
     */
    stops?: { name: string; localName?: string; mapLink?: string; }[];
    /** Pick-one backup places (fallback restaurants), collapsed at the card's tail; `note` is the switch-decision hint. */
    alternatives?: { title: string; localName?: string; mapLink?: string; note?: string; }[];
    /** Manual check-in state, persisted into YAML so progress travels with share links. */
    status?: "done" | "skipped";
    confirmation?: ConfirmationInfo;
    /** Runtime-only `{#each}` key and edit handle; `serializeToYaml` strips it, so it never reaches saved YAML. */
    _id?: string;
}

export interface DayItinerary {
    /** Derived: 1-based position after `normalizeTripData` sorts and gap-fills by date. Never authored, never serialized. */
    day: number;
    date: string;
    title: string;
    /** Overrides `trip.city` for this day's weather lookup (multi-city trips). See `lib/infra/http/weather.ts`. */
    city?: string;
    pace: string;
    timeline: TimelineEvent[];
}

export interface HotelInfo {
    name: string;
    address: string;
    checkIn: string; // YYYY-MM-DD
    checkOut: string; // YYYY-MM-DD
    /** Hotel name in the destination's local language, used as the map-search query. */
    localName?: string;
    /** Direct map URL (e.g. a naver.me / maps.app.goo.gl short link); takes precedence over searching `localName`. */
    mapLink?: string;
    confirmation?: ConfirmationInfo;
}

export interface TripData {
    trip: {
        name: string;
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
        /** Selects the built-in phrase set: 'ko', 'ja', 'en' — see `lib/domain/phrases.ts`. */
        lang?: string;
        /** Ledger currency, e.g. 'KRW', 'JPY', 'USD'. */
        currency?: string;
        /**
         * Which map service the destination uses — a market/regulatory fact
         * ('naver' for Korea), not a language one. Google Maps when unset.
         */
        mapProvider?: "naver" | "google";
        /**
         * Weather-forecast city, overridable per day via `DayItinerary.city`.
         * English names ('Tokyo', 'Seoul') geocode reliably and only some CJK
         * names resolve; a ', XX' country suffix disambiguates. Unset simply
         * hides the badge — see `lib/infra/http/weather.ts`.
         */
        city?: string;
        /** Ledger wallets/cards the trip uses, e.g. 'Suica', 'WOWPASS'. */
        wallets?: string[];
        hotels: HotelInfo[];
    };
    todo: ChecklistItem[];
    packing: ChecklistItem[];
    days: DayItinerary[];
    /** Optional in source YAML, normalized to `[]` on load. Lives in the itinerary YAML so spending travels with the profile and share links. */
    expenses: ExpenseItem[];
}

export interface ChecklistItem {
    /** Optional for the same reason as `TimelineEvent.desc`. */
    text?: string;
    checked?: boolean;
    /** Runtime-only, like `TimelineEvent._id`. */
    _id?: string;
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
// the schema from wherever it is opened, not just from the deployed site.
const SCHEMA_LINE = "# yaml-language-server: $schema=https://hsin19.github.io/show-me-way/showmeway-schema.json\n";

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

/** A numeric `code:` is rejected rather than coerced: it already lost its leading zeros by the time we see it. */
function validateConfirmation(value: unknown, where: string): void {
    if (value == null) return;
    if (typeof value !== "object" || Array.isArray(value)) {
        throw new Error(`${where}的 confirmation 必須是物件 (包含 code 屬性)`);
    }
    const conf = value as Partial<Record<"code" | "name" | "note", unknown>>;
    if (conf.code == null) {
        throw new Error(`${where}的 confirmation 缺少 code 屬性`);
    }
    if (typeof conf.code !== "string") {
        throw new Error(`${where}的 confirmation 的 code 必須是文字 (數字代碼請加引號，例如 code: '012345')`);
    }
    for (const field of ["name", "note"] as const) {
        if (conf[field] != null && typeof conf[field] !== "string") {
            throw new Error(`${where}的 confirmation 的 ${field} 必須是文字`);
        }
    }
}

/**
 * Absent is allowed; a number or list is not. `markdown.ts` and
 * `sanitizeLinkHref` both drop a non-string silently, so this is the only place
 * the author ever hears that their `desc: 2024` vanished. `field` is a phrase
 * rather than a key so a list element can name its position (`bullets 第 2 項`).
 */
function validateOptionalString(value: unknown, where: string, field: string): void {
    if (value != null && typeof value !== "string") {
        throw new Error(`${where}的 ${field} 必須是文字`);
    }
}

/** `alternatives` / `stops` / `links` differ only in which fields they carry, so they share one loop. */
function validateEntryList(
    value: unknown,
    where: string,
    listName: "alternatives" | "stops" | "links",
    required: readonly string[],
    optional: readonly string[],
): void {
    if (value == null) return;
    if (!Array.isArray(value)) {
        throw new Error(`${where}的 ${listName} 必須是列表`);
    }
    for (const [k, entry] of value.entries()) {
        if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
            throw new Error(`${where}的 ${listName} 第 ${k + 1} 項必須是物件 (不可為空白列表項)`);
        }
        const fields = entry as Record<string, unknown>;
        for (const field of required) {
            if (fields[field] == null) {
                throw new Error(`${where}的 ${listName} 第 ${k + 1} 項缺少 ${field} 屬性`);
            }
        }
        for (const field of [...required, ...optional]) {
            validateOptionalString(fields[field], `${where}的 ${listName} 第 ${k + 1} 項`, field);
        }
    }
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
 * The countdown target, replacing the `trip.departure` authors used to hand-write:
 * day 1's first event, at local midnight when that event carries no usable time.
 * Deliberately offset-free -- the trip's own timezone is where the user reads it.
 */
function deriveDeparture(firstDay: DayItinerary): string {
    const minutes = parseEventStartMinutes(firstDay.timeline[0]?.time ?? "") ?? 0;
    const wrapped = minutes % (24 * 60);
    return `${firstDay.date}T${formatEventMinutes(wrapped)}:00`;
}

/** The only real gate on itinerary data; its zh-TW messages are shown to the user verbatim. */
function normalizeTripData(raw: unknown): TripData {
    if (!raw || typeof raw !== "object") {
        throw new Error("YAML 內容為空或格式不正確");
    }

    const data = raw as Partial<TripData>;

    if (!data.trip || !Array.isArray(data.days)) {
        throw new Error("YAML 缺少必要的結構 (trip 或 days 區塊)");
    }
    if (data.days.length === 0) {
        throw new Error("days 至少需要一天的行程");
    }
    if (typeof data.trip.name !== "string" || !data.trip.name || !Array.isArray(data.trip.hotels)) {
        throw new Error("trip 區塊缺少 name (文字) 或 hotels 屬性");
    }
    for (const [i, hotel] of data.trip.hotels.entries()) {
        if (!hotel || typeof hotel !== "object" || Array.isArray(hotel)) {
            throw new Error(`hotels 第 ${i + 1} 項必須是物件 (不可為空白列表項)`);
        }
        const fields: Partial<Record<"name" | "address" | "checkIn" | "checkOut", unknown>> = hotel;
        for (const field of ["name", "address", "checkIn", "checkOut"] as const) {
            const value = fields[field];
            if (value == null) {
                throw new Error(`hotels 第 ${i + 1} 項缺少 ${field} 屬性`);
            }
            if ((field === "checkIn" || field === "checkOut") && value instanceof Date) {
                fields[field] = toUtcIsoDate(value);
                continue;
            }
            if (typeof value !== "string") {
                throw new Error(`hotels 第 ${i + 1} 項的 ${field} 必須是文字`);
            }
        }
        for (const field of ["localName", "mapLink"] as const) {
            validateOptionalString((hotel as unknown as Record<string, unknown>)[field], `hotels 第 ${i + 1} 項`, field);
        }
        validateConfirmation((hotel as { confirmation?: unknown; }).confirmation, `hotels 第 ${i + 1} 項`);
    }
    if (data.trip.city != null && typeof data.trip.city !== "string") {
        throw new Error("trip.city 必須是文字 (例如 'Tokyo')");
    }
    validateOptionalString(data.trip.id, "trip", "id");
    for (const [i, day] of data.days.entries()) {
        if (!day || typeof day !== "object" || Array.isArray(day)) {
            throw new Error(`days 第 ${i + 1} 項必須是物件 (不可為空白列表項)`);
        }
        const dayObj = day as { date?: unknown; title?: unknown; region?: unknown; city?: unknown; pace?: unknown; timeline?: unknown; };
        let dateVal = dayObj.date;
        if (dateVal == null) {
            throw new Error(`days 第 ${i + 1} 項缺少 date 屬性`);
        }
        if (dateVal instanceof Date) {
            dateVal = toUtcIsoDate(dateVal);
        }
        if (typeof dateVal !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(dateVal)) {
            throw new Error(`days 第 ${i + 1} 項的 date 必須是 YYYY-MM-DD 日期格式`);
        }
        day.date = dateVal;
        const dayTitle = dayObj.title ?? dayObj.region;
        if (dayTitle == null || typeof dayTitle !== "string") {
            throw new Error(`days 第 ${i + 1} 項缺少 title 屬性 (或 title 必須是文字)`);
        }
        day.title = dayTitle;
        delete dayObj.region;
        validateOptionalString(dayObj.pace, `days 第 ${i + 1} 項`, "pace");
        day.pace = typeof dayObj.pace === "string" ? dayObj.pace : DEFAULT_PACE;
        if (!Array.isArray(day.timeline)) {
            throw new Error(`days 第 ${i + 1} 項缺少 timeline 列表`);
        }
        for (const [j, ev] of day.timeline.entries()) {
            if (!ev || typeof ev !== "object" || Array.isArray(ev)) {
                throw new Error(`days 第 ${i + 1} 項的 timeline 第 ${j + 1} 項必須是物件 (不可為空白列表項)`);
            }
            const evStatus: unknown = (ev as { status?: unknown; }).status;
            if (evStatus != null && evStatus !== "done" && evStatus !== "skipped") {
                throw new Error(`days 第 ${i + 1} 項的 timeline 第 ${j + 1} 項的 status 必須是 'done' 或 'skipped'`);
            }
            const evWhere = `days 第 ${i + 1} 項的 timeline 第 ${j + 1} 項`;
            for (const field of ["desc", "localName", "mapLink"] as const) {
                validateOptionalString((ev as unknown as Record<string, unknown>)[field], evWhere, field);
            }
            const evBullets: unknown = (ev as { bullets?: unknown; }).bullets;
            if (evBullets != null) {
                if (!Array.isArray(evBullets)) {
                    throw new Error(`${evWhere}的 bullets 必須是列表`);
                }
                for (const [k, bullet] of evBullets.entries()) {
                    if (bullet == null) {
                        throw new Error(`${evWhere}的 bullets 第 ${k + 1} 項必須是文字 (不可為空白列表項)`);
                    }
                    validateOptionalString(bullet, evWhere, `bullets 第 ${k + 1} 項`);
                }
            }
            validateConfirmation((ev as { confirmation?: unknown; }).confirmation, evWhere);
            validateEntryList((ev as { alternatives?: unknown; }).alternatives, evWhere, "alternatives", ["title"], ["localName", "mapLink", "note"]);
            validateEntryList((ev as { stops?: unknown; }).stops, evWhere, "stops", ["name"], ["localName", "mapLink"]);
            validateEntryList((ev as { links?: unknown; }).links, evWhere, "links", ["label", "url"], []);
        }
        if (day.city != null && typeof day.city !== "string") {
            throw new Error(`days 第 ${i + 1} 項的 city 必須是文字 (例如 'Tokyo')`);
        }
    }
    for (const [listName, list] of [["todo", data.todo], ["packing", data.packing]] as const) {
        if (!Array.isArray(list)) continue;
        for (const [j, item] of list.entries()) {
            if (!item || typeof item !== "object" || Array.isArray(item)) {
                throw new Error(`${listName} 第 ${j + 1} 項必須是物件 (例如 - text: '項目內容')`);
            }
            validateOptionalString((item as { text?: unknown; }).text, `${listName} 第 ${j + 1} 項`, "text");
        }
    }
    if (data.expenses != null) {
        if (!Array.isArray(data.expenses)) {
            throw new Error("expenses 必須是列表");
        }
        for (const [j, item] of data.expenses.entries()) {
            if (!item || typeof item !== "object" || Array.isArray(item)) {
                throw new Error(`expenses 第 ${j + 1} 項必須是物件`);
            }
        }
    }

    const sortedDays = [...data.days].sort((a, b) => a.date.localeCompare(b.date));
    const filledDays: DayItinerary[] = [];
    let cursor = sortedDays[0].date;
    for (const day of sortedDays) {
        while (cursor < day.date) {
            filledDays.push({ day: 0, date: cursor, title: DEFAULT_DAY_TITLE, pace: DEFAULT_PACE, timeline: [] });
            cursor = addDaysIso(cursor, 1);
        }
        filledDays.push(day);
        cursor = addDaysIso(day.date, 1);
    }
    filledDays.forEach((day, index) => day.day = index + 1);

    const trip: TripData["trip"] = {
        ...data.trip,
        id: data.trip.id?.trim() || genTripId(),
        start: filledDays[0].date,
        end: filledDays[filledDays.length - 1].date,
        departure: deriveDeparture(filledDays[0]),
    };

    const normalized: TripData = {
        trip,
        days: filledDays,
        todo: Array.isArray(data.todo) ? data.todo : [],
        packing: Array.isArray(data.packing) ? data.packing : [],
        expenses: Array.isArray(data.expenses) ? data.expenses : [],
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
    const trip = clean.trip as Partial<TripData["trip"]>;
    delete trip.start;
    delete trip.end;
    delete trip.departure;
    for (const day of clean.days) {
        delete (day as { region?: string; }).region;
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
