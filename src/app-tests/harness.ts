import { FIXTURE_YAML } from "$lib/testing/fixture-trip";
import {
    screen,
    within,
} from "@testing-library/dom";
import {
    type UserEvent,
    userEvent,
} from "@testing-library/user-event";
import {
    afterEach,
    vi,
} from "vitest";

// The in-process counterpart of the Playwright fixtures: the whole App mounted into
// happy-dom, driven only through the DOM, with the network and the device replaced at
// their boundaries. `AppPage` mirrors the slice of Playwright's `page` the specs used,
// so a spec reads the same here. Every store is a module singleton, so each mount
// re-imports the module graph — that is what makes `goto()` / `reload()` a fresh page
// over the same localStorage, the way a second tab in one browser context is.

// Compiles the App graph while the test file is still being collected: under a parallel
// coverage run that first transform alone outlasts the 5s test timeout. `mountApp`
// still resets and re-imports, which reuses these transforms and only re-evaluates.
await import("../App.svelte");

const ORIGIN = "http://localhost:8046";
// A Vite glob rather than `node:fs`: the src tsconfig has no node types. The personal
// itinerary is left out, so the fallback chain always lands on the bundled template.
const PUBLIC_FILES: Record<string, string> = import.meta.glob(["/public/**/*.{yaml,json}", "!/public/itinerary.local.yaml"], { query: "?raw", import: "default", eager: true });

// The spec marks `animation.finished` handled when `cancel()` rejects it, so a browser
// stays quiet when svelte cancels an outro; happy-dom does not, and every cancelled
// transition would surface as an unhandled AbortError. Patched once per file, not per
// launch: the prototype outlives every mount, and re-wrapping it nests without end.
// eslint-disable-next-line @typescript-eslint/unbound-method -- re-applied below with the element as `this`.
const animate = Element.prototype.animate;
Element.prototype.animate = function (this: Element, ...args: Parameters<Element["animate"]>) {
    const animation = animate.apply(this, args);
    animation.finished.catch(() => {});
    return animation;
};

// The real console, taken before any page spies on it: each `createPage` installs fresh
// spies, and one that called through to a previous spy would recurse.
const CONSOLE_LEVELS = ["log", "info", "warn", "error", "debug"] as const;
const realConsole = Object.fromEntries(CONSOLE_LEVELS.map(level => [level, console[level].bind(console)])) as Record<typeof CONSOLE_LEVELS[number], (...args: unknown[]) => void>;

// Timers outlive the unmount of the app that armed them: a debounce set in one test
// would fire in the next, against that test's localStorage. Everything scheduled while
// an app is mounted is cancelled with it. The real functions stay reachable for the
// harness's own waits, which must survive a `goto`.
const realSetTimeout = globalThis.setTimeout;
const realSetInterval = globalThis.setInterval;
const mountTimeouts = new Set<ReturnType<typeof setTimeout>>();
const mountIntervals = new Set<ReturnType<typeof setInterval>>();
let trackingTimers = false;
globalThis.setTimeout = ((...args: Parameters<typeof setTimeout>) => {
    const id = realSetTimeout(...args);
    if (trackingTimers) mountTimeouts.add(id);
    return id;
}) as typeof setTimeout;
globalThis.setInterval = ((...args: Parameters<typeof setInterval>) => {
    const id = realSetInterval(...args);
    if (trackingTimers) mountIntervals.add(id);
    return id;
}) as typeof setInterval;

/** A string matches every URL that starts with it. */
type RouteMatcher = string | RegExp | ((url: URL) => boolean);
export type RouteHandler = (request: Request) => Response | Promise<Response>;

