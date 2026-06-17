import {
    dump as dumpYaml,
    load as parseYaml,
} from "js-yaml";
import { ledgerTypeLabel } from "./ledger";

/** Reservation confirmation shown as a tap-to-copy chip and an enlarged counter-facing view. */
export interface ConfirmationInfo {
    /** Confirmation / booking code. Numeric codes must be quoted in YAML so leading zeros survive. */
    code: string;
    /** Name the reservation is under (e.g. passport spelling). */
    name?: string;
    /** Short note, e.g. which document to present at the counter. */
    note?: string;
}

export interface TimelineEvent {
    time: string;
    title: string;
    type: "booked" | "must-go" | "option" | "standard";
    desc: string;
    bullets?: string[];
    /** Place name in the destination's local language, used as the map-search query. */
    localName?: string;
    /** Direct map URL (e.g. a naver.me / maps.app.goo.gl short link). Preferred over searching `localName`. */
    mapLink?: string;
    /** Extra labeled links for this event (e.g. several spots/points). Map URLs get a matching brand icon. For pick-one backup places, use `alternatives` instead. */
    links?: { label: string; url: string; }[];
    /** Backup place choices (e.g. fallback restaurants): each carries a local-language name (enlargeable for asking directions) and a switch-decision note. Shown as a collapsed list at the card's tail. For plain supplementary URLs of the same event, use `links` instead. */
    alternatives?: { title: string; localName?: string; mapLink?: string; note?: string; }[];
    /** Manual check-in state. Persisted into YAML, so progress travels with share links. Unset = not visited yet. */
    status?: "done" | "skipped";
    /** Reservation confirmation code (typically for `booked` events). */
    confirmation?: ConfirmationInfo;
    /**
     * Ephemeral, runtime-only identity used as a stable `{#each}` key while
     * editing. Assigned on load and stripped again on serialization, so it
     * never appears in the saved/exported YAML.
     */
    _id?: string;
}

export interface DayItinerary {
    day: number;
    date: string;
    region: string;
    /** Overrides `trip.city` for this day's weather lookup (multi-city trips). See `lib/weather.ts`. */
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
    /** Direct map URL (e.g. a naver.me / maps.app.goo.gl short link). Preferred over searching `localName`. */
    mapLink?: string;
    /** Reservation confirmation code shown on the hotel card. */
    confirmation?: ConfirmationInfo;
}

/** Situational category for a survival phrase; used by the TaxiHelper filter chips. */
export type PhraseCategory = "basic" | "transport" | "dining" | "shopping" | "help";

export interface PhraseInfo {
    zh: string;
    text: string;
    rom: string;
    /** Optional category; uncategorized phrases only show under the 全部 filter. */
    cat?: PhraseCategory;
}

export interface TripData {
    trip: {
        name: string;
        start: string; // YYYY-MM-DD
        end: string; // YYYY-MM-DD
        departure: string; // ISO date-time string, e.g., 2026-06-11T14:00:00+08:00
        /** Language code (e.g. 'ko', 'ja', 'en') selecting the built-in phrase set. */
        lang?: string;
        /** Currency code (e.g. 'KRW', 'JPY', 'USD') for the ledger. */
        currency?: string;
        /**
         * Which map service the destination uses — a market/regulatory choice
         * (e.g. 'naver' for Korea), not a language one. Defaults to Google Maps
         * when unset. See `mapSearch` in `lib/utils.ts`.
         */
        mapProvider?: "naver" | "google";
        /**
         * Destination city for the daily weather forecast, overridable per day
         * via `DayItinerary.city`. English names (e.g. 'Tokyo', 'Seoul') geocode
         * reliably; only some CJK names resolve. A ', XX' country suffix
         * disambiguates — see `lib/weather.ts`. Weather is simply hidden when unset.
         */
        city?: string;
        /** Customized wallets/cards (e.g. 'Suica', 'WOWPASS') for the ledger. */
        wallets?: string[];
        hotels: HotelInfo[];
    };
    todo: ChecklistItem[];
    packing: ChecklistItem[];
    days: DayItinerary[];
}

export interface ChecklistItem {
    text: string;
    checked?: boolean;
    /**
     * Ephemeral, runtime-only identity used as a stable `{#each}` key and as the
     * lookup handle for toggle/add/delete. Assigned on load and on creation,
     * stripped again on serialization — it never appears in saved/exported YAML.
     * (Same pattern as `TimelineEvent._id`.)
     */
    _id?: string;
}

