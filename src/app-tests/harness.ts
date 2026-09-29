import { FIXTURE_YAML } from "$lib/testing/fixture-trip";
import { userEvent } from "@testing-library/user-event";
import { vi } from "vitest";

// The in-process counterpart of the Playwright fixtures: the whole App mounted into
// happy-dom, driven only through the DOM, with the network and the device replaced at
// their boundaries. Every store is a module singleton, so each launch re-imports the
// module graph — that is what makes `reload()` a fresh page over the same localStorage.

// Compiles the App graph while the test file is still being collected: under a parallel
// coverage run that first transform alone outlasts the 5s test timeout. `mountApp`
// still resets and re-imports, which reuses these transforms and only re-evaluates.
await import("../App.svelte");

const ORIGIN = "http://localhost:8046";
// A Vite glob rather than `node:fs`: the src tsconfig has no node types. The personal
// itinerary is left out, so the fallback chain always lands on the bundled template.
const PUBLIC_FILES: Record<string, string> = import.meta.glob(["/public/**/*.{yaml,json,html}", "!/public/itinerary.local.yaml"], { query: "?raw", import: "default", eager: true });

/**
 * Same-origin requests are served from `public/`; every other origin rejects, as the
 * Playwright fixture's abort does. A test that needs a network feature stubs `fetch`
 * again on top of this.
 */
function fakeFetch(input: RequestInfo | URL): Promise<Response> {
    const url = new URL(input instanceof Request ? input.url : String(input), `${ORIGIN}/`);
    if (url.origin !== ORIGIN) return Promise.reject(new TypeError(`blocked: ${url.href}`));
    const body = PUBLIC_FILES[`/public${url.pathname}`];
    return Promise.resolve(body === undefined ? new Response("not found", { status: 404 }) : new Response(body, { status: 200 }));
}

/**
 * The spec marks `animation.finished` handled when `cancel()` rejects it, so a browser
 * stays quiet when svelte cancels an outro; happy-dom does not, and every cancelled
 * transition would surface as an unhandled AbortError.
 */
function quietCancelledAnimations(): void {
    // eslint-disable-next-line @typescript-eslint/unbound-method -- re-applied below with the element as `this`.
    const animate = Element.prototype.animate;
    vi.spyOn(Element.prototype, "animate").mockImplementation(function (this: Element, ...args: Parameters<Element["animate"]>) {
        const animation = animate.apply(this, args);
        animation.finished.catch(() => {});
        return animation;
    });
}

let closeMounted: (() => void) | undefined;

async function mountApp(): Promise<void> {
    vi.resetModules();
    // Imported after the reset along with App: `mount` from a svelte instance other
    // than the one App was compiled against has no component context to run in.
    const { mount, unmount } = await import("svelte");
    const { default: App } = await import("../App.svelte");
    const target = document.createElement("div");
    document.body.appendChild(target);
    const app = mount(App, { target });
    closeMounted = () => void unmount(app);
}

function closeApp(): void {
    closeMounted?.();
    closeMounted = undefined;
    document.body.innerHTML = "";
}

/**
 * Seeds the active trip, mounts the app and returns a user to drive it. Call
 * `closeApp` in `afterEach`, before the next launch.
 */
export async function launchApp(yaml: string = FIXTURE_YAML) {
    window.localStorage.clear();
    window.localStorage.setItem("showmeway_user_yaml", yaml);
    // `pwa-install.svelte.ts` raises its offer on a timer; declined up front so its
    // toast never shares the status region with the one a test is reading.
    window.localStorage.setItem("showmeway_pwa_install_dismissed", String(Date.now()));
    vi.stubGlobal("fetch", fakeFetch);
    quietCancelledAnimations();
    await mountApp();
    return {
        user: userEvent.setup(),
        /** Unmount and mount again over the same localStorage, as `page.reload()` does. */
        reload: async () => {
            closeApp();
            await mountApp();
        },
    };
}

export { closeApp };
