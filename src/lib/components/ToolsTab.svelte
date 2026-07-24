<script lang="ts">
import type { Snippet } from "svelte";
import TabPager from "./TabPager.svelte";

type ToolTabId = "prep" | "ledger" | "phrases" | "settings";

interface Props {
    /** Selected sub-tab; App owns it so overview cards / error CTA can deep-link. */
    tab: ToolTabId;
    /** prep/ledger need a loaded trip; false (YAML load error) leaves only 行程管理. */
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
    settings: "行程管理",
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

<!-- 工具 tab: sub-pages behind sticky chips. Paging (swipe / wheel / slide
     transition) is the shared TabPager — same interaction model as the
     itinerary strip. -->
<TabPager keys={chips} bind:current={tab}>
    {#snippet header(select)}
        <div class="overflow-x-auto no-scrollbar pb-3">
            <div class="flex gap-2">
                {#each chips as id (id)}
                    <button
                        aria-pressed={activeTabId === id}
                        onclick={() => select(id)}
                        class="
                            flex-none min-h-[44px] px-4 rounded-xl border text-xs font-bold transition duration-200 cursor-pointer
                            {activeTabId === id
                            ? 'bg-accent/15 border-transparent text-accent'
                            : 'bg-tint-1 border-card-border text-text-secondary hover:bg-tint-2'}
                        "
                    >
                        {LABELS[id]}
                    </button>
                {/each}
            </div>
        </div>
    {/snippet}
    {#snippet panel()}
        {#if activeTabId === "prep"}
            {@render prep()}
        {:else if activeTabId === "ledger"}
            {@render ledger()}
        {:else if activeTabId === "phrases"}
            {@render phrases()}
        {:else}
            {@render settings()}
        {/if}
    {/snippet}
</TabPager>