/** Function-valued members rather than methods, so a test can destructure them. */
export interface AppPage {
    readonly user: UserEvent;
    /**
     * Answers matching requests. The route registered last wins, as in Playwright;
     * unmatched same-origin requests are served from `public/` and every other origin
     * rejects, as the Playwright fixture's abort does. Register before the `goto` that
     * needs it — the app fetches during startup.
     */
    route: (match: RouteMatcher, handler: RouteHandler) => void;
    /** Answers for the next `confirm()`s, in order. Past the last one every dialog is dismissed, as Playwright does without a listener. */
    answerDialogs: (...answers: boolean[]) => void;
    /** Every message `confirm()` / `alert()` showed, in order. */
    readonly dialogs: readonly string[];
    /** The last text the app copied; empty until it copies. `navigator.share` is absent, so sharing always takes the clipboard path. */
    copiedText: () => string;
    /** Every console message the app wrote, as the text Playwright's `message.text()` would give. */
    readonly consoleMessages: readonly string[];
    /**
     * Resolves on the next console message that matches — only messages written after the
     * call — one macrotask after it was written, as Playwright's console event arrives:
     * whatever the app does synchronously after logging has run by then.
     */
    waitForConsole: (match: string | RegExp) => Promise<string>;
    /** Replaces a field's value as Playwright's `fill` does. Pasted, not typed: user-event reads `[` and `{` as key descriptors. */
    fill: (field: HTMLElement, text: string) => Promise<void>;
    /** Unmount and mount again at `path` over the same localStorage: a navigation, or a second tab in the same browser context. */
    goto: (path?: string) => Promise<void>;
    /** `goto` the current URL, as `page.reload()` does. */
    reload: () => Promise<void>;
    url: () => string;
    /** Sets `document.visibilityState` and fires `visibilitychange`, as leaving or returning to the app does. */
    setVisibility: (state: DocumentVisibilityState) => void;
}

export interface PageOptions {
    /** The active trip seeded into `showmeway_user_yaml`; `null` seeds none. */
    yaml?: string | null;
}

let closeMounted: (() => void) | undefined;

/** Boots the way `main.ts` does: the theme resolved first, then App mounted. */
async function mountApp(): Promise<void> {
    vi.resetModules();
    trackingTimers = true;
    // Imported after the reset along with App: `mount` from a svelte instance other
    // than the one App was compiled against has no component context to run in.
    const { mount, unmount } = await import("svelte");
    const { initTheme } = await import("$lib/stores/theme.svelte");
    const { default: App } = await import("../App.svelte");
    initTheme();
    const target = document.createElement("div");
    document.body.appendChild(target);
    const app = mount(App, { target });
    closeMounted = () => void unmount(app);
}

/** What a fresh page would not inherit: the DOM, the title, `<html>`'s attributes, pending timers. */
function closeApp(): void {
    closeMounted?.();
    closeMounted = undefined;
    trackingTimers = false;
    for (const id of mountTimeouts) clearTimeout(id);
    for (const id of mountIntervals) clearInterval(id);
    mountTimeouts.clear();
    mountIntervals.clear();
    document.body.innerHTML = "";
    document.title = "";
    for (const { name } of [...document.documentElement.attributes]) document.documentElement.removeAttribute(name);
}

afterEach(closeApp);

function matches(match: RouteMatcher, url: URL): boolean {
    if (typeof match === "string") return url.href.startsWith(match);
    if (match instanceof RegExp) return match.test(url.href);
    return match(url);
}

function toRequest(input: RequestInfo | URL, init?: RequestInit): Request {
    if (input instanceof Request) return input;
    return new Request(new URL(String(input), `${ORIGIN}/`), init);
}

function messageText(args: unknown[]): string {
    return args.map(arg => (arg instanceof Error ? String(arg) : typeof arg === "string" ? arg : JSON.stringify(arg))).join(" ");
}

/**
 * A fresh page on a cleared localStorage, not yet navigated: register routes, dialog
 * answers and extra storage first, then `goto`. The install offer is pre-declined —
 * `pwa-install.svelte.ts` raises it on a timer, and its toast would share the status
 * region with the one a test is reading.
 */
