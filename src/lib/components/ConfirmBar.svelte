<script lang="ts">
import TriangleAlert from "@lucide/svelte/icons/triangle-alert";

interface Props {
    message: string;
    confirmLabel?: string;
    cancelLabel?: string;
    onconfirm: () => void;
    oncancel: () => void;
}

let {
    message,
    confirmLabel = "確定",
    cancelLabel = "取消",
    onconfirm,
    oncancel,
}: Props = $props();

let cancelEl = $state<HTMLButtonElement>();

// Focus lands on 取消 (the safe default) when the bar appears: half the callers
// swap their trigger button out for this bar, which otherwise drops keyboard
// focus to <body>, and screen readers get no announcement at all without it.
// On unmount, focus returns to wherever it was IF that element survived — for
// swap-style callers the trigger is already gone by mount, so there is nothing
// to return to and focus stays where the caller's re-render puts it.
$effect(() => {
    const returnTo = document.activeElement instanceof HTMLElement && document.activeElement !== document.body
        ? document.activeElement
        : null;
    cancelEl?.focus();
    return () => {
        if (returnTo?.isConnected) returnTo.focus();
    };
});
</script>

<div role="alertdialog" aria-label={message} class="rounded-xl border border-danger/40 bg-danger/10 p-2.5">
    <p class="flex items-start gap-1.5 text-[11px] font-medium text-danger leading-normal">
        <TriangleAlert size={14} class="shrink-0 mt-px" aria-hidden="true" />
        {message}
    </p>
    <div class="mt-2 flex gap-2">
        <button
            type="button"
            onclick={onconfirm}
            class="
                flex-1 min-h-[44px] rounded-lg bg-danger text-accent-contrast text-xs font-bold
                cursor-pointer hover:opacity-90 transition duration-200
            "
        >
            {confirmLabel}
        </button>
        <button
            type="button"
            bind:this={cancelEl}
            onclick={oncancel}
            class="
                flex-1 min-h-[44px] rounded-lg bg-tint-2 text-text-secondary text-xs font-bold
                cursor-pointer hover:bg-tint-3 transition duration-200
            "
        >
            {cancelLabel}
        </button>
    </div>
</div>
