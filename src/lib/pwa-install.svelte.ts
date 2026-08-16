// The "you can install this" offer: the `beforeinstallprompt` handoff, the
// per-browser manual route, and the toast that raises the idea at all.
//
// That toast fires 3.5s in, before the user has typed a trip, on purpose: an
// installed iOS PWA gets its own storage partition, so an itinerary entered in
// the Safari tab does not follow them home, and prompting later would hand them
// two copies to reconcile.
//
// `.svelte.ts` because whether an install is on offer must be a rune —
// `beforeinstallprompt` can land while App 設定 is already open, and the button
// has to appear (and later disappear) without a remount.

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
// `deferredPrompt !== null` mirrored as a rune. The event itself stays out of
// `$state`: only its availability is reactive, and a live DOM object has no
// business inside a deep proxy.
let installAvailable = $state(false);
let initialized = false;
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
 * Still inside the 7-day cool-off. A stamp in the future — the clock moved
 * backwards — counts as expired rather than muting the offer until real time
 * catches up, the same rule `isFresh` applies in `storage-cache.ts`.
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

/** Whether a real install dialog can still be opened, i.e. whether to offer the button at all. */
export function canPromptPwaInstall(): boolean {
    return installAvailable;
}

/**
 * Show the browser's install dialog; true if the user accepted. Single-use — the
 * offer is spent either way, because a `BeforeInstallPromptEvent` may only be
 * prompted once and keeping a declined one would leave a button that silently
 * does nothing.
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
 * What the toast's 安裝 button does. Chromium installs from here; everywhere else
 * the only route is the per-browser instructions on App 設定.
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

    // The event never fires on iOS Safari, Firefox, or plain HTTP, so the timer is
    // the only path there. `toastShown` keeps the two from colliding on Chromium,
    // where the listener above has usually asked already — re-showing would
    // restart the window and re-animate a pill the user is looking at.
    window.setTimeout(() => {
        if (toastShown || isInstallDismissedRecently() || isStandaloneMode()) return;
        showPwaInstallToast();
    }, FALLBACK_DELAY_MS);
}