export const USER_YAML_KEY = "showmeway_user_yaml";

// Schema modeline re-injected on every export so editor autocompletion keeps
// working. Points at the schema deployed alongside the site (in `public/`), so
// the reference resolves no matter where an exported/shared YAML ends up.
const SCHEMA_LINE = "# yaml-language-server: $schema=https://hsin19.github.io/show-me-way/showmeway-schema.json\n";

let runtimeIdSeq = 0;

/**
 * Assign an ephemeral, session-stable `_id` to every timeline event and
 * checklist item. These ids exist only in memory (as `{#each}` keys and as the
 * lookup handle for editing) and are never persisted — see `serializeToYaml`.
 */
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
 * Validate an optional `confirmation` block (timeline events and hotels).
 * An unquoted numeric `code:` would lose leading zeros to YAML number parsing,
 * so a non-string code is rejected with a how-to-fix message instead of coerced.
 */
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

/** Validate an optional `alternatives` list: each entry needs a string `title`; other fields are optional strings. */
function validateAlternatives(value: unknown, where: string): void {
    if (value == null) return;
    if (!Array.isArray(value)) {
        throw new Error(`${where}的 alternatives 必須是列表`);
    }
    for (const [k, alt] of value.entries()) {
        if (!alt || typeof alt !== "object" || Array.isArray(alt)) {
            throw new Error(`${where}的 alternatives 第 ${k + 1} 項必須是物件 (不可為空白列表項)`);
        }
        const fields = alt as Partial<Record<"title" | "localName" | "mapLink" | "note", unknown>>;
        if (fields.title == null) {
            throw new Error(`${where}的 alternatives 第 ${k + 1} 項缺少 title 屬性`);
        }
        for (const field of ["title", "localName", "mapLink", "note"] as const) {
            if (fields[field] != null && typeof fields[field] !== "string") {
                throw new Error(`${where}的 alternatives 第 ${k + 1} 項的 ${field} 必須是文字`);
            }
        }
    }
}

/**
 * Validate the required shape of a parsed itinerary object and normalize
 * optional sections (todo / packing) to empty arrays so downstream components
 * can always iterate safely. Any legacy top-level `phrases` is ignored —
 * phrases are now hard-coded per `trip.lang` (see `lib/phrases.ts`).
 *
 * Throws an Error with a user-facing (zh-TW) message on invalid structure.
 */
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
    if (!data.trip.start || !data.trip.end || !data.trip.departure || !Array.isArray(data.trip.hotels)) {
        throw new Error("trip 區塊缺少 start, end, departure 或 hotels 屬性");
    }
    // Same bare-`-` hazard as days/timeline: a null or malformed hotel entry
    // would otherwise crash later while rendering Timeline / TaxiHelper.
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
            // js-yaml parses an unquoted YYYY-MM-DD as a UTC-midnight Date;
            // UTC getters recover the date exactly as written, in any timezone.
            if ((field === "checkIn" || field === "checkOut") && value instanceof Date) {
                fields[field] = `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, "0")}-${String(value.getUTCDate()).padStart(2, "0")}`;
                continue;
            }
            if (typeof value !== "string") {
                throw new Error(`hotels 第 ${i + 1} 項的 ${field} 必須是文字`);
            }
        }
        validateConfirmation((hotel as { confirmation?: unknown; }).confirmation, `hotels 第 ${i + 1} 項`);
    }
    // A bare-number city (e.g. `city: 123`) would crash weather lookups later;
    // reject it here with a readable message instead.
    if (data.trip.city != null && typeof data.trip.city !== "string") {
        throw new Error("trip.city 必須是文字 (例如 'Tokyo')");
    }
    for (const [i, day] of data.days.entries()) {
        // A bare `-` list item in hand-written YAML parses to null, and a
        // string/number/array element would otherwise surface later as a
        // cryptic English TypeError from `attachRuntimeIds`. Messages count by
        // list position (not the `day` field, which may be missing/renumbered).
        if (!day || typeof day !== "object" || Array.isArray(day)) {
            throw new Error(`days 第 ${i + 1} 項必須是物件 (不可為空白列表項)`);
        }
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
            validateConfirmation((ev as { confirmation?: unknown; }).confirmation, `days 第 ${i + 1} 項的 timeline 第 ${j + 1} 項`);
            validateAlternatives((ev as { alternatives?: unknown; }).alternatives, `days 第 ${i + 1} 項的 timeline 第 ${j + 1} 項`);
        }
        if (day.city != null && typeof day.city !== "string") {
            throw new Error(`days 第 ${i + 1} 項的 city 必須是文字 (例如 'Tokyo')`);
        }
    }
    // Checklist items get `_id`s too, so a null / plain-string item would crash
    // `attachRuntimeIds` just the same.
    for (const [listName, list] of [["todo", data.todo], ["packing", data.packing]] as const) {
        if (!Array.isArray(list)) continue;
        for (const [j, item] of list.entries()) {
            if (!item || typeof item !== "object" || Array.isArray(item)) {
                throw new Error(`${listName} 第 ${j + 1} 項必須是物件 (例如 - text: '項目內容')`);
            }
        }
    }

    // Optional sections default to empty arrays. Note `phrases` is intentionally
    // dropped here so any legacy value never round-trips back into saved YAML.
    const normalized: TripData = {
        trip: data.trip,
        days: data.days,
        todo: Array.isArray(data.todo) ? data.todo : [],
        packing: Array.isArray(data.packing) ? data.packing : [],
    };

    return attachRuntimeIds(normalized);
}

