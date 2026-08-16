// Keeps the screen awake while the phone is being held up to a driver or a
// counter clerk. Refcounted, because two overlays could overlap. The browser
// drops the lock whenever the page is hidden, hence the visibilitychange
// re-request; where the API is missing it all no-ops — notably iOS standalone
// PWAs before 18.4 (WebKit bug 254545), which simply keep auto-locking.

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

/** Returns the release for this holder; calling it twice is safe. */
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
