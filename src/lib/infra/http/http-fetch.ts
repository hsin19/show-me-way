// How an itinerary gets onto a device that doesn't have one yet — split from
// api.ts so the parser/storage side stays free of network concerns.

import {
    type TripData,
    validateYaml,
} from "../../domain/trip";
import { USER_YAML_KEY } from "../storage/yaml-storage";

/**
 * Null rather than a throw for every "not really there" outcome, so the caller
 * can fall through to the next candidate. The `<` check is the load-bearing one:
 * the Vite dev server answers a MISSING public file with the SPA fallback —
 * `200 text/html` — not a 404, so `response.ok` alone would hand index.html to
 * the YAML parser. A real itinerary starts with the `#` modeline or `trip:`.
 */
async function fetchYamlCandidate(url: string, opts?: RequestInit): Promise<string | null> {
    let response: Response;
    try {
        response = await fetch(url, opts);
    } catch {
        return null;
    }
    if (!response.ok) return null;
    const text = await response.text();
    if (text.trimStart().startsWith("<")) return null;
    return text;
}

/**
 * The itinerary a device with no saved trip starts from: `itinerary.local.yaml`
 * when the deployment carries one, otherwise the bundled template. Throws when
 * neither is reachable. Shared with the settings editor so the two cannot drift.
 */
export async function fetchDefaultYamlText(): Promise<string> {
    // Above the service worker's 5s networkTimeoutSeconds on purpose: give up
    // sooner and we lose the SW's cached copy of a real itinerary.local.yaml.
    const local = await fetchYamlCandidate("./itinerary.local.yaml", { signal: AbortSignal.timeout(8000) });
    if (local !== null) return local;
    const bundled = await fetchYamlCandidate("./itinerary.yaml");
    if (bundled !== null) return bundled;
    throw new Error("Neither itinerary.local.yaml nor itinerary.yaml was found.");
}

/** The trip to render: the user's saved YAML when there is one, otherwise the default itinerary. */
export async function fetchItinerary(): Promise<TripData> {
    try {
        const yamlContent = localStorage.getItem(USER_YAML_KEY) || await fetchDefaultYamlText();
        return validateYaml(yamlContent);
    } catch (error) {
        console.error("[API] Error parsing YAML itinerary:", error);
        throw error;
    }
}
