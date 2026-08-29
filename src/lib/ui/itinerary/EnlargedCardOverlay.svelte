<script lang="ts">
import X from "@lucide/svelte/icons/x";
import { fade } from "svelte/transition";
import { prefersReducedMotion } from "../../domain/utils";
import { acquireScreenWakeLock } from "../../infra/pwa/wakelock";
import { copyToClipboard } from "../../stores/toast.svelte";
import type { EnlargedCard } from "../shared/enlarge";

interface Props {
    /** Null closes the overlay. Mounted once in App, so two cards can never stack. */
    card: EnlargedCard | null;
    onClose: () => void;
}

let { card, onClose }: Props = $props();

const FADE_MS = 300;

let dialogEl = $state<HTMLDivElement>();

// The trigger gets its focus back on close; App owns the Escape key.
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

// The phone is being held up to someone; it must not lock mid-conversation.
$effect(() => {
    if (!card) return;
    return acquireScreenWakeLock();
});
</script>

{#if card}
    {@const data = card}
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
        transition:fade={{ duration: prefersReducedMotion() ? 0 : FADE_MS }}
        onoutrostart={e => e.currentTarget.classList.add("pointer-events-none")}
        onclick={onClose}
        class="fixed inset-0 bg-scrim z-[1000] flex items-center justify-center p-5"
    >
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <div
            bind:this={dialogEl}
            role="dialog"
            aria-modal="true"
            aria-label="放大顯示：{data.title}"
            tabindex="-1"
            onclick={(e => e.stopPropagation())}
            class="panel border border-line-raised rounded-2xl w-full max-w-[400px] p-6 overscroll-contain"
        >
            <div class="flex justify-between items-center mb-6">
                <h3 class="text-sm text-text-secondary">
                    {#if data.kind === "confirmation"}
                        出示給櫃台人員看（點碼可複製）
                    {:else}
                        {data.prompt ?? "出示給司機 / 店員看（點字可複製）"}
                    {/if}
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
                        onclick={() => copyToClipboard(data.code, "已複製確認碼")}
                        class="text-accent text-4xl font-black leading-normal tracking-widest block w-full break-all cursor-pointer transition active:scale-[0.98]"
                        title="點一下複製"
                    >
                        {data.code}
                    </button>
                    {#if data.name}
                        <p class="text-text-primary text-2xl font-black leading-normal break-words mt-3">{data.name}</p>
                    {/if}
                    {#if data.note}
                        <p class="text-xs text-text-secondary leading-relaxed mt-3">{data.note}</p>
                    {/if}
                {:else}
                    <button
                        type="button"
                        onclick={() => copyToClipboard(data.localName, "已複製名稱")}
                        class="text-text-primary text-2xl font-black leading-normal block w-full break-words cursor-pointer transition active:scale-[0.98]"
                        title="點一下複製"
                    >
                        {data.localName}
                    </button>
                    {#if data.address}
                        <button
                            type="button"
                            onclick={() => copyToClipboard(data.address ?? "", "已複製地址")}
                            class="text-accent text-3xl font-black leading-normal block w-full break-words mt-3 cursor-pointer transition active:scale-[0.98]"
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
