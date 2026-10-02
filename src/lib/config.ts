/*
 * What a deployment of this app is: the repo it is built from, the site and hop it runs on,
 * and the OAuth client registered for that site. A fork edits this file, or the .env value
 * an entry reads. A value earns a place here by being one a deployment changes or that
 * several modules share — not by being a number: a timing a single module owns stays there,
 * beside the comment that explains it.
 *
 * Imports nothing from $lib, so every layer and the plain-Node `trip:sync` can use it. An
 * env-backed value is a getter over its own static `import.meta.env?.VITE_X`, read per call:
 * Vite inlines only static reads, vitest stubs the env per test, and plain Node has no
 * `import.meta.env` at all and lands on the default. That default is the production value,
 * which is what the CLI wants — it works on the owner's real data, not on whatever a local
 * .env points dev builds at.
 */

/** Unset and blank are the same: a `VITE_X=` line left in someone's .env must fall back. */
function envValue(value: string | undefined): string | undefined {
    return value?.trim() || undefined;
}

const GITHUB_REPO = "hsin19/show-me-way";

export const REPO_URL = `https://github.com/${GITHUB_REPO}`;

// Absolute, so an exported or shared YAML resolves its schema from wherever it is opened;
// GitHub raw rather than the deployed site, so the modeline survives a hosting move and
// follows `main` without a deploy. Fixed rather than env-backed: serializeToYaml writes it
// into every document, and the app and plain Node must produce the same bytes.
export const SCHEMA_URL = `https://raw.githubusercontent.com/${GITHUB_REPO}/main/schema/showmeway-schema.json`;

/**
 * The deployment's own address: what a link printed by `trip:sync` opens in, and what the
 * privacy policy names. In-app links come from the page instead, which the /show-me-way/
 * Pages copy and localhost both need.
 */
export const SITE_URL = "https://trip.hsin19.com/";

const DEFAULT_GOOGLE_CLIENT_ID = "849908319136-che7nc9nag6ua5gd3fipk9evme4ngjde.apps.googleusercontent.com";

/**
 * The web OAuth client behind Drive sync. The default is tied to this repo's authorized
 * JavaScript origins; `trip:sync`'s Desktop client has to sit in the same Cloud project.
 */
export function googleClientId(): string {
    return envValue(import.meta.env?.VITE_GOOGLE_CLIENT_ID) ?? DEFAULT_GOOGLE_CLIENT_ID;
}

const DEFAULT_HOP_BASE_URL = "https://hop.hsin19.com";

/** hop's origin, without a trailing slash. Anything that reduces to nothing falls back rather than making requests same-origin. */
export function hopBaseUrl(): string {
    return envValue(import.meta.env?.VITE_HOP_BASE_URL)?.replace(/\/+$/, "") || DEFAULT_HOP_BASE_URL;
}
