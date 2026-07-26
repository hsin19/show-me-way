// App-global toast + clipboard service. Any component shows one by calling
// `showToast` / `copyToClipboard` directly, so there is no `onToast` / `onCopy`
// prop threading. Module-level runes hold the shared state — Svelte 5's idiomatic
// cross-module store. Reactive state is exposed through the `toast` getter object
// (you can't export a reassignable `let` and have consumers see updates).
//
// Several toasts can be on screen at once: each owns its own expiry and they
// stack rather than replace, so a second notice never cuts an undo window short
// on the clock. (A burst past MAX_VISIBLE still evicts the oldest — see the cap
// in `showToast` — so an undo can be crowded out by three later notices.)

/** Picks the leading glyph. `update` is the PWA new-version notice. */
export type ToastKind = "success" | "update" | "download";

// A plain message, or a message plus a single action (the undo variant, which
// stays up longer so the button can actually be reached).
export type ToastInput = string | {
    message: string;
    actionLabel?: string;
    onAction?: () => void;
    kind?: ToastKind;
    /**
     * Stay until dismissed instead of expiring, and get a ✕. The PWA update
     * notice uses this: it is the one message that must not vanish unseen.
     */
    persist?: boolean;
    /** Override default expiry duration in ms. */
    durationMs?: number;
    /** Show explicit ✕ close button even if persist is false. */
    showDismiss?: boolean;
    /**
     * Fired when the toast leaves the screen *without* its action being taken:
     * the ✕, the expiry timer, or being evicted by the cap. NOT fired when the
     * action button is pressed, and not when a same-`dedupeKey` toast replaces
     * this one — neither of those is the user passing on the offer. The install
     * prompt hangs its 7-day cool-off on exactly that distinction.
     */
    onDismiss?: () => void;
    /**
     * At most one toast per key: showing another with the same key replaces it.
     * The update notice needs this — `onNeedRefresh` fires once per newly waiting
     * service worker, and a persistent toast neither expires nor counts toward
     * the cap, so a second deploy in one session would otherwise leave a
     * duplicate on screen for good.
     */
    dedupeKey?: string;
};

export interface ToastItem {
    /** Stable key for the rendered stack, and the handle for running its action. */
    id: number;
    message: string;
    kind: ToastKind;
    /** The undo variant's action; null for a plain notice. */
    action: { label: string; onAction: () => void; } | null;
    /** No expiry — the renderer gives it a dismiss button instead. */
    persist: boolean;
    showDismiss: boolean;
}

/**
 * Each toast carries its own bookkeeping, rather than parallel id→timer /
 * id→key maps: with one structure there is nothing to fall out of sync. The
 * renderer has no use for either field — `toast.items` narrows them away at the
 * type level, but hands back the live array, so treat it and its entries as
 * read-only.
 */
interface StoredToast extends ToastItem {
    /** Pending expiry; `null` = persistent. */
    timer: number | null;
    dedupeKey: string | null;
    onDismiss?: () => void;
}

const PLAIN_MS = 2500;
const ACTION_MS = 4500;
/** A burst of taps must not fill the screen — the oldest drops out early. */
const MAX_VISIBLE = 3;

let items = $state<StoredToast[]>([]);
let seq = 0;

export const toast = {
    /**
     * Oldest first. The renderer stacks them bottom-anchored, so the newest sits
     * lowest and older ones are pushed up — order is part of the contract.
     */
    get items(): ToastItem[] {
        return items;
    },
};

/**
 * Take one toast off screen and cancel its pending expiry, without telling the
 * owner it was dismissed. The paths that are *not* the user declining — running
 * the action, and being replaced by a same-key toast — go through here.
 */
function removeToast(id: number): void {
    const found = items.find(item => item.id === id);
    if (!found) return;
    if (found.timer !== null) clearTimeout(found.timer);
    items = items.filter(item => item.id !== id);
}

/** Remove one toast and fire its `onDismiss`. Safe on an unknown id. */
export function dismissToast(id: number): void {
    const found = items.find(item => item.id === id);
    if (!found) return;
    removeToast(id);
    found.onDismiss?.();
}

/** Show a toast: a plain message, or an undo variant with a longer window. */
export function showToast(input: ToastInput): void {
    const opts = typeof input === "string" ? { message: input } : input;
    const action = opts.actionLabel && opts.onAction ? { label: opts.actionLabel, onAction: opts.onAction } : null;
    const persist = opts.persist ?? false;
    const showDismiss = opts.showDismiss ?? false;
    const dedupeKey = opts.dedupeKey ?? null;
    const duration = opts.durationMs ?? (action ? ACTION_MS : PLAIN_MS);
    // Replace rather than skip: the newest wording wins, and the caller does not
    // have to track whether its previous toast is still up (it may have been ✕'d).
    // `removeToast`, not `dismissToast` — the notice is being restated, not
    // declined, and firing `onDismiss` here would let a self-replacing toast
    // report a dismissal the user never made.
    if (dedupeKey !== null) {
        const previous = items.find(item => item.dedupeKey === dedupeKey);
        if (previous) removeToast(previous.id);
    }
    const id = ++seq;
    const timer = persist ? null : window.setTimeout(() => dismissToast(id), duration);
    items = [
        ...items,
        {
            id,
            message: opts.message,
            kind: opts.kind ?? "success",
            action,
            persist,
            showDismiss,
            dedupeKey,
            timer,
            onDismiss: opts.onDismiss,
        },
    ];
    // Only expiring toasts count toward the cap — a persistent notice must not be
    // evicted by a burst of confirmations it was never competing with. One added
    // toast can only ever put the stack one over, so one eviction is enough.
    const expiring = items.filter(item => !item.persist);
    if (expiring.length > MAX_VISIBLE) dismissToast(expiring[0].id);
}

/**
 * Invoke one toast's action (if any) and take just that toast off screen.
 * Deliberately not a dismissal: the user engaged, so `onDismiss` must not fire.
 */
export function runToastAction(id: number): void {
    const onAction = items.find(item => item.id === id)?.action?.onAction;
    removeToast(id);
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
