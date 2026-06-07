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
    naverSearch?: string;
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
    pace: string;
    transport?: string;
    timeline: TimelineEvent[];
}

export interface HotelInfo {
    name: string;
    station: string;
    address: string;
    checkIn: string; // YYYY-MM-DD
    checkOut: string; // YYYY-MM-DD
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
        hotels: HotelInfo[];
    };
    todo: Array<{ id: string; text: string; checked?: boolean; }>;
    packing: Array<{ id: string; text: string; checked?: boolean; }>;
    phrases: PhraseInfo[];
    days: DayItinerary[];
}

const USER_YAML_KEY = "showmeway_user_yaml";

// Schema modeline re-injected on every export so editor autocompletion keeps working.
const SCHEMA_LINE = "# yaml-language-server: $schema=./showmeway-schema.json\n";

let runtimeIdSeq = 0;

/**
 * Assign an ephemeral, session-stable `_id` to every timeline event. These ids
 * exist only in memory (as `{#each}` keys for a future edit mode) and are never
 * persisted — see `serializeToYaml`.
 */
function attachRuntimeIds(data: TripData): TripData {
    for (const day of data.days) {
        for (const ev of day.timeline) {
            ev._id = `ev-${runtimeIdSeq++}`;
        }
    }
    return data;
}

/**
 * Validate the required shape of a parsed itinerary object and normalize
 * optional sections (todo / packing / phrases) to empty arrays so downstream
 * components can always iterate safely.
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

    // Optional sections default to empty arrays.
    const normalized: TripData = {
        trip: data.trip,
        days: data.days,
        todo: Array.isArray(data.todo) ? data.todo : [],
        packing: Array.isArray(data.packing) ? data.packing : [],
        phrases: Array.isArray(data.phrases) ? data.phrases : [],
    };

    return attachRuntimeIds(normalized);
}

/**
 * Serialize trip data back to a YAML string for saving/exporting.
 * Strips the runtime-only `_id` fields and re-adds the schema modeline.
 * Array order is preserved; comments and key ordering from any original
 * hand-written YAML are not (by design — the object is the source of truth).
 */
export function serializeToYaml(data: TripData): string {
    const clean = structuredClone(data);
    for (const day of clean.days) {
        for (const ev of day.timeline) {
            delete ev._id;
        }
    }

    const body = dumpYaml(clean, {
        lineWidth: -1, // no line folding — keep long strings on one readable line
        quotingType: "'", // prefer single quotes to match the existing style
        forceQuotes: false,
        noRefs: true, // never emit &anchor / *alias
    });

    return SCHEMA_LINE + body;
}

// Load and parse itinerary YAML from local storage or fallback file
export async function fetchItinerary(): Promise<TripData> {
    try {
        let yamlContent = localStorage.getItem(USER_YAML_KEY) || "";

        if (!yamlContent) {
            // No user YAML in localStorage: try itinerary.local.yaml, then fall back to itinerary.yaml
            let response = await fetch("./itinerary.local.yaml");

            if (!response.ok) {
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
