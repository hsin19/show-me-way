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

let scroller = $state<HTMLDivElement>();

// Drive the .edge-fade mask: fade only the side that still has content past it.
let atStart = $state(true);
let atEnd = $state(true);

function updateFades() {
    if (!scroller) return;
    // 1px slack: fractional scroll offsets never land exactly on the bounds.
    const max = scroller.scrollWidth - scroller.clientWidth;
    atStart = scroller.scrollLeft <= 1;
    atEnd = scroller.scrollLeft >= max - 1;
}

// Recheck when the chip set changes (a YAML load error drops 準備/記帳/常用語).
$effect(() => {
    void chips;
    updateFades();
});

// Keep the selected chip in view. The row already overflows a 390px phone with
// five chips and will only get longer, so chip padding is NOT the lever —
// without this, deep-linking (the overview's phase card jumps straight to
// 記帳/準備) could select a chip that is scrolled off screen. Same approach as
// DaySwitcher: scoped scrollTo rather than scrollIntoView, which adjusts every
// scrollable ancestor and lets WebKit cancel the pager's snap.
$effect(() => {
    if (!scroller) return;
    const chip = scroller.querySelector<HTMLElement>(`[data-tool-chip="${activeTabId}"]`);
    if (!chip) return;
    const chipRect = chip.getBoundingClientRect();
    const rowRect = scroller.getBoundingClientRect();
    const left = scroller.scrollLeft + (chipRect.left - rowRect.left) - (rowRect.width - chipRect.width) / 2;
    scroller.scrollTo({
        left: Math.max(0, left),
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
    });
});
</script>

<!-- 工具 tab: sub-pages behind sticky chips. Paging (swipe / wheel / slide
     transition) is the shared TabPager — same interaction model as the
     itinerary strip. -->
<TabPager keys={chips} bind:current={tab}>
    {#snippet header(select)}
        <div
            bind:this={scroller}
            onscroll={updateFades}
            class="overflow-x-auto no-scrollbar pb-3 edge-fade"
            style:--fade-start={atStart ? "0px" : "24px"}
            style:--fade-end={atEnd ? "0px" : "24px"}
        >
            <div class="flex gap-2">
                {#each chips as id (id)}
                    <button
                        data-tool-chip={id}
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
        {:else if activeTabId === "prefs"}
            {@render prefs()}
        {:else}
            {@render settings()}
        {/if}
    {/snippet}
</TabPager>
