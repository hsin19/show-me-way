// The "you can install this" prompt: the `beforeinstallprompt` handoff, the
// per-browser manual route, and the one toast that raises the idea at all.
//
// The toast fires early on purpose — 3.5s in, before the user has typed a trip.
// An installed PWA on iOS gets its own storage partition, so an itinerary
// entered in the Safari tab does NOT follow the user into the home-screen app;
// prompting only after they have data would hand them two copies to reconcile.
//
// A `.svelte.ts` module because whether an install is on offer has to be a rune:
// `beforeinstallprompt` can land while App 設定 is already open, and the install
// button has to appear then (and disappear once the event is spent) without the
// page being remounted.

import { showToast } from "./toast.svelte";

export const PWA_INSTALL_DISMISSED_KEY = "showmeway_pwa_install_dismissed";
/** Don't raise it again for 7 days once the user dismissed or ignored the toast. */
const DISMISS_COOL_OFF_MS = 7 * 24 * 60 * 60 * 1000;
/** How long to wait for `beforeinstallprompt` before assuming it is never coming. */
const FALLBACK_DELAY_MS = 3500;
const TOAST_MS = 10000;

export interface BeforeInstallPromptEvent extends Event {
    prompt: () => Promise<void>;
    userChoice: Promise<{ outcome: "accepted" | "dismissed"; }>;
}

let deferredPrompt: BeforeInstallPromptEvent | null = null;
/**
 * `deferredPrompt !== null`, mirrored as a rune. The event stays out of `$state`
 * on purpose: only its *availability* is something the UI reacts to, and a live
 * DOM object has no business being handed to a deep proxy.
 */
let installAvailable = $state(false);
let initialized = false;
/** Whether the offer has already been put on screen this session. */
let toastShown = false;
let navigateToAppSettings: (() => void) | null = null;

function setDeferredPrompt(event: BeforeInstallPromptEvent | null): void {
    deferredPrompt = event;
    installAvailable = event !== null;
}

export function setNavigateToAppSettings(callback: () => void): void {
    navigateToAppSettings = callback;
}

export function isStandaloneMode(): boolean {
    if (typeof window === "undefined") return false;
    return (
        window.matchMedia("(display-mode: standalone)").matches
        || (navigator as unknown as { standalone?: boolean; }).standalone === true
    );
}

export function isIosDevice(): boolean {
    if (typeof window === "undefined") return false;
    return /iPad|iPhone|iPod/.test(navigator.userAgent)
        && !(window as unknown as { MSStream?: unknown; }).MSStream;
}

/**
 * Still inside the cool-off window. A stamp in the future means the clock moved
 * backwards since it was written — treated as expired rather than muting the
 * prompt until real time catches up, the same rule `isFresh` applies in
 * `storage-cache.ts`.
 */
export function isInstallDismissedRecently(): boolean {
    if (typeof window === "undefined") return false;
    const stamp = localStorage.getItem(PWA_INSTALL_DISMISSED_KEY);
    if (stamp === null) return false;
    const timestamp = Number.parseInt(stamp, 10);
    if (Number.isNaN(timestamp)) return false;
    const age = Date.now() - timestamp;
    return age >= 0 && age < DISMISS_COOL_OFF_MS;
}

export function markInstallDismissed(): void {
    if (typeof window === "undefined") return;
    localStorage.setItem(PWA_INSTALL_DISMISSED_KEY, Date.now().toString());
}

/** Whether the browser handed us an event we can still turn into a real install dialog. */
export function canPromptPwaInstall(): boolean {
    return installAvailable;
}

/**
 * Hand the deferred event back to the browser. Spent either way: a
 * `BeforeInstallPromptEvent` may only be `prompt()`ed once — a second call
 * rejects with InvalidStateError — so holding on to a declined one would leave
 * an install button that silently does nothing on every later tap.
 */
export async function promptPwaInstall(): Promise<boolean> {
    const event = deferredPrompt;
    if (!event) return false;
    setDeferredPrompt(null);
    try {
        await event.prompt();
        return (await event.userChoice).outcome === "accepted";
    } catch {
        return false;
    }
}

/**
 * The toast's 安裝 button. Chromium can install from right here; everywhere else
 * (iOS Safari, Firefox, Chrome over plain HTTP) the only route is the
 * per-browser instructions on the App 設定 page, so send the user there.
 */
export function handleInstallAction(): void {
    if (canPromptPwaInstall()) void promptPwaInstall();
    else navigateToAppSettings?.();
}

export function showPwaInstallToast(): void {
    if (isStandaloneMode()) return;
    toastShown = true;
    showToast({
        kind: "download",
        message: "將 ShowMeWay 新增至主畫面？",
        actionLabel: "安裝",
        durationMs: TOAST_MS,
        showDismiss: true,
        dedupeKey: "pwa-install",
        onAction: handleInstallAction,
        // Letting it expire counts as declining. The notice is informational and
        // re-raising it every launch is worse than the user missing it once.
        onDismiss: markInstallDismissed,
    });
}

export function initPwaInstallPrompt(onNavigateToAppSettings?: () => void): void {
    if (onNavigateToAppSettings) setNavigateToAppSettings(onNavigateToAppSettings);

    if (typeof window === "undefined" || initialized || isStandaloneMode()) return;
    initialized = true;

    // Chromium / Android: the browser offers to run the install dialog itself.
    window.addEventListener("beforeinstallprompt", event => {
        event.preventDefault();
        setDeferredPrompt(event as BeforeInstallPromptEvent);
        if (!isInstallDismissedRecently()) showPwaInstallToast();
    });

    // Everywhere else (iOS Safari, Firefox, Chrome over plain HTTP, local dev)
    // that event never fires, so raise it on a timer instead. `toastShown` is
    // what keeps the two paths from colliding on Chromium, where the listener
    // above has usually already asked: re-showing would restart the 10s window,
    // re-animate the pill, and — before the toast layer learned the difference
    // between "replaced" and "dismissed" — start the 7-day cool-off unprompted.
    window.setTimeout(() => {
        if (toastShown || isInstallDismissedRecently() || isStandaloneMode()) return;
        showPwaInstallToast();
    }, FALLBACK_DELAY_MS);
}
