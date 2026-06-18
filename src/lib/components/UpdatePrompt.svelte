<script lang="ts">
import RefreshCw from "@lucide/svelte/icons/refresh-cw";
import X from "@lucide/svelte/icons/x";

interface Props {
    show: boolean;
    onUpdate: () => void;
    onDismiss: () => void;
}

let { show, onUpdate, onDismiss }: Props = $props();
</script>

<!-- PWA update prompt -->
{#if show}
    <!-- z-[200]: above the nav (z-[100]) but below full-screen overlays
         (z-[1000]) so it never intercepts taps meant for an open modal.
         148px+safe keeps it clear of the toast at 96px+safe. -->
    <div class="fixed bottom-[calc(148px+var(--safe-bottom))] left-1/2 -translate-x-1/2 z-[200] bg-[#121422] border border-neon-blue/40 rounded-full py-1.5 pl-4 pr-1.5 flex items-center gap-2 shadow-[0_4px_15px_rgba(0,240,255,0.2)] whitespace-nowrap animate-fade-in">
        <span role="alert" class="text-xs font-bold text-text-primary">已有新版本，可立即更新</span>
        <button
            onclick={onUpdate}
            class="bg-neon-blue text-black text-xs font-bold rounded-full min-h-[44px] px-4 flex items-center gap-1.5 cursor-pointer"
        >
            <RefreshCw size={14} aria-hidden="true" />
            立即更新
        </button>
        <button
            onclick={onDismiss}
            aria-label="稍後更新"
            class="min-w-[44px] min-h-[44px] flex items-center justify-center text-text-secondary hover:text-text-primary cursor-pointer"
        >
            <X size={18} aria-hidden="true" />
        </button>
    </div>
{/if}
