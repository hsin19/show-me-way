import { load as parseYaml } from "js-yaml";

export interface TimelineEvent {
    time: string;
    title: string;
    type: "booked" | "must-go" | "option" | "standard";
    desc: string;
    bullets?: string[];
    naverSearch?: string;
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

        const data = parseYaml(yamlContent) as TripData;
        return data;
    } catch (error) {
        console.error("[API] Error parsing YAML itinerary:", error);
        throw error;
    }
}

// Validate raw YAML string
export function validateYaml(yamlStr: string): TripData {
    try {
        const data = parseYaml(yamlStr) as TripData;
        if (!data || !data.trip || !data.days || !data.phrases) {
            throw new Error("YAML 缺少必要的結構 (trip, days 或 phrases 區塊)");
        }
        if (!data.trip.start || !data.trip.end || !data.trip.departure || !data.trip.hotels) {
            throw new Error("trip 區塊缺少 start, end, departure 或 hotels 屬性");
        }
        return data;
    } catch (e: unknown) {
        const message = e instanceof Error ? e.message : "無效的 YAML 語法";
        throw new Error(message, { cause: e });
    }
}
