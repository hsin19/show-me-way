<script lang="ts">
import X from "@lucide/svelte/icons/x";
import { fade } from "svelte/transition";
import type { EnlargedCard } from "../enlarge";
import { acquireScreenWakeLock } from "../wakelock";

interface Props {
    /** The card to show, or null when the overlay is closed. */
    card: EnlargedCard | null;
    onClose: () => void;
    onCopy: (text: string, msg: string) => void;
}

let { card, onClose, onCopy }: Props = $props();

let dialogEl = $state<HTMLDivElement>();

// Move focus onto the dialog when it opens and hand it back to the trigger on
// close (same contract as the app's other dialogs).
let returnFocus: HTMLElement | null = null;
$effect(() => {
    if (card) {
        returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        dialogEl?.focus();
    } else {
        returnFocus?.focus();
        returnFocus = null;
    }
});

// Keep the screen on while the card is shown to a driver. Unsupported browsers
// (iOS standalone < 18.4) silently no-op — see lib/wakelock.ts.
$effect(() => {
    if (!card) return;
    return acquireScreenWakeLock();
});
</script>

<!-- Fullscreen enlarged-card overlay: a place's local-language name (and hotel
     address) for a driver / local staff, or a reservation confirmation code for
     a check-in counter. -->
{#if card}
    {@const data = card}
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
        transition:fade={{ duration: 300 }}
        onoutrostart={e => e.currentTarget.classList.add("pointer-events-none")}
        onclick={onClose}
        class="fixed inset-0 bg-black/95 z-[1000] flex items-center justify-center p-5"
    >
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <div
            bind:this={dialogEl}
            role="dialog"
            aria-modal="true"
            aria-label="放大顯示：{data.title}"
            tabindex="-1"
            onclick={(e => e.stopPropagation())}
            class="bg-[#121422] border border-white/8 rounded-3xl w-full max-w-[400px] p-6 shadow-2xl overscroll-contain"
        >
            <div class="flex justify-between items-center mb-6">
                <h3 class="text-sm text-text-secondary">
                    {data.kind === "confirmation" ? "出示給櫃台人員看（點碼可複製）" : "出示給司機 / 店員看（點字可複製）"}
                </h3>
                <button
                    onclick={onClose}
                    aria-label="關閉"
                    class="min-w-[44px] min-h-[44px] -my-2.5 -mr-2.5 flex items-center justify-center text-text-secondary hover:text-text-primary cursor-pointer"
                >
                    <X size={24} aria-hidden="true" />
                </button>
            </div>

            <div class="text-center break-words px-2">
                <p class="text-sm text-text-secondary mb-3">{data.title}</p>
                {#if data.kind === "confirmation"}
                    <button
                        type="button"
                        onclick={() => onCopy(data.code, "已複製確認碼")}
                        class="text-neon-blue text-4xl font-black leading-normal tracking-widest block w-full break-all cursor-pointer transition active:scale-[0.98] drop-shadow-[0_0_8px_rgba(0,240,255,0.3)]"
                        title="點一下複製"
                    >
                        {data.code}
                    </button>
                    {#if data.name}
                        <p class="text-white text-2xl font-black leading-normal break-words mt-3">{data.name}</p>
                    {/if}
                    {#if data.note}
                        <p class="text-xs text-text-secondary leading-relaxed mt-3">{data.note}</p>
                    {/if}
                {:else}
                    <button
                        type="button"
                        onclick={() => onCopy(data.localName, "已複製名稱")}
                        class="text-white text-2xl font-black leading-normal block w-full break-words cursor-pointer transition active:scale-[0.98]"
                        title="點一下複製"
                    >
                        {data.localName}
                    </button>
                    {#if data.address}
                        <button
                            type="button"
                            onclick={() => onCopy(data.address ?? "", "已複製地址")}
                            class="text-neon-blue text-3xl font-black leading-normal block w-full break-words mt-3 cursor-pointer transition active:scale-[0.98] drop-shadow-[0_0_8px_rgba(0,240,255,0.3)]"
                            title="點一下複製"
                        >
                            {data.address}
                        </button>
                    {/if}
                {/if}
            </div>
        </div>
    </div>
{/if}
