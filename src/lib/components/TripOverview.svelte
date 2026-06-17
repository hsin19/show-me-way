<script lang="ts">
import CalendarRange from "@lucide/svelte/icons/calendar-range";
import ChevronDown from "@lucide/svelte/icons/chevron-down";
import ChevronRight from "@lucide/svelte/icons/chevron-right";
import Layers from "@lucide/svelte/icons/layers";
import Plus from "@lucide/svelte/icons/plus";
import Settings from "@lucide/svelte/icons/settings";
import Share2 from "@lucide/svelte/icons/share-2";
import Trash2 from "@lucide/svelte/icons/trash-2";
import type {
    DayItinerary,
    ProfileInfo,
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
    /** Other saved trips (the active one is `trip` itself); empty when none parked. */
    profiles: ProfileInfo[];
    /** This day's forecast; null hides the badge (same contract as Timeline). */
    weatherFor: (day: DayItinerary) => DailyWeather | null;
    onSelectDay: (day: number) => void;
    onSwitchProfile: (id: string) => void;
    onCreateProfile: () => void;
    onDeleteProfile: (id: string, name: string) => void;
    onShare: () => void;
    onOpenSettings: () => void;
}

let {
    trip,
    days,
    countdownText,
    profiles,
    weatherFor,
    onSelectDay,
    onSwitchProfile,
    onCreateProfile,
    onDeleteProfile,
    onShare,
    onOpenSettings,
}: Props = $props();

// Collapsed by default — the switcher is a secondary action below the day list.
let showProfiles = $state(false);
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

<!-- Trip profile switcher: swap to another saved trip or start a new one.
     Lives here (not in Settings) so it's a top-level navigation action; the
     active trip is `trip`, `profiles` holds the other parked ones. -->
<div class="mt-6">
    <button
        onclick={() => (showProfiles = !showProfiles)}
        aria-expanded={showProfiles}
        class="w-full glass-panel rounded-xl p-3.5 flex items-center gap-2.5 text-left hover:bg-white/5 transition cursor-pointer"
    >
        <Layers size={16} class="shrink-0 text-neon-blue" aria-hidden="true" />
        <span class="flex-1 min-w-0">
            <span class="block text-[10px] font-bold text-text-muted">目前行程</span>
            <span class="block text-sm font-bold text-text-primary truncate">{trip.name}</span>
        </span>
        <ChevronDown size={16} class="shrink-0 text-text-muted transition-transform {showProfiles ? 'rotate-180' : ''}" aria-hidden="true" />
    </button>
    {#if showProfiles}
        <div class="mt-2 space-y-1.5">
            {#each profiles as profile (profile.id)}
                <div class="flex items-center gap-1">
                    <button
                        onclick={() => onSwitchProfile(profile.id)}
                        class="flex-1 min-w-0 min-h-[44px] flex items-center justify-between gap-2 px-3.5 rounded-xl bg-white/3 border border-card-border text-text-secondary hover:text-neon-blue hover:bg-white/5 transition cursor-pointer"
                    >
                        <span class="truncate text-sm font-semibold">{profile.name}</span>
                        <span class="shrink-0 text-[11px] font-bold">切換</span>
                    </button>
                    <button
                        onclick={() => onDeleteProfile(profile.id, profile.name)}
                        aria-label="刪除行程 {profile.name}"
                        class="shrink-0 min-w-[44px] min-h-[44px] flex items-center justify-center text-text-muted hover:text-neon-pink transition cursor-pointer"
                    >
                        <Trash2 size={16} aria-hidden="true" />
                    </button>
                </div>
            {/each}
            <button
                onclick={onCreateProfile}
                class="w-full min-h-[44px] flex items-center justify-center gap-1.5 px-3.5 rounded-xl bg-white/3 border border-dashed border-card-border text-text-secondary hover:text-neon-blue hover:bg-white/5 transition cursor-pointer text-xs font-bold"
            >
                <Plus size={14} aria-hidden="true" /> 新增行程
            </button>
        </div>
    {/if}
</div>

<!-- Share + YAML settings entry — these replaced the old header gear button
     and the share button that used to live inside the settings modal. -->
<div class="grid grid-cols-2 gap-2 mt-3">
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
