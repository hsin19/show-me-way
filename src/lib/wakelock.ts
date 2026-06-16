// Screen Wake Lock for driver-facing overlays: the display must not auto-lock
// while the phone is being shown to someone. Each acquire returns its own
// release; the lock is held while any holder remains. Browsers drop the lock
// whenever the page is hidden, so a visibilitychange listener re-requests it
// on foreground resume. Unsupported browsers silently no-op — notably iOS
// standalone PWAs only expose the API from iOS 18.4 (WebKit bug 254545),
// older versions keep the normal auto-lock behavior.

let holders = 0;
let sentinel: WakeLockSentinel | null = null;
let requestInFlight = false;

function isSupported(): boolean {
    return typeof navigator !== "undefined" && "wakeLock" in navigator;
}

async function request(): Promise<void> {
    if (!isSupported() || requestInFlight || holders === 0) return;
    if (sentinel && !sentinel.released) return;
    requestInFlight = true;
    try {
        const lock = await navigator.wakeLock.request("screen");
        if (holders === 0) {
            // Last holder left while the request was in flight.
            await lock.release();
            return;
        }
        sentinel = lock;
    } catch {
        // Denied (page hidden, power-save mode…) — degrade to auto-lock.
        sentinel = null;
    } finally {
        requestInFlight = false;
    }
}

function handleVisibilityChange(): void {
    if (document.visibilityState === "visible") void request();
}

export function acquireScreenWakeLock(): () => void {
    holders += 1;
    if (holders === 1 && isSupported()) {
        document.addEventListener("visibilitychange", handleVisibilityChange);
    }
    void request();
    let released = false;
    return () => {
        if (released) return;
        released = true;
        holders -= 1;
        if (holders > 0) return;
        if (isSupported()) {
            document.removeEventListener("visibilitychange", handleVisibilityChange);
        }
        void sentinel?.release().catch(() => {});
        sentinel = null;
    };
}
