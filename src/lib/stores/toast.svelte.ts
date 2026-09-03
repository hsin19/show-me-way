// App-global toast + clipboard service. Components call `showToast` /
// `copyToClipboard` directly, which is what spares every layer between them an
// `onToast` prop. The state is exposed through the `toast` getter object because
// an exported reassignable `let` would not update for consumers.
//
// Toasts stack rather than replace, each with its own expiry, so a later notice
// cannot cut an undo window short on the clock — though a burst past MAX_VISIBLE
// still evicts the oldest, so an undo can be crowded out by three of them.

/** Picks the leading glyph. `update` is the PWA new-version notice. */
export type ToastKind = "success" | "update" | "download";

export type ToastInput = string | {
    message: string;
    actionLabel?: string;
    onAction?: () => void;
    kind?: ToastKind;
    /** Stay until dismissed, and get a ✕. For a message that must not vanish unseen. */
    persist?: boolean;
    durationMs?: number;
    /** A ✕ on a toast that still expires on its own. */
    showDismiss?: boolean;
    /**
     * Fired when the toast leaves *without* its action being taken — the ✕, the
     * expiry, the cap. Pressing the action does not count, and neither does being
     * replaced by a same-`dedupeKey` toast; the install prompt hangs its 7-day
     * cool-off on exactly that distinction.
     */
    onDismiss?: () => void;
    /** At most one toast per key: a second one with the same key replaces the first. */
    dedupeKey?: string;
};

export interface ToastItem {
    /** Stable render key, and the handle `runToastAction` / `dismissToast` take. */
    id: number;
    message: string;
    kind: ToastKind;
    action: { label: string; onAction: () => void; } | null;
    /** No expiry — the renderer gives it a dismiss button instead. */
    persist: boolean;
    showDismiss: boolean;
}

/**
 * One structure rather than parallel id→timer / id→key maps, so there is nothing
 * to fall out of sync. `toast.items` narrows the extra fields away at the type
 * level but hands back the live array — treat it and its entries as read-only.
 */
interface StoredToast extends ToastItem {
    /** Pending expiry; `null` = persistent. */
    timer: number | null;
    dedupeKey: string | null;
    onDismiss?: () => void;
}

const PLAIN_MS = 2500;
const ACTION_MS = 4500;
/** A burst of taps must not fill the screen. */
const MAX_VISIBLE = 3;

let items = $state<StoredToast[]>([]);
let seq = 0;

export const toast = {
    /** Oldest first — the renderer stacks bottom-anchored, so order is part of the contract. */
    get items(): ToastItem[] {
        return items;
    },
};

/**
 * Removal without an `onDismiss`. The paths that are not the user declining —
 * running the action, being replaced by a same-key toast — go through here.
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
    // Replace rather than skip, so the newest wording wins and the caller need not
    // track whether its previous toast is still up. `removeToast`, not
    // `dismissToast`: restating a notice is not the user declining it, and firing
    // `onDismiss` would report a dismissal that never happened.
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
    // Persistent notices are exempt from the cap: a burst of confirmations must
    // not evict something the user still has to act on. One insert can only put
    // the stack one over, hence a single eviction.
    const expiring = items.filter(item => !item.persist);
    if (expiring.length > MAX_VISIBLE) dismissToast(expiring[0]!.id);
}

/** Run a toast's action and close it. Not a dismissal — the user engaged, so `onDismiss` does not fire. */
export function runToastAction(id: number): void {
    const onAction = items.find(item => item.id === id)?.action?.onAction;
    removeToast(id);
    onAction?.();
}

/** Copy text and report the outcome as a toast. Never throws. */
export function copyToClipboard(text: string, successMsg = "已複製"): void {
    navigator.clipboard.writeText(text).then(() => {
        showToast(successMsg);
    }).catch(() => {
        // The Clipboard API is missing on older WebKit and in insecure contexts.
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

/**
 * What every 分享 action goes through, so they all behave the same way:
 * the native share sheet if there is one, else the clipboard fallback.
 * Declining the share sheet (AbortError) is a decision, not a failure — stay
 * silent rather than falling through to the copy.
 *
 * `sharedMsg` is for something that already happened before the sheet opened (an
 * upload, say) and so must be said whether the user shares or cancels. It is shown
 * once the sheet closes, because a toast raised while the sheet is up sits behind
 * it and expires unseen. The clipboard path never shows it: `copyMsg` is the whole
 * message there, so fold the same note into that string.
 */
export async function shareOrCopyToClipboard(
    data: { url?: string; text?: string; title?: string; },
    copyText: string,
    copyMsg: string,
    sharedMsg?: string,
): Promise<void> {
    if (typeof navigator.share === "function") {
        try {
            await navigator.share(data);
            if (sharedMsg) showToast(sharedMsg);
            return;
        } catch (err) {
            if ((err as DOMException)?.name === "AbortError") {
                if (sharedMsg) showToast(sharedMsg);
                return;
            }
        }
    }
    copyToClipboard(copyText, copyMsg);
}
