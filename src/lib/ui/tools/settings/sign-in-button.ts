import { gdriveSync } from "$lib/stores/gdrive.svelte";

/**
 * What a Google sign-in button shows, around the label it has when a tap can sign in.
 * Shared so every way into sign-in says the same thing about why it cannot right now.
 * A failed load stays tappable: the tap is its retry.
 */
export function signInButton(readyLabel: string): { label: string; disabled: boolean; busy: boolean; } {
    if (gdriveSync.isConnecting) return { label: "連線中…", disabled: true, busy: true };
    switch (gdriveSync.signInReadiness) {
        case "loading":
            return { label: "準備 Google 登入…", disabled: true, busy: true };
        case "offline":
            return { label: "離線中，無法登入", disabled: true, busy: false };
        case "failed":
            return { label: "無法連到 Google，點此重試", disabled: false, busy: false };
        default:
            return { label: readyLabel, disabled: false, busy: false };
    }
}