/**
 * Serialize trip data back to a YAML string for saving/exporting.
 * Strips the runtime-only `_id` fields (and any legacy `id` left over from the
 * old checklist schema) and re-adds the schema modeline. Array order is
 * preserved; comments and key ordering from any original hand-written YAML are
 * not (by design — the object is the source of truth).
 */
export function serializeToYaml(data: TripData): string {
    // JSON round-trip rather than structuredClone: `data` may be a Svelte
    // reactive ($state) proxy, which structuredClone cannot clone. TripData is
    // fully JSON-serializable, so this safely yields a plain detached object.
    const clean = JSON.parse(JSON.stringify(data)) as TripData;
    for (const day of clean.days) {
        for (const ev of day.timeline) {
            delete ev._id;
        }
    }
    for (const item of [...clean.todo, ...clean.packing]) {
        delete item._id;
        // Drop the obsolete persisted `id` so it is cleaned out on first save.
        delete (item as { id?: string; }).id;
    }

    const body = dumpYaml(clean, {
        lineWidth: -1, // no line folding — keep long strings on one readable line
        quotingType: "'", // prefer single quotes to match the existing style
        forceQuotes: false,
        noRefs: true, // never emit &anchor / *alias
    });

    return SCHEMA_LINE + body;
}

/**
 * Persist the current in-memory trip data back into the user YAML stored in
 * localStorage. This is how runtime edits (e.g. adding/deleting checklist
 * items, toggling checked state) survive a reload — the serialized object
 * becomes the new source of truth on the next `fetchItinerary`.
 */
export function saveTripData(data: TripData): void {
    localStorage.setItem(USER_YAML_KEY, serializeToYaml(data));
}

export const YAML_BACKUPS_KEY = "showmeway_yaml_backups";
const MAX_YAML_BACKUPS = 5;

export interface YamlBackup {
    savedAt: string; // ISO date-time
    yaml: string;
}

/** List saved YAML backups, newest first. Unreadable storage yields []. */
export function listYamlBackups(): YamlBackup[] {
    try {
        const raw = localStorage.getItem(YAML_BACKUPS_KEY);
        if (!raw) return [];
        const parsed: unknown = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];
        return parsed.filter((entry): entry is YamlBackup =>
            !!entry && typeof entry === "object"
            && typeof (entry as YamlBackup).savedAt === "string"
            && typeof (entry as YamlBackup).yaml === "string"
        );
    } catch {
        return [];
    }
}

/** YAML content of one backup, looked up by its `savedAt` timestamp. */
export function getYamlBackup(savedAt: string): string | null {
    return listYamlBackups().find(b => b.savedAt === savedAt)?.yaml ?? null;
}

/**
 * Snapshot the current user YAML before a destructive overwrite (share-link
 * import, settings save, reset to default, backup restore). Keeps the newest
 * MAX_YAML_BACKUPS entries and skips when the content matches the latest
 * snapshot. A failed write (e.g. quota) only warns — it must never block the
 * overwrite itself.
 */
export function backupCurrentYaml(): void {
    const yaml = localStorage.getItem(USER_YAML_KEY);
    if (!yaml) return;
    const backups = listYamlBackups();
    if (backups[0]?.yaml === yaml) return;
    backups.unshift({ savedAt: new Date().toISOString(), yaml });
    try {
        localStorage.setItem(YAML_BACKUPS_KEY, JSON.stringify(backups.slice(0, MAX_YAML_BACKUPS)));
    } catch (err) {
        console.warn("[API] Failed to save YAML backup:", err);
    }
}

