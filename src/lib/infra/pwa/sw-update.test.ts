// The module keeps session state (`swRegistration`, `lastSwUpdateCheck`,
// `initialized`) that no exported function resets — by design, since a page
// load is the only thing that should. Every test therefore re-imports it
// through `vi.resetModules()`; `toast.svelte` is pulled in from the same fresh
// graph so the store under test is the one the module actually writes to.
//
// `registerSW` comes from a virtual Vite module vitest.config.ts never wires up
// (it deliberately skips the app's PWA plugin), so it is mocked here rather than
// resolved for real. The mock must be declared via `vi.hoisted` — a plain
// module-scope `let` referenced inside `vi.mock`'s factory would be read before
// its own initializer runs, since `vi.mock` calls are hoisted above imports.

import type { RegisterSWOptions } from "vite-plugin-pwa/types";
import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from "vitest";

const { registerSWMock, updateSWMock, getRegisterOptions } = vi.hoisted(() => {
    let captured: RegisterSWOptions | undefined;
    const updateSWMock = vi.fn(() => Promise.resolve());
    const registerSWMock = vi.fn((options: RegisterSWOptions) => {
        captured = options;
        return updateSWMock;
    });
    return { registerSWMock, updateSWMock, getRegisterOptions: () => captured };
});

vi.mock("virtual:pwa-register", () => ({ registerSW: registerSWMock }));

type SwUpdateModule = typeof import("./sw-update");
type ToastModule = typeof import("../../stores/toast.svelte");

let swUpdate: SwUpdateModule;
let toastModule: ToastModule;

const SW_UPDATE_CHECK_MS = 60 * 60 * 1000;

// `update` is returned alongside rather than read back off `registration`:
// `ServiceWorkerRegistration.update` is a real interface method, so a
// reference to it via the cast object trips `@typescript-eslint/unbound-method`.
function createRegistration(installing: object | null = null) {
    const update = vi.fn(() => Promise.resolve());
    const registration = { installing, update } as unknown as ServiceWorkerRegistration;
    return { registration, update };
}

/** Runs init and delivers the registration, as `onRegisteredSW` would after a real register(). */
function registerWith(registration: ServiceWorkerRegistration) {
    swUpdate.initServiceWorkerUpdates();
    getRegisterOptions()?.onRegisteredSW?.("/sw.js", registration);
}

// The module (and toast.svelte's own `window.setTimeout` for a non-persistent
// toast) both reach `window` directly, which `environment: "node"` does not
// provide. Delegating to the bare (fake-timer-patched) globals keeps
// `vi.advanceTimersByTime` in control of both.
function stubWindow() {
    vi.stubGlobal("window", {
        setInterval: (handler: () => void, timeout?: number) => setInterval(handler, timeout),
        setTimeout: (handler: () => void, timeout?: number) => setTimeout(handler, timeout),
    });
}

async function loadModule() {
    vi.resetModules();
    registerSWMock.mockClear();
    updateSWMock.mockClear();
    swUpdate = await import("./sw-update");
    toastModule = await import("../../stores/toast.svelte");
}

