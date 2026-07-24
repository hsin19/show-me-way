<script lang="ts">
import type { Snippet } from "svelte";

type ToolTabId = "prep" | "ledger" | "phrases" | "settings";

interface Props {
    /** Selected sub-tab; App owns it so overview cards / error CTA can deep-link. */
    tab: ToolTabId;
    /** prep/ledger need a loaded trip; false (YAML load error) leaves only 自訂行程. */
    hasTrip: boolean;
    /** Hide the 常用語 chip when the trip language has no built-in phrase deck. */
    hasPhrases: boolean;
    prep: Snippet;
    ledger: Snippet;
    phrases: Snippet;
    settings: Snippet;
}

let { tab = $bindable(), hasTrip, hasPhrases, prep, ledger, phrases, settings }: Props = $props();

const LABELS: Record<ToolTabId, string> = {
    prep: "準備",
    ledger: "記帳",
    phrases: "常用語",
    settings: "自訂行程",
};

let chips = $derived((["prep", "ledger", "phrases", "settings"] as const).filter(id => {
    if (id === "settings") return true;
    if (!hasTrip) return false;
    return id !== "phrases" || hasPhrases;
}));

// If the selected sub-tab becomes unavailable (e.g. the YAML failed to load),
// fall back instead of rendering nothing.
let activeTabId = $derived(chips.includes(tab) ? tab : (hasTrip ? "prep" : "settings"));
</script>

<!-- Tools tab: the rarely-used features live behind a sub-tab row here, same
     header pattern as the itinerary strip (sticky chips, scrolling content). -->
<div class="flex flex-col h-full">
    <header class="shrink-0 z-[100] bg-bg-main/90 backdrop-blur-xl border-b border-white/5 pt-[calc(12px+var(--safe-top))] px-5">
        <div class="max-w-3xl mx-auto w-full overflow-x-auto no-scrollbar pb-3">
            <div class="flex gap-2">
                {#each chips as id (id)}
                    <button
                        aria-pressed={activeTabId === id}
                        onclick={() => (tab = id)}
                        class="
                            flex-none min-h-[44px] px-4 rounded-xl border text-xs font-bold transition duration-200 cursor-pointer
                            {activeTabId === id
                            ? 'bg-accent/15 border-transparent text-accent'
                            : 'bg-white/3 border-card-border text-text-secondary hover:bg-white/5'}
                        "
                    >
                        {LABELS[id]}
                    </button>
                {/each}
            </div>
        </div>
    </header>

    <div class="flex-1 min-h-0 overflow-y-auto overscroll-contain">
        {#key activeTabId}
            <div class="max-w-3xl mx-auto w-full p-5 animate-fade-in">
                {#if activeTabId === "prep"}
                    {@render prep()}
                {:else if activeTabId === "ledger"}
                    {@render ledger()}
                {:else if activeTabId === "phrases"}
                    {@render phrases()}
                {:else}
                    {@render settings()}
                {/if}
            </div>
        {/key}
    </div>
</div>
