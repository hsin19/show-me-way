<script lang="ts">
import Plane from "@lucide/svelte/icons/plane";

interface DayInfo {
    day: number;
    date: string;
}

interface Props {
    days: DayInfo[];
    /** Selected day number (read-only for highlighting); 0 is the trip-overview panel. */
    currentDay: number;
    /** Tap a chip to navigate; the parent (ItineraryStrip) moves the strip and updates currentDay. */
    onSelect: (day: number) => void;
    /** Day number whose date is today (shows the 今天 marker); null outside the trip. */
    todayDay?: number | null;
}

let { days, currentDay, onSelect, todayDay = null }: Props = $props();

let scroller = $state<HTMLDivElement>();

// Keep the selected chip in view. `currentDay` only changes once the day strip
// has settled (never mid-swipe), so this fires after the gesture is over and
// can smooth-scroll without competing with it. Scoped scrollTo, NOT
// scrollIntoView: scrollIntoView adjusts every scrollable ancestor, which WebKit
// lets cancel the strip's snap.
$effect(() => {
    if (!scroller) return;
    const behavior = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
    if (currentDay === 0) {
        // The overview chip is pinned, but rewind the row so DAY 01 is next to it.
        scroller.scrollTo({ left: 0, behavior });
        return;
    }
    const idx = days.findIndex(d => d.day === currentDay);
    if (idx < 0) return;
    const chip = scroller.querySelectorAll<HTMLElement>("button[data-day]")[idx];
    if (!chip) return;
    const chipRect = chip.getBoundingClientRect();
    const rowRect = scroller.getBoundingClientRect();
    const left = scroller.scrollLeft + (chipRect.left - rowRect.left) - (rowRect.width - chipRect.width) / 2;
    scroller.scrollTo({ left: Math.max(0, left), behavior });
});
</script>

<div bind:this={scroller} class="overflow-x-auto no-scrollbar pb-3">
    <div class="flex">
        <!-- Pinned overview chip: sticky with an opaque backing (pr-2 masks the
             gap) so it stays reachable while long trips scroll beneath it. -->
        <div class="sticky left-0 z-10 shrink-0 bg-bg-main pr-2">
            <button
                class="
                    h-full w-[56px] flex flex-col items-center justify-center p-2 rounded-xl border transition duration-200 cursor-pointer
                    {currentDay === 0
                    ? 'bg-accent/15 border-transparent'
                    : 'bg-tint-1 border-card-border hover:bg-tint-2'}
                "
                onclick={() => onSelect(0)}
            >
                <Plane size={15} class={currentDay === 0 ? "text-accent" : "text-text-muted"} aria-hidden="true" />
                <span class="text-[11px] font-bold mt-1 {currentDay === 0 ? 'text-accent' : 'text-text-secondary'}">總覽</span>
            </button>
        </div>
        <div class="flex gap-2">
            {#each days as { day, date } (day)}
                <button
                    data-day
                    class="
                        relative flex-none w-[76px] flex flex-col items-center justify-center p-2 rounded-xl border transition duration-200 cursor-pointer
                        {currentDay === day
                        ? 'bg-accent/15 border-transparent'
                        : 'bg-tint-1 border-card-border hover:bg-tint-2'}
                    "
                    aria-current={todayDay === day ? "date" : undefined}
                    onclick={() => onSelect(day)}
                >
                    {#if todayDay === day}
                        <span class="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full bg-must" aria-hidden="true"></span>
                        <span class="sr-only">今天</span>
                    {/if}
                    <span class="text-[11px] font-medium {currentDay === day ? 'text-accent' : 'text-text-muted'}">DAY {String(day).padStart(2, "0")}</span>
                    <span class="text-[15px] font-bold mt-0.5 {currentDay === day ? 'text-text-primary' : 'text-text-secondary'}">
                        {date.split("(")[0]}
                    </span>
                </button>
            {/each}
        </div>
    </div>
</div>
