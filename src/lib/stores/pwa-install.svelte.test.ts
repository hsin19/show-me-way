import { createLocalStorageStub } from "$lib/testing/stubs";
// The module keeps session state (`deferredPrompt`, `initialized`, `toastShown`)
// that no exported function resets — by design, since a page load is the only
// thing that should. Every test therefore re-imports it through
// `vi.resetModules()`; `toast.svelte` is pulled in from the same fresh graph so
// the store under test is the one `showPwaInstallToast` actually writes to.

import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from "vitest";

type PwaModule = typeof import("./pwa-install.svelte");
type ToastModule = typeof import("./toast.svelte");

let pwa: PwaModule;
let toastModule: ToastModule;

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const FALLBACK_DELAY_MS = 3500;
const TOAST_MS = 10000;

const MAC_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)";
const IPHONE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)";

/** Captures listeners so a test can fire `beforeinstallprompt` by hand. */
function createWindowStub({ standalone = false } = {}) {
    const listeners = new Map<string, ((event: unknown) => void)[]>();
    return {
        listeners,
        setTimeout: (handler: () => void, timeout?: number) => setTimeout(handler, timeout),
        addEventListener(type: string, handler: (event: unknown) => void) {
            listeners.set(type, [...(listeners.get(type) ?? []), handler]);
        },
        matchMedia: (query: string) => ({
            matches: standalone && query.includes("display-mode: standalone"),
            media: query,
        }),
    };
}

function createInstallEvent(outcome: "accepted" | "dismissed" = "accepted") {
    return {
        preventDefault: vi.fn(),
        prompt: vi.fn(() => Promise.resolve()),
        userChoice: Promise.resolve({ outcome }),
    };
}

function stubWindow(options?: { standalone?: boolean; }) {
    const win = createWindowStub(options);
    vi.stubGlobal("window", win);
    return win;
}

function fireInstallPrompt(win: ReturnType<typeof createWindowStub>, event: unknown) {
    for (const handler of win.listeners.get("beforeinstallprompt") ?? []) handler(event);
}

async function loadModule() {
    vi.resetModules();
    // pwa-install imports toast, so this second import resolves to the very same
    // instance the module under test just wired itself to.
    pwa = await import("./pwa-install.svelte");
    toastModule = await import("./toast.svelte");
}