export function createPage(options: PageOptions = {}): AppPage {
    const { yaml = FIXTURE_YAML } = options;
    window.localStorage.clear();
    if (yaml !== null) window.localStorage.setItem("showmeway_user_yaml", yaml);
    window.localStorage.setItem("showmeway_pwa_install_dismissed", String(Date.now()));

    const routes: { match: RouteMatcher; handler: RouteHandler; }[] = [];
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = toRequest(input, init);
        const url = new URL(request.url);
        const route = routes.findLast(r => matches(r.match, url));
        if (route) return await route.handler(request);
        if (url.origin !== ORIGIN) throw new TypeError(`blocked: ${url.href}`);
        const body = PUBLIC_FILES[`/public${url.pathname}`];
        return body === undefined ? new Response("not found", { status: 404 }) : new Response(body, { status: 200 });
    });

    const answers: boolean[] = [];
    const dialogs: string[] = [];
    vi.stubGlobal("confirm", (message?: string) => {
        dialogs.push(String(message ?? ""));
        return answers.shift() ?? false;
    });
    vi.stubGlobal("alert", (message?: string) => void dialogs.push(String(message ?? "")));

    // After `userEvent.setup()`, which installs a clipboard stub of its own on `navigator`.
    const user = userEvent.setup();
    let copied = "";
    Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
            writeText: (text: string) => {
                copied = String(text);
                return Promise.resolve();
            },
            readText: () => Promise.resolve(copied),
        },
    });
    Object.defineProperty(navigator, "share", { configurable: true, value: undefined });

    const consoleMessages: string[] = [];
    const consoleWaiters: { match: string | RegExp; resolve: (text: string) => void; }[] = [];
    for (const level of CONSOLE_LEVELS) {
        vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
            const text = messageText(args);
            consoleMessages.push(text);
            for (const waiter of consoleWaiters.splice(0)) {
                const hit = typeof waiter.match === "string" ? text.includes(waiter.match) : waiter.match.test(text);
                if (hit) realSetTimeout(() => waiter.resolve(text), 0);
                else consoleWaiters.push(waiter);
            }
            realConsole[level](...args);
        });
    }

    let visibility: DocumentVisibilityState = "visible";
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => visibility });
    Object.defineProperty(document, "hidden", { configurable: true, get: () => visibility === "hidden" });

    const page: AppPage = {
        user,
        route: (match, handler) => void routes.push({ match, handler }),
        answerDialogs: (...next) => void answers.push(...next),
        dialogs,
        copiedText: () => copied,
        consoleMessages,
        waitForConsole: match => new Promise(resolve => consoleWaiters.push({ match, resolve })),
        fill: async (field, text) => {
            await user.clear(field);
            await user.paste(text);
        },
        goto: async (path = "/") => {
            closeApp();
            window.history.replaceState(null, "", new URL(path, `${ORIGIN}/`).href);
            await mountApp();
        },
        reload: () => {
            const { pathname, search, hash } = window.location;
            return page.goto(`${pathname}${search}${hash}`);
        },
        url: () => window.location.href,
        setVisibility: state => {
            visibility = state;
            document.dispatchEvent(new Event("visibilitychange"));
        },
    };
    return page;
}

/** `createPage` with `yaml` seeded, navigated to `/`. */
export async function launchApp(yaml: string = FIXTURE_YAML): Promise<AppPage> {
    const page = createPage({ yaml });
    await page.goto("/");
    return page;
}

/** A bottom-nav tab: 行程, 工具 or AI. */
export function navTab(name: string): HTMLElement {
    return within(screen.getByRole("navigation")).getByRole("button", { name });
}

/** The first day's chip in the itinerary strip, which opens that day's panel. */
export function firstDayChip(): HTMLElement {
    const chip = document.querySelector<HTMLElement>("button[data-day]");
    if (!chip) throw new Error("no day chip rendered");
    return chip;
}

/** The live region every toast is announced in. */
export function status(): HTMLElement {
    return screen.getByRole("status");
}

/** A checklist card on 行前準備 (待辦事項 or 隨身行李與打包); it has no landmark, so it is reached through its heading. */
export function checklist(title: string): HTMLElement {
    return screen.getByRole("heading", { name: title }).parentElement!;
}

/** 工具 → 行程管理, the page that holds the profile switcher, the YAML editor and Drive sync. */
export async function openTripManagement(user: UserEvent): Promise<void> {
    await user.click(navTab("工具"));
    await user.click(screen.getByRole("button", { name: "行程管理" }));
    await screen.findByRole("heading", { name: "行程管理" });
}
