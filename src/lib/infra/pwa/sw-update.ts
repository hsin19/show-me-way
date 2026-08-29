// New-version detection: registerType "prompt" via vite-plugin-pwa, throttled
// polling for a waiting worker, and the toast that offers to reload for it.
//
// A traveler keeps the app open for days, and without polling an update is only
// noticed on a fresh navigation. Phones throttle or freeze background intervals,
// hence the exported checkForSwUpdate() for the visibilitychange path too.
// Offline — the flagship scenario — update() rejects; swallow it and retry on
// the next check.

import { registerSW } from "virtual:pwa-register";
import { showToast } from "../../stores/toast.svelte";

const SW_UPDATE_CHECK_MS = 60 * 60 * 1000;

let swRegistration: ServiceWorkerRegistration | undefined;
// Shared with the visibilitychange path, or resuming the app would re-check
// something the interval just checked.
let lastSwUpdateCheck = 0;
let initialized = false;

export function checkForSwUpdate(): void {
    if (!swRegistration || swRegistration.installing || !navigator.onLine) return;
    if (Date.now() - lastSwUpdateCheck < SW_UPDATE_CHECK_MS) return;
    lastSwUpdateCheck = Date.now();
    swRegistration.update().catch(() => {});
}

export function initServiceWorkerUpdates(): void {
    if (initialized) return;
    initialized = true;

    // registerType "prompt": the new service worker waits until the user accepts,
    // so a page in use is never reloaded under them.
    const updateSW = registerSW({
        onNeedRefresh() {
            showToast({
                message: "已有新版本",
                actionLabel: "立即更新",
                onAction: () => void updateSW(true),
                kind: "update",
                persist: true,
                // Fires once per newly waiting worker, so two deploys in one long
                // session would otherwise stack two immortal notices.
                dedupeKey: "sw-update",
            });
        },
        onOfflineReady() {
            showToast("已可離線使用");
        },
        onRegisteredSW(_swUrl, registration) {
            if (!registration) return;
            swRegistration = registration;
            // register() itself just checked for updates; start the throttle now.
            lastSwUpdateCheck = Date.now();
            window.setInterval(checkForSwUpdate, SW_UPDATE_CHECK_MS);
        },
    });
}
