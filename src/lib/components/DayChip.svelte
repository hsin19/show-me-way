<script lang="ts">
import Plane from "@lucide/svelte/icons/plane";

// One chip in the itinerary strip's header row. The row itself — layout,
// horizontal scrolling, the edge fade and pinning day 0 — belongs to TabPager;
// this component only decides what a chip looks like.

interface Props {
    /** Day number. 0 is the trip-overview chip (TabPager pins it). */
    day: number;
    /** Formatted date, e.g. "01/01(四)". The weekday is dropped for the chip. */
    date?: string;
    /** This chip's panel is the visible one. */
    active: boolean;
    /** This day's date is today — shows the 今天 marker. */
    isToday?: boolean;
    onSelect: (day: number) => void;
}

let { day, date = "", active, isToday = false, onSelect }: Props = $props();

// Shared between both variants; only the width and the 今天 dot's `relative`
// differ, so keeping one copy is what stops the two chips drifting apart.
const SHAPE = "h-full flex flex-col items-center justify-center p-2 rounded-xl border transition duration-200 cursor-pointer";
let tone = $derived(active ? "bg-accent/15 border-transparent" : "bg-tint-1 border-card-border hover:bg-tint-2");
</script>

{#if day === 0}
    <button class="w-[56px] {SHAPE} {tone}" onclick={() => onSelect(0)}>
        <Plane size={15} class={active ? "text-accent" : "text-text-muted"} aria-hidden="true" />
        <span class="text-[11px] font-bold mt-1 {active ? 'text-accent' : 'text-text-secondary'}">總覽</span>
    </button>
{:else}
    <button
        data-day
        class="relative w-[76px] {SHAPE} {tone}"
        aria-current={isToday ? "date" : undefined}
        onclick={() => onSelect(day)}
    >
        {#if isToday}
            <span class="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full bg-must" aria-hidden="true"></span>
            <span class="sr-only">今天</span>
        {/if}
        <span class="text-[11px] font-medium {active ? 'text-accent' : 'text-text-muted'}">
            DAY {String(day).padStart(2, "0")}
        </span>
        <!-- Date only; the "(四)" weekday from formatDayDate is too wide for a chip
             and already appears in the panel heading. -->
        <span class="text-[15px] font-bold mt-0.5 {active ? 'text-text-primary' : 'text-text-secondary'}">
            {date.split("(")[0]}
        </span>
    </button>
{/if}