describe("sw-update module", () => {
    beforeEach(async () => {
        vi.useFakeTimers();
        stubWindow();
        vi.stubGlobal("navigator", { onLine: true });
        await loadModule();
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });

    describe("initServiceWorkerUpdates", () => {
        it("registers the service worker exactly once, even across repeated calls", () => {
            swUpdate.initServiceWorkerUpdates();
            swUpdate.initServiceWorkerUpdates();
            expect(registerSWMock).toHaveBeenCalledTimes(1);
        });

        it("shows a persistent update toast when a new worker is waiting", () => {
            swUpdate.initServiceWorkerUpdates();
            getRegisterOptions()?.onNeedRefresh?.();

            expect(toastModule.toast.items).toHaveLength(1);
            const [toastItem] = toastModule.toast.items;
            expect(toastItem.message).toBe("已有新版本");
            expect(toastItem.kind).toBe("update");
            expect(toastItem.persist).toBe(true);
            expect(toastItem.action?.label).toBe("立即更新");
        });

        it("reloads via updateSW(true) when the toast action is taken", () => {
            swUpdate.initServiceWorkerUpdates();
            getRegisterOptions()?.onNeedRefresh?.();
            toastModule.runToastAction(toastModule.toast.items[0].id);

            expect(updateSWMock).toHaveBeenCalledWith(true);
        });

        // The bug this guards: two deploys landing in one long session must not
        // stack two immortal "已有新版本" notices.
        it("dedupes a second onNeedRefresh instead of stacking a toast", () => {
            swUpdate.initServiceWorkerUpdates();
            getRegisterOptions()?.onNeedRefresh?.();
            const firstId = toastModule.toast.items[0].id;
            getRegisterOptions()?.onNeedRefresh?.();

            expect(toastModule.toast.items).toHaveLength(1);
            expect(toastModule.toast.items[0].id).not.toBe(firstId);
        });

        it("announces offline readiness", () => {
            swUpdate.initServiceWorkerUpdates();
            getRegisterOptions()?.onOfflineReady?.();

            expect(toastModule.toast.items).toHaveLength(1);
            expect(toastModule.toast.items[0].message).toBe("已可離線使用");
        });

        it("ignores a registration callback with no registration", () => {
            swUpdate.initServiceWorkerUpdates();
            expect(() => getRegisterOptions()?.onRegisteredSW?.("/sw.js", undefined)).not.toThrow();

            vi.advanceTimersByTime(SW_UPDATE_CHECK_MS);
            expect(() => swUpdate.checkForSwUpdate()).not.toThrow();
        });
    });

    describe("checkForSwUpdate", () => {
        it("does nothing before any registration has arrived", () => {
            expect(() => swUpdate.checkForSwUpdate()).not.toThrow();
        });

        it("skips while a worker is still installing", () => {
            const { registration, update } = createRegistration({});
            registerWith(registration);
            vi.advanceTimersByTime(SW_UPDATE_CHECK_MS);

            swUpdate.checkForSwUpdate();
            expect(update).not.toHaveBeenCalled();
        });

        it("skips while offline", () => {
            const { registration, update } = createRegistration();
            registerWith(registration);
            vi.stubGlobal("navigator", { onLine: false });
            vi.advanceTimersByTime(SW_UPDATE_CHECK_MS);

            swUpdate.checkForSwUpdate();
            expect(update).not.toHaveBeenCalled();
        });

        it("throttles a check inside the window right after registering", () => {
            const { registration, update } = createRegistration();
            registerWith(registration);

            swUpdate.checkForSwUpdate();
            expect(update).not.toHaveBeenCalled();
        });

        it("checks again on a manual call once the throttle window has fully elapsed", () => {
            const { registration, update } = createRegistration();
            registerWith(registration);
            // Drop the auto-poll interval onRegisteredSW started, so only the
            // manual call below is under test — the interval covers itself
            // separately, below.
            vi.clearAllTimers();
            vi.advanceTimersByTime(SW_UPDATE_CHECK_MS);

            swUpdate.checkForSwUpdate();
            expect(update).toHaveBeenCalledTimes(1);
        });

        it("swallows a rejected update() so an offline check never throws", () => {
            const { registration, update } = createRegistration();
            // A factory, not `mockReturnValue`: the rejection must not exist until
            // `checkForSwUpdate` calls `update()` and chains `.catch()` in the same
            // tick, or Node reports it as unhandled before that catch attaches.
            update.mockImplementation(() => Promise.reject(new Error("offline")));
            registerWith(registration);
            vi.advanceTimersByTime(SW_UPDATE_CHECK_MS);

            expect(() => swUpdate.checkForSwUpdate()).not.toThrow();
        });

        it("also fires from the interval onRegisteredSW starts, not just manual calls", () => {
            const { registration, update } = createRegistration();
            registerWith(registration);

            vi.advanceTimersByTime(SW_UPDATE_CHECK_MS);
            expect(update).toHaveBeenCalledTimes(1);
        });
    });
});
