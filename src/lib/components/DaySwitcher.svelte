<script lang="ts">
import { Plane } from "@lucide/svelte";

interface DayInfo {
    day: number;
    date: string;
}

interface Props {
    days: DayInfo[];
    /** Selected day number; 0 selects the trip-overview panel. */
    currentDay: number;
    /** Day number whose date is today (shows the 今天 marker); null outside the trip. */
    todayDay?: number | null;
}

let { days, currentDay = $bindable(), todayDay = null }: Props = $props();

let scroller = $state<HTMLDivElement>();

// Keep the selected chip in view: swiping the day strip changes `currentDay`
// from outside this component, and the chip row doesn't follow on its own.
// block "nearest" keeps the (always-visible, sticky-header) row from ever
// scrolling the window vertically.
$effect(() => {
    if (currentDay === 0) {
        // The overview chip is pinned, but rewind the row so DAY 01 is next to it.
        scroller?.scrollTo({ left: 0, behavior: "smooth" });
        return;
    }
    const idx = days.findIndex(d => d.day === currentDay);
    if (idx < 0) return;
    scroller?.querySelectorAll("button[data-day]")[idx]
        ?.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" });
});
</script>

<div bind:this={scroller} class="overflow-x-auto no-scrollbar pb-3">
    <div class="flex">
        <!-- Pinned overview chip: sticky with an opaque backing (pr-2 masks the
             gap) so it stays reachable while long trips scroll beneath it. -->
        <div class="sticky left-0 z-10 shrink-0 bg-[#0d0e15] pr-2">
            <button
                class="
                    h-full w-[56px] flex flex-col items-center justify-center p-2 rounded-xl border transition duration-300 cursor-pointer
                    {currentDay === 0
                    ? 'bg-gradient-to-br from-neon-blue/15 to-neon-pink/10 border-neon-blue shadow-[0_0_15px_rgba(0,240,255,0.25)]'
                    : 'bg-white/3 border-card-border hover:bg-white/5'}
                "
                onclick={() => (currentDay = 0)}
            >
                <Plane size={15} class={currentDay === 0 ? "text-neon-blue" : "text-text-muted"} aria-hidden="true" />
                <span class="text-[11px] font-bold mt-1 {currentDay === 0 ? 'text-text-primary' : 'text-text-secondary'}">總覽</span>
            </button>
        </div>
        <div class="flex gap-2">
            {#each days as { day, date } (day)}
                <button
                    data-day
                    class="
                        relative flex-none w-[76px] flex flex-col items-center justify-center p-2 rounded-xl border transition duration-300 cursor-pointer
                        {currentDay === day
                        ? 'bg-gradient-to-br from-neon-blue/15 to-neon-pink/10 border-neon-blue shadow-[0_0_15px_rgba(0,240,255,0.25)]'
                        : 'bg-white/3 border-card-border hover:bg-white/5'}
                    "
                    aria-current={todayDay === day ? "date" : undefined}
                    onclick={() => (currentDay = day)}
                >
                    {#if todayDay === day}
                        <span class="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full bg-neon-pink shadow-[0_0_6px_rgba(255,42,116,0.8)]" aria-hidden="true"></span>
                        <span class="sr-only">今天</span>
                    {/if}
                    <span class="text-[11px] font-medium {currentDay === day ? 'text-neon-blue' : 'text-text-muted'}">DAY {String(day).padStart(2, "0")}</span>
                    <span class="text-[15px] font-bold mt-0.5 {currentDay === day ? 'text-text-primary' : 'text-text-secondary'}">
                        {date.split("(")[0]}
                    </span>
                </button>
            {/each}
        </div>
    </div>
</div>
