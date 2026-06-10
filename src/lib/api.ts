import {
    dump as dumpYaml,
    load as parseYaml,
} from "js-yaml";

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
    /** Extra labeled links for this event (e.g. several spots/points). Map URLs get a matching brand icon. */
    links?: { label: string; url: string; }[];
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
    transport?: string;
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
}

export interface PhraseInfo {
    zh: string;
    text: string;
    rom: string;
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
         * reliably; Chinese ones often miss or hit the wrong country — see
         * `lib/weather.ts`. Weather is simply hidden when unset.
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
    // A bare-number city (e.g. `city: 123`) would crash weather lookups later;
    // reject it here with a readable message instead.
    if (data.trip.city != null && typeof data.trip.city !== "string") {
        throw new Error("trip.city 必須是文字 (例如 'Tokyo')");
    }
    for (const day of data.days) {
        if (day.city != null && typeof day.city !== "string") {
            throw new Error("days[].city 必須是文字 (例如 'Tokyo')");
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

/**
 * Generate a runtime-only `_id` for a newly added checklist item. Shares the
 * same sequence as `attachRuntimeIds` so ids never collide within a session.
 * Like all `_id`s, it is stripped on serialization and never written to YAML.
 */
export function createChecklistItemId(prefix: "todo" | "pack"): string {
    return `${prefix}-${runtimeIdSeq++}`;
}

// Load and parse itinerary YAML from local storage or fallback file
export async function fetchItinerary(): Promise<TripData> {
    try {
        let yamlContent = localStorage.getItem(USER_YAML_KEY) || "";

        if (!yamlContent) {
            // No user YAML in localStorage: try itinerary.local.yaml, then fall back to itinerary.yaml.
            // Offline, a missing file makes fetch reject outright (not a 404),
            // so rejection must also fall through to the precached itinerary.yaml.
            // The abort timeout bounds a hanging network, and must stay ABOVE the
            // service worker's 5s networkTimeoutSeconds so the SW's cached copy
            // of a real itinerary.local.yaml wins before we give up on it.
            let response: Response | null = null;
            try {
                response = await fetch("./itinerary.local.yaml", { signal: AbortSignal.timeout(8000) });
            } catch {
                response = null;
            }

            if (!response?.ok) {
                response = await fetch("./itinerary.yaml");
                if (!response.ok) {
                    throw new Error("Neither itinerary.local.yaml nor itinerary.yaml was found.");
                }
            }
            yamlContent = await response.text();
        }

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
