// App-wide light/dark theme. The preference is app-level (not part of a trip),
// so it lives in its own localStorage key and never travels with a profile or
// the itinerary YAML.
//
// Only `data-theme` on <html> matters to the CSS: `src/app.css` overrides the
// design tokens under `:root[data-theme="light"]`, and every Tailwind utility
// compiles to `var(--color-*)`, so flipping the attribute re-themes the app with
// no rebuild. The same resolution runs in an inline <head> script in index.html
// to set the attribute before first paint — keep the two in sync.

export const THEME_KEY = "showmeway_theme";

/** What the user chose. `system` follows the OS setting live. */
export type ThemePref = "system" | "dark" | "light";

/** What actually gets rendered once `system` is resolved. */
export type ResolvedTheme = "dark" | "light";

const DARK_QUERY = "(prefers-color-scheme: dark)";

function isPref(value: unknown): value is ThemePref {
    return value === "system" || value === "dark" || value === "light";
}

/** Read the stored preference, defaulting to `system`. Private-mode reads can throw. */
export function readThemePref(): ThemePref {
    try {
        const stored = localStorage.getItem(THEME_KEY);
        return isPref(stored) ? stored : "system";
    } catch {
        return "system";
    }
}

/** Resolve a preference against the OS setting. */
export function resolveTheme(preference: ThemePref): ResolvedTheme {
    if (preference !== "system") return preference;
    return window.matchMedia(DARK_QUERY).matches ? "dark" : "light";
}

let pref = $state<ThemePref>("system");
let resolved = $state<ResolvedTheme>("dark");

/** Read-only reactive view for components (same pattern as `toast`). */
export const theme = {
    /** The user's choice, including `system`. */
    get pref() {
        return pref;
    },
    /** The theme currently on screen. */
    get resolved() {
        return resolved;
    },
};

function apply(next: ResolvedTheme): void {
    resolved = next;
    document.documentElement.dataset.theme = next;

    // Keep the OS chrome (Android address bar, iOS status area) in step with the
    // page. The color is read back from the stylesheet rather than duplicated
    // here, so `--color-bg-main` in app.css stays the single source of truth —
    // read *after* setting data-theme, or this picks up the outgoing theme.
    //
    // There are TWO theme-color metas: index.html's plus one vite-plugin-pwa
    // injects from `manifest.theme_color`. The spec says the first in tree order
    // wins, but leaving the second on a stale value is a trap, so update every
    // one. (The manifest file itself keeps the dark value — it is baked at build
    // time and only feeds the install/splash screen.)
    const chrome = getComputedStyle(document.documentElement).getPropertyValue("--color-bg-main").trim();
    if (!chrome) return;
    for (const meta of document.querySelectorAll('meta[name="theme-color"]')) {
        meta.setAttribute("content", chrome);
    }
}

/** Change the preference and persist it. Writes can throw in private mode. */
export function setThemePref(next: ThemePref): void {
    pref = next;
    try {
        localStorage.setItem(THEME_KEY, next);
    } catch {
        // Preference just won't survive a reload; the live switch still works.
    }
    apply(resolveTheme(next));
}

/**
 * Adopt the stored preference and start following the OS while it is `system`.
 * Called once from `main.ts` before mount. The inline boot script has already
 * set the attribute, so this only re-syncs module state and the live listener.
 */
export function initTheme(): void {
    pref = readThemePref();
    apply(resolveTheme(pref));
    window.matchMedia(DARK_QUERY).addEventListener("change", event => {
        if (pref === "system") apply(event.matches ? "dark" : "light");
    });
}
