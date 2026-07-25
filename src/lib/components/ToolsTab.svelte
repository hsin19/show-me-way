<script lang="ts">
import type { Snippet } from "svelte";
import TabPager from "./TabPager.svelte";

// `settings` is the trip-level 行程管理 page; `prefs` is the app-level App 設定 page.
type ToolTabId = "prep" | "ledger" | "phrases" | "settings" | "prefs";

interface Props {
    /** Selected sub-tab; App owns it so overview cards / error CTA can deep-link. */
    tab: ToolTabId;
    /** prep/ledger need a loaded trip; false (YAML load error) leaves 行程管理 and App 設定. */
    hasTrip: boolean;
    /** Hide the 常用語 chip when the trip language has no built-in phrase deck. */
    hasPhrases: boolean;
    prep: Snippet;
    ledger: Snippet;
    phrases: Snippet;
    settings: Snippet;
    prefs: Snippet;
}

let { tab = $bindable(), hasTrip, hasPhrases, prep, ledger, phrases, settings, prefs }: Props = $props();

const LABELS: Record<ToolTabId, string> = {
    prep: "準備",
    ledger: "記帳",
    phrases: "常用語",
    settings: "行程管理",
    prefs: "App 設定",
};

// 行程管理 and App 設定 stay reachable without a trip: one is how you fix broken
// YAML, the other has nothing to do with trip data.
let chips = $derived((["prep", "ledger", "phrases", "settings", "prefs"] as const).filter(id => {
    if (id === "settings" || id === "prefs") return true;
    if (!hasTrip) return false;
    return id !== "phrases" || hasPhrases;
}));

// If the selected sub-tab becomes unavailable (e.g. the YAML failed to load),
// fall back instead of rendering nothing.
let activeTabId = $derived(chips.includes(tab) ? tab : (hasTrip ? "prep" : "settings"));
</script>

<!-- 工具 tab: sub-pages behind the shared chip header. Paging (swipe / wheel / slide
     transition) is the shared TabPager — same interaction model as the
     itinerary strip. -->
<TabPager keys={chips} bind:current={tab}>
    <!-- `active` from TabPager is `key === current`, but `tab` can point at a page
         that is no longer available; activeTabId is the corrected value, so the
         highlight follows it rather than the passed flag. -->
    {#snippet chip(id, select)}
        <button
            aria-pressed={activeTabId === id}
            onclick={() => select(id)}
            class="
                min-h-[44px] px-4 rounded-xl border text-xs font-bold transition duration-200 cursor-pointer
                {activeTabId === id
                ? 'bg-accent/15 border-transparent text-accent'
                : 'bg-tint-1 border-card-border text-text-secondary hover:bg-tint-2'}
            "
        >
            {LABELS[id]}
        </button>
    {/snippet}
    {#snippet panel()}
        {#if activeTabId === "prep"}
            {@render prep()}
        {:else if activeTabId === "ledger"}
            {@render ledger()}
        {:else if activeTabId === "phrases"}
            {@render phrases()}
        {:else if activeTabId === "prefs"}
            {@render prefs()}
        {:else}
            {@render settings()}
        {/if}
    {/snippet}
</TabPager>