describe("pwa-install module", () => {
    beforeEach(async () => {
        vi.useFakeTimers();
        vi.stubGlobal("localStorage", createLocalStorageStub());
        stubWindow();
        vi.stubGlobal("navigator", { userAgent: MAC_UA, standalone: false });
        await loadModule();
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });

    describe("isStandaloneMode", () => {
        it("returns false for standard web context", () => {
            expect(pwa.isStandaloneMode()).toBe(false);
        });

        it("returns true when display-mode is standalone", () => {
            stubWindow({ standalone: true });
            expect(pwa.isStandaloneMode()).toBe(true);
        });

        it("returns true when navigator.standalone is true (iOS)", () => {
            vi.stubGlobal("navigator", { userAgent: IPHONE_UA, standalone: true });
            expect(pwa.isStandaloneMode()).toBe(true);
        });
    });

    describe("isIosDevice", () => {
        it("detects iPhone/iPad user agents", () => {
            vi.stubGlobal("navigator", { userAgent: IPHONE_UA });
            expect(pwa.isIosDevice()).toBe(true);
        });

        it("returns false for Android or Mac Desktop", () => {
            vi.stubGlobal("navigator", { userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 8)" });
            expect(pwa.isIosDevice()).toBe(false);
        });
    });

    describe("dismissal persistence (7-day cool-off)", () => {
        it("returns false initially", () => {
            expect(pwa.isInstallDismissedRecently()).toBe(false);
        });

        it("returns true immediately after markInstallDismissed", () => {
            pwa.markInstallDismissed();
            expect(pwa.isInstallDismissedRecently()).toBe(true);
        });

        it("returns false after 7 days have passed", () => {
            pwa.markInstallDismissed();
            vi.advanceTimersByTime(SEVEN_DAYS_MS + 1);
            expect(pwa.isInstallDismissedRecently()).toBe(false);
        });

        it("treats a stamp in the future as expired (clock rolled back)", () => {
            localStorage.setItem(pwa.PWA_INSTALL_DISMISSED_KEY, String(Date.now() + SEVEN_DAYS_MS));
            expect(pwa.isInstallDismissedRecently()).toBe(false);
        });

        it("ignores a non-numeric stamp", () => {
            localStorage.setItem(pwa.PWA_INSTALL_DISMISSED_KEY, "nonsense");
            expect(pwa.isInstallDismissedRecently()).toBe(false);
        });
    });

    describe("showPwaInstallToast", () => {
        it("does not show a toast if already in standalone mode", () => {
            stubWindow({ standalone: true });
            pwa.showPwaInstallToast();
            expect(toastModule.toast.items).toHaveLength(0);
        });

        it("shows the offer with an action and an explicit close button", () => {
            pwa.showPwaInstallToast();
            expect(toastModule.toast.items).toHaveLength(1);
            expect(toastModule.toast.items[0]?.message).toBe("將 ShowMeWay 新增至主畫面？");
            expect(toastModule.toast.items[0]?.action?.label).toBe("安裝");
            expect(toastModule.toast.items[0]?.kind).toBe("download");
            expect(toastModule.toast.items[0]?.showDismiss).toBe(true);
        });

        it("starts the cool-off when the toast expires unanswered", () => {
            pwa.showPwaInstallToast();
            expect(localStorage.getItem(pwa.PWA_INSTALL_DISMISSED_KEY)).toBeNull();

            vi.advanceTimersByTime(TOAST_MS);
            expect(toastModule.toast.items).toHaveLength(0);
            expect(pwa.isInstallDismissedRecently()).toBe(true);
        });

        it("starts the cool-off when the user closes it with ✕", () => {
            pwa.showPwaInstallToast();
            toastModule.dismissToast(toastModule.toast.items[0]!.id);
            expect(pwa.isInstallDismissedRecently()).toBe(true);
        });

        it("does NOT start the cool-off when the user taps 安裝", () => {
            const navigate = vi.fn();
            pwa.setNavigateToAppSettings(navigate);

            pwa.showPwaInstallToast();
            toastModule.runToastAction(toastModule.toast.items[0]!.id);

            expect(navigate).toHaveBeenCalledTimes(1);
            expect(toastModule.toast.items).toHaveLength(0);
            expect(pwa.isInstallDismissedRecently()).toBe(false);
        });
    });

    describe("promptPwaInstall", () => {
        it("returns false with no deferred event", async () => {
            expect(pwa.canPromptPwaInstall()).toBe(false);
            expect(await pwa.promptPwaInstall()).toBe(false);
        });

        it("prompts once and reports acceptance", async () => {
            const win = stubWindow();
            pwa.initPwaInstallPrompt();
            const event = createInstallEvent("accepted");
            fireInstallPrompt(win, event);

            expect(pwa.canPromptPwaInstall()).toBe(true);
            expect(await pwa.promptPwaInstall()).toBe(true);
            expect(event.prompt).toHaveBeenCalledTimes(1);
            expect(pwa.canPromptPwaInstall()).toBe(false);
        });

        it("spends the event even when declined, so the button cannot be re-tapped", async () => {
            const win = stubWindow();
            pwa.initPwaInstallPrompt();
            const event = createInstallEvent("dismissed");
            fireInstallPrompt(win, event);

            expect(await pwa.promptPwaInstall()).toBe(false);
            // The spec lets prompt() run only once; a second attempt must not reach it.
            expect(pwa.canPromptPwaInstall()).toBe(false);
            expect(await pwa.promptPwaInstall()).toBe(false);
            expect(event.prompt).toHaveBeenCalledTimes(1);
        });
    });

    describe("handleInstallAction", () => {
        it("navigates to App 設定 when the browser gave us nothing to prompt with", () => {
            vi.stubGlobal("navigator", { userAgent: IPHONE_UA });
            const navigate = vi.fn();
            pwa.setNavigateToAppSettings(navigate);

            pwa.handleInstallAction();
            expect(navigate).toHaveBeenCalledTimes(1);
        });

        it("runs the native prompt instead of navigating when one is available", () => {
            const win = stubWindow();
            pwa.initPwaInstallPrompt();
            const event = createInstallEvent("accepted");
            fireInstallPrompt(win, event);

            const navigate = vi.fn();
            pwa.setNavigateToAppSettings(navigate);
            pwa.handleInstallAction();

            expect(event.prompt).toHaveBeenCalledTimes(1);
            expect(navigate).not.toHaveBeenCalled();
        });
    });

    describe("initPwaInstallPrompt", () => {
        it("raises the offer on a timer where beforeinstallprompt never fires", () => {
            pwa.initPwaInstallPrompt();
            expect(toastModule.toast.items).toHaveLength(0);

            vi.advanceTimersByTime(FALLBACK_DELAY_MS);
            expect(toastModule.toast.items).toHaveLength(1);
        });

        it("shows the offer as soon as beforeinstallprompt fires", () => {
            const win = stubWindow();
            pwa.initPwaInstallPrompt();
            fireInstallPrompt(win, createInstallEvent());
            expect(toastModule.toast.items).toHaveLength(1);
        });

        // The bug this guards: the fallback timer used to fire regardless, and the
        // dedupe replacement it triggered counted as a dismissal — so the cool-off
        // started 3.5s in, on a toast the user was still looking at.
        it("does not restart the toast (or the cool-off) when the event already asked", () => {
            const win = stubWindow();
            pwa.initPwaInstallPrompt();
            fireInstallPrompt(win, createInstallEvent());
            const shownId = toastModule.toast.items[0]!.id;

            vi.advanceTimersByTime(FALLBACK_DELAY_MS);
            expect(toastModule.toast.items).toHaveLength(1);
            expect(toastModule.toast.items[0]?.id).toBe(shownId);
            expect(pwa.isInstallDismissedRecently()).toBe(false);

            // ...and the original 10s window still ends on schedule, not 13.5s in.
            vi.advanceTimersByTime(TOAST_MS - FALLBACK_DELAY_MS);
            expect(toastModule.toast.items).toHaveLength(0);
            expect(pwa.isInstallDismissedRecently()).toBe(true);
        });

        it("stays quiet during the cool-off, on both paths", () => {
            pwa.markInstallDismissed();
            const win = stubWindow();
            pwa.initPwaInstallPrompt();

            fireInstallPrompt(win, createInstallEvent());
            vi.advanceTimersByTime(FALLBACK_DELAY_MS);
            expect(toastModule.toast.items).toHaveLength(0);
            // The event is still captured — App 設定 can offer the button on demand.
            expect(pwa.canPromptPwaInstall()).toBe(true);
        });

        it("does nothing at all once installed", () => {
            const win = stubWindow({ standalone: true });
            pwa.initPwaInstallPrompt();

            expect(win.listeners.size).toBe(0);
            vi.advanceTimersByTime(FALLBACK_DELAY_MS);
            expect(toastModule.toast.items).toHaveLength(0);
        });

        it("only wires itself up once", () => {
            const win = stubWindow();
            pwa.initPwaInstallPrompt();
            pwa.initPwaInstallPrompt();

            expect(win.listeners.get("beforeinstallprompt")).toHaveLength(1);
            vi.advanceTimersByTime(FALLBACK_DELAY_MS);
            expect(toastModule.toast.items).toHaveLength(1);
        });
    });
});
