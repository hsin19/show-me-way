// App-wide light/dark theme. The preference is a property of the device, not of a
// trip, so it has its own key and never travels with a profile.
//
// `data-theme` on <html> is the only switch the CSS sees — every Tailwind utility
// compiles to a `var(--color-*)` that app.css redeclares under
// `:root[data-theme="light"]`. index.html runs this same resolution inline before
// first paint; keep the two in sync, and `e2e/tests/theme.spec.ts` catches it if
// they drift.

export const THEME_KEY = "showmeway_theme";

/** What the user chose. `system` follows the OS setting live. */
export type ThemePref = "system" | "dark" | "light";

/** What actually gets rendered once `system` is resolved. */
type ResolvedTheme = "dark" | "light";

const DARK_QUERY = "(prefers-color-scheme: dark)";

function isPref(value: unknown): value is ThemePref {
    return value === "system" || value === "dark" || value === "light";
}

/** `system` for an unset or unreadable preference — a private-mode read can throw. */
export function readThemePref(): ThemePref {
    try {
        const stored = localStorage.getItem(THEME_KEY);
        return isPref(stored) ? stored : "system";
    } catch {
        return "system";
    }
}

export function resolveTheme(preference: ThemePref): ResolvedTheme {
    if (preference !== "system") return preference;
    return window.matchMedia(DARK_QUERY).matches ? "dark" : "light";
}

let pref = $state<ThemePref>("system");
let resolved = $state<ResolvedTheme>("dark");

/** Read-only reactive view for components, same pattern as `toast`. */
export const theme = {
    /** The user's choice, `system` included — what the picker binds to. */
    get pref() {
        return pref;
    },
    /** What is actually on screen right now. */
    get resolved() {
        return resolved;
    },
};

function apply(next: ResolvedTheme): void {
    resolved = next;
    document.documentElement.dataset.theme = next;

    // Keeps the Android address bar and iOS status area in step. Read back from
    // the stylesheet rather than restated here, and read *after* the attribute is
    // set, or this picks up the outgoing theme.
    //
    // Every matching meta is updated, not just the first: index.html has one and
    // vite-plugin-pwa injects another from `manifest.theme_color`. Tree order
    // decides which wins, but a second one left on a stale value is a trap.
    const chrome = getComputedStyle(document.documentElement).getPropertyValue("--color-bg-main").trim();
    if (!chrome) return;
    for (const meta of document.querySelectorAll('meta[name="theme-color"]')) {
        meta.setAttribute("content", chrome);
    }
}

/** Applies immediately; persisting is best-effort, so the switch works even in private mode. */
export function setThemePref(next: ThemePref): void {
    pref = next;
    try {
        localStorage.setItem(THEME_KEY, next);
    } catch {
        // Only costs the user the preference surviving a reload.
    }
    apply(resolveTheme(next));
}

/**
 * Call once from `main.ts` before mount. The boot script has already set the
 * attribute, so this is about module state and about following the OS from here
 * on while the preference is `system`.
 */
export function initTheme(): void {
    pref = readThemePref();
    apply(resolveTheme(pref));
    window.matchMedia(DARK_QUERY).addEventListener("change", event => {
        if (pref === "system") apply(event.matches ? "dark" : "light");
    });
}
