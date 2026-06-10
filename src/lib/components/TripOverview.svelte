<script lang="ts">
import {
    CalendarRange,
    ChevronRight,
    Settings,
    Share2,
} from "@lucide/svelte";
import type {
    DayItinerary,
    TripData,
} from "../api";
import {
    formatDateRange,
    formatDayDate,
} from "../utils";
import type { DailyWeather } from "../weather";
import WeatherBadge from "./WeatherBadge.svelte";

interface Props {
    trip: TripData["trip"];
    days: DayItinerary[];
    /** Pre-derived status label: countdown before the trip, next/in-progress event during it. */
    countdownText: string;
    /** This day's forecast; null hides the badge (same contract as Timeline). */
    weatherFor: (day: DayItinerary) => DailyWeather | null;
    onSelectDay: (day: number) => void;
    onShare: () => void;
    onOpenSettings: () => void;
}

let { trip, days, countdownText, weatherFor, onSelectDay, onShare, onOpenSettings }: Props = $props();
</script>

<!-- Trip hero card -->
<div class="glass-panel rounded-2xl p-6 mb-6 relative overflow-hidden before:content-[''] before:absolute before:top-0 before:left-0 before:w-1 before:h-full before:bg-gradient-to-b before:from-neon-blue before:to-neon-pink">
    <h2 class="text-2xl font-black bg-gradient-to-r from-white to-[#cbd5e1] bg-clip-text text-transparent tracking-tight">
        {trip.name}
    </h2>
    <p class="text-xs text-text-secondary font-medium tracking-wide mt-1.5 flex items-center gap-1.5">
        <CalendarRange size={14} class="shrink-0" aria-hidden="true" />
        {formatDateRange(trip.start, trip.end)}・共 {days.length} 天
    </p>
    <div class="mt-4 inline-flex max-w-full items-center bg-neon-pink/12 border border-neon-pink/30 text-neon-pink text-xs font-bold px-3.5 py-2 rounded-full shadow-[0_0_15px_rgba(255,42,116,0.25)] text-shadow-[0_0_4px_rgba(255,42,116,0.3)]">
        <span class="truncate">{countdownText}</span>
    </div>
</div>

<!-- Per-day jump list -->
<div class="space-y-2">
    {#each days as day (day.day)}
        {@const weather = weatherFor(day)}
        <button
            onclick={() => onSelectDay(day.day)}
            class="w-full glass-panel rounded-xl p-3.5 flex items-center gap-3 text-left hover:bg-white/5 transition cursor-pointer"
        >
            <div class="shrink-0 w-[56px] flex flex-col items-center">
                <span class="text-[10px] font-bold text-neon-blue">DAY {String(day.day).padStart(2, "0")}</span>
                <span class="text-sm font-bold text-text-primary mt-0.5">{formatDayDate(day.date).split("(")[0]}</span>
            </div>
            <div class="flex-1 min-w-0">
                <p class="text-sm font-semibold text-text-primary truncate">{day.region}</p>
                {#if weather}
                    <div class="mt-1">
                        <WeatherBadge {weather} />
                    </div>
                {/if}
            </div>
            <ChevronRight size={16} class="text-text-muted shrink-0" aria-hidden="true" />
        </button>
    {/each}
</div>

<!-- Share + YAML settings entry — these replaced the old header gear button
     and the share button that used to live inside the settings modal. -->
<div class="grid grid-cols-2 gap-2 mt-6">
    <button
        onclick={onShare}
        class="bg-white/3 border border-neon-blue/30 text-neon-blue font-bold py-3.5 px-4 rounded-xl text-xs flex items-center justify-center gap-1.5 hover:bg-neon-blue/10 transition active:scale-[0.98] cursor-pointer"
    >
        <Share2 size={14} aria-hidden="true" /> 分享行程
    </button>
    <button
        onclick={onOpenSettings}
        class="bg-white/3 border border-card-border text-text-secondary font-bold py-3.5 px-4 rounded-xl text-xs flex items-center justify-center gap-1.5 hover:bg-white/5 hover:text-text-primary transition cursor-pointer"
    >
        <Settings size={14} aria-hidden="true" /> 自訂 YAML 行程
    </button>
</div>
