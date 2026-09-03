<script lang="ts">
import TabPager from "$lib/ui/shared/TabPager.svelte";
import type { Snippet } from "svelte";

// `settings` is the trip-level 行程管理 page; `prefs` is the app-level App 設定 page.
type ToolTabId = "prep" | "settings" | "prefs";

interface Props {
    /** Bindable — App owns it, so the overview cards and the load-error CTA can deep-link. */
    tab: ToolTabId;
    /** False on a YAML load error, which leaves only 行程管理 and App 設定 available. */
    hasTrip: boolean;
    prep: Snippet;
    settings: Snippet;
    prefs: Snippet;
}

let { tab = $bindable(), hasTrip, prep, settings, prefs }: Props = $props();

const LABELS: Record<ToolTabId, string> = {
    prep: "準備",
    settings: "行程管理",
    prefs: "App 設定",
};

// 行程管理 and App 設定 stay reachable without a trip: one is how you fix broken
// YAML, the other has nothing to do with trip data.
let chips = $derived((["prep", "settings", "prefs"] as const).filter(id => id !== "prep" || hasTrip));

// `tab` can still name a page that just became unavailable — fall back rather
// than render nothing.
let activeTabId = $derived(chips.includes(tab) ? tab : (hasTrip ? "prep" : "settings"));
</script>

<TabPager keys={chips} bind:current={tab}>
    <!-- The highlight follows `activeTabId`, not TabPager's `active`: that is
         `key === current`, and `current` may be the stale page corrected above. -->
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
        {:else if activeTabId === "prefs"}
            {@render prefs()}
        {:else}
            {@render settings()}
        {/if}
    {/snippet}
</TabPager>
