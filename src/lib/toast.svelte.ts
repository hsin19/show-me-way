// App-global toast + clipboard service. A single toast pill lives at the app
// root (Toast.svelte); any component shows one by calling `showToast` /
// `copyToClipboard` directly, so there is no `onToast` / `onCopy` prop threading.
// Module-level runes hold the shared state — Svelte 5's idiomatic cross-module
// store. Reactive state is exposed through the `toast` getter object (you can't
// export a reassignable `let` and have consumers see updates).

// A plain message, or a message plus a single action (the undo variant, which
// stays up longer so the button can actually be reached).
export type ToastInput = string | { message: string; actionLabel?: string; onAction?: () => void; };

let message = $state("");
let action = $state<{ label: string; onAction: () => void; } | null>(null);
let visible = $state(false);
let timer: number | undefined;

/** Read-only reactive view for the Toast component. */
export const toast = {
    get message() {
        return message;
    },
    get actionLabel() {
        return action?.label ?? null;
    },
    get visible() {
        return visible;
    },
};

/** Show a toast: a plain message, or an undo variant with a longer window. */
export function showToast(input: ToastInput): void {
    const opts = typeof input === "string" ? { message: input } : input;
    message = opts.message;
    action = opts.actionLabel && opts.onAction ? { label: opts.actionLabel, onAction: opts.onAction } : null;
    visible = true;
    // Back-to-back toasts must restart the clock, or the first timer would hide
    // the second early and cut an undo window short.
    clearTimeout(timer);
    timer = window.setTimeout(() => (visible = false), action ? 4500 : 2500);
}

/** Invoke the undo action (if any) and dismiss immediately. */
export function runToastAction(): void {
    const onAction = action?.onAction;
    clearTimeout(timer);
    visible = false;
    onAction?.();
}

/**
 * Copy text to the clipboard, toasting on success/failure. Falls back to a
 * hidden textarea + execCommand where the async Clipboard API is unavailable
 * (older WebKit / insecure context).
 */
export function copyToClipboard(text: string, successMsg = "已複製"): void {
    navigator.clipboard.writeText(text).then(() => {
        showToast(successMsg);
    }).catch(() => {
        const textarea = document.createElement("textarea");
        textarea.value = text;
        textarea.style.position = "fixed";
        document.body.appendChild(textarea);
        textarea.select();
        try {
            document.execCommand("copy");
            showToast(successMsg);
        } catch {
            showToast("複製失敗，請手動複製");
        }
        document.body.removeChild(textarea);
    });
}
