<script lang="ts">
import CheckCircle from "@lucide/svelte/icons/check-circle";

interface Props {
    message: string;
    /** Optional action button label (undo variant); null hides the button. */
    actionLabel: string | null;
    visible: boolean;
    /** Invoked when the action button is tapped (the parent owns the timer/state). */
    onAction: () => void;
}

let { message, actionLabel, visible, onAction }: Props = $props();
</script>

<!-- Global toast pill: sits between the nav (64px+safe) and the update banner
     (148px+safe). pointer-events-none on the pill so a passing notice never
     intercepts taps aimed at the banner below the z-[2000] layer; only the undo
     action button re-enables them. -->
<div
    role="status"
    aria-live="polite"
    class="
        pointer-events-none fixed bottom-[calc(96px+var(--safe-bottom))] left-1/2 -translate-x-1/2 bg-neon-blue text-black font-bold text-xs py-2.5 px-5 rounded-full z-[2000] shadow-[0_4px_15px_rgba(0,240,255,0.3)] transition-[opacity,transform] duration-300 flex items-center gap-1.5
        {visible ? 'opacity-100 translate-y-0 visible' : 'opacity-0 translate-y-5 invisible'}
    "
>
    <CheckCircle size={14} class="stroke-[3]" aria-hidden="true" />
    {message}
    {#if actionLabel}
        <button
            onclick={onAction}
            class="pointer-events-auto min-w-[44px] min-h-[44px] -my-3.5 -mr-4 pl-2 pr-3.5 flex items-center justify-center font-black underline underline-offset-2 cursor-pointer"
        >
            {actionLabel}
        </button>
    {/if}
</div>
