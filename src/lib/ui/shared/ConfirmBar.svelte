<script lang="ts">
import Info from "@lucide/svelte/icons/info";
import TriangleAlert from "@lucide/svelte/icons/triangle-alert";

interface Props {
    message: string;
    confirmLabel?: string;
    cancelLabel?: string;
    variant?: "danger" | "warning" | "accent";
    onconfirm: () => void;
    oncancel: () => void;
}

let {
    message,
    confirmLabel = "確定",
    cancelLabel = "取消",
    variant = "danger",
    onconfirm,
    oncancel,
}: Props = $props();

// Literal class strings rather than interpolated token names, so Tailwind's scanner sees them.
const TONES = {
    danger: { box: "border-danger/40 bg-danger/10", text: "text-danger", button: "bg-danger" },
    warning: { box: "border-warning/40 bg-warning/10", text: "text-warning", button: "bg-warning" },
    accent: { box: "border-accent/40 bg-accent/10", text: "text-accent", button: "bg-accent" },
};
let tone = $derived(TONES[variant]);

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

<div
    role="alertdialog"
    aria-label={message}
    class="rounded-xl border p-2.5 {tone.box}"
>
    <p class="flex items-start gap-1.5 text-[11px] font-medium leading-normal {tone.text}">
        {#if variant === "accent"}
            <Info size={14} class="shrink-0 mt-px" aria-hidden="true" />
        {:else}
            <TriangleAlert size={14} class="shrink-0 mt-px" aria-hidden="true" />
        {/if}
        {message}
    </p>
    <div class="mt-2 flex gap-2">
        <button
            type="button"
            onclick={onconfirm}
            class="
                flex-1 min-h-[44px] rounded-lg text-accent-contrast text-xs font-bold
                cursor-pointer hover:opacity-90 transition duration-200
                {tone.button}
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
                border border-card-border hover:bg-tint-3 transition duration-200 cursor-pointer
            "
        >
            {cancelLabel}
        </button>
    </div>
</div>