// --- Trip profiles -------------------------------------------------------
// A lightweight multi-trip layer that mirrors the backup approach: the active
// trip stays in USER_YAML_KEY (so every existing read/write path is untouched),
// while the other trips are parked as YAML snapshots in PROFILES_KEY. Switching
// just swaps the chosen snapshot with whatever is currently active. Unlike the
// auto-backup ring this list is user-managed and never auto-evicted. Per-trip
// state outside the itinerary YAML (e.g. the ledger) is intentionally NOT
// swapped yet — only the itinerary travels with the profile.

export const PROFILES_KEY = "showmeway_profiles";
export const ACTIVE_PROFILE_KEY = "showmeway_active_profile";

interface StoredProfile {
    id: string;
    yaml: string;
    savedAt: string; // ISO date-time the trip was last parked
}

/** Display summary of a parked (inactive) profile; the name is read live from its YAML. */
export interface ProfileInfo {
    id: string;
    name: string;
    savedAt: string;
}

function genProfileId(): string {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
        return crypto.randomUUID();
    }
    return `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Read parked profiles, newest first. Unreadable / malformed storage yields []. */
function readStoredProfiles(): StoredProfile[] {
    try {
        const raw = localStorage.getItem(PROFILES_KEY);
        if (!raw) return [];
        const parsed: unknown = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];
        return parsed.filter((p): p is StoredProfile =>
            !!p && typeof p === "object"
            && typeof (p as StoredProfile).id === "string"
            && typeof (p as StoredProfile).yaml === "string"
            && typeof (p as StoredProfile).savedAt === "string"
        );
    } catch {
        return [];
    }
}

function writeStoredProfiles(list: StoredProfile[]): void {
    localStorage.setItem(PROFILES_KEY, JSON.stringify(list));
}

export function getActiveProfileId(): string | null {
    return localStorage.getItem(ACTIVE_PROFILE_KEY);
}

/** Assign an id to the active trip if it lacks one (bootstrap / migration). */
export function ensureActiveProfileId(): string {
    let id = getActiveProfileId();
    if (!id) {
        id = genProfileId();
        localStorage.setItem(ACTIVE_PROFILE_KEY, id);
    }
    return id;
}

/** Best-effort `trip.name` from a YAML string, for labeling parked profiles. */
export function tripNameFromYaml(yaml: string): string {
    try {
        const data = parseYaml(yaml) as Partial<TripData> | null;
        const name = data?.trip?.name;
        if (typeof name === "string" && name.trim()) return name.trim();
    } catch {
        // Malformed YAML still gets a usable label below.
    }
    return "未命名行程";
}

/** The parked (inactive) trips, newest first. The active trip lives in USER_YAML_KEY. */
export function listProfiles(): ProfileInfo[] {
    return readStoredProfiles().map(p => ({
        id: p.id,
        name: tripNameFromYaml(p.yaml),
        savedAt: p.savedAt,
    }));
}

/**
 * Park the active trip and bring a stored profile to the front: snapshot the
 * current USER_YAML_KEY into the profile list, then load `targetId`'s YAML into
 * USER_YAML_KEY. The caller must persist the live trip into USER_YAML_KEY first
 * and reload trip data afterwards. Throws if `targetId` is unknown.
 */
export function switchToProfile(targetId: string): void {
    const list = readStoredProfiles();
    const target = list.find(p => p.id === targetId);
    if (!target) throw new Error("找不到要切換的行程");
    const activeId = ensureActiveProfileId();
    const activeYaml = localStorage.getItem(USER_YAML_KEY);
    const rest = list.filter(p => p.id !== targetId);
    if (activeYaml != null) {
        rest.unshift({ id: activeId, yaml: activeYaml, savedAt: new Date().toISOString() });
    }
    writeStoredProfiles(rest);
    localStorage.setItem(USER_YAML_KEY, target.yaml);
    localStorage.setItem(ACTIVE_PROFILE_KEY, target.id);
}

/**
 * Park the active trip and start a new one from `yaml`. The caller must persist
 * the live trip into USER_YAML_KEY first and reload afterwards. Returns the new
 * profile id.
 */
export function createProfile(yaml: string): string {
    const activeId = ensureActiveProfileId();
    const activeYaml = localStorage.getItem(USER_YAML_KEY);
    if (activeYaml != null) {
        const list = readStoredProfiles();
        list.unshift({ id: activeId, yaml: activeYaml, savedAt: new Date().toISOString() });
        writeStoredProfiles(list);
    }
    const id = genProfileId();
    localStorage.setItem(USER_YAML_KEY, yaml);
    localStorage.setItem(ACTIVE_PROFILE_KEY, id);
    return id;
}

/** Remove a parked (inactive) profile. The active trip cannot be deleted here. */
export function deleteProfile(id: string): void {
    writeStoredProfiles(readStoredProfiles().filter(p => p.id !== id));
}

/**
 * Download text content as a file on the user's device — the only channel
 * that gets data out of localStorage and off this single device. Works via
 * a temporary object URL on an `a[download]` anchor (no dependencies); on
 * iOS 16.4+ standalone PWAs this lands in the Files app / share sheet.
 */
export function downloadTextFile(filename: string, content: string, mimeType: string): void {
    const url = URL.createObjectURL(new Blob([content], { type: mimeType }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    // Deferred revoke: the download starts asynchronously from the URL.
    window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

function escapeCsvField(value: string): string {
    return /[",\n\r]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

/**
 * Build a CSV export of the expense records in `ledger_expenses` (the key is
 * owned by `Ledger.svelte`). zh-TW headers plus a UTF-8 BOM so Excel decodes
 * the Chinese text correctly. Returns null when there is nothing to export
 * (no records, or unreadable storage — same degradation as the Ledger itself).
 */
export function buildLedgerCsv(): string | null {
    let parsed: unknown;
    try {
        parsed = JSON.parse(localStorage.getItem("ledger_expenses") ?? "[]");
    } catch {
        return null;
    }
    if (!Array.isArray(parsed) || parsed.length === 0) return null;
    const lines = ["日期,項目,金額,類別"];
    for (const item of parsed as Partial<Record<"date" | "name" | "amount" | "type", unknown>>[]) {
        lines.push([
            escapeCsvField(typeof item?.date === "string" ? item.date : ""),
            escapeCsvField(typeof item?.name === "string" ? item.name : ""),
            typeof item?.amount === "number" ? String(item.amount) : "",
            escapeCsvField(ledgerTypeLabel(typeof item?.type === "string" ? item.type : "")),
        ].join(","));
    }
    return "\uFEFF" + lines.join("\r\n") + "\r\n";
}

/**
 * Generate a runtime-only `_id` for a newly added checklist item. Shares the
 * same sequence as `attachRuntimeIds` so ids never collide within a session.
 * Like all `_id`s, it is stripped on serialization and never written to YAML.
 */
export function createChecklistItemId(prefix: "todo" | "pack"): string {
    return `${prefix}-${runtimeIdSeq++}`;
}

/**
 * Fetch the default itinerary YAML text: itinerary.local.yaml first, then the
 * bundled itinerary.yaml. Shared by `fetchItinerary` and the settings editor so
 * their fallback behavior can't drift.
 *
 * Offline, a missing file makes fetch reject outright (not a 404), so rejection
 * must also fall through to the precached itinerary.yaml. The abort timeout
 * bounds a hanging network, and must stay ABOVE the service worker's 5s
 * networkTimeoutSeconds so the SW's cached copy of a real itinerary.local.yaml
 * wins before we give up on it.
 */
export async function fetchDefaultYamlText(): Promise<string> {
    let response: Response | null = null;
    try {
        response = await fetch("./itinerary.local.yaml", { signal: AbortSignal.timeout(8000) });
    } catch {
        // Offline / timed out — fall through to the bundled default below.
    }

    if (!response?.ok) {
        response = await fetch("./itinerary.yaml");
        if (!response.ok) {
            throw new Error("Neither itinerary.local.yaml nor itinerary.yaml was found.");
        }
    }
    return response.text();
}

// Load and parse itinerary YAML from local storage or fallback file
export async function fetchItinerary(): Promise<TripData> {
    try {
        const yamlContent = localStorage.getItem(USER_YAML_KEY) || await fetchDefaultYamlText();
        return normalizeTripData(parseYaml(yamlContent));
    } catch (error) {
        console.error("[API] Error parsing YAML itinerary:", error);
        throw error;
    }
}

// Validate raw YAML string (used by the in-app editor before saving)
export function validateYaml(yamlStr: string): TripData {
    try {
        return normalizeTripData(parseYaml(yamlStr));
    } catch (e: unknown) {
        const message = e instanceof Error ? e.message : "無效的 YAML 語法";
        throw new Error(message, { cause: e });
    }
}
