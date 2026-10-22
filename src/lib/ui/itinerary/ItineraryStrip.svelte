<script lang="ts">
import { getLanguageConfig } from "$lib/domain/language";
import {
    findScrollTargetEventIndex,
    formatNextEventLabel,
    getCountdownText,
    getNextEventInfo,
} from "$lib/domain/timeline";
import type {
    DayItinerary,
    TripData,
} from "$lib/domain/trip";
import { tripDayOf } from "$lib/domain/utils";
import type { DailyWeather } from "$lib/infra/http/weather";
import type { ProfileInfo } from "$lib/infra/storage/profiles";
import { tripEdit } from "$lib/stores/trip-edit.svelte";
import type { EnlargedCard } from "$lib/ui/shared/enlarge";
import TabPager from "$lib/ui/shared/TabPager.svelte";
import Check from "@lucide/svelte/icons/check";
import X from "@lucide/svelte/icons/x";
import DayChip from "./DayChip.svelte";
import Timeline from "./Timeline.svelte";
import TripOverview from "./TripOverview.svelte";

interface Props {
    trip: TripData["trip"];
    days: DayItinerary[];
    /** 0 = the overview panel. Bindable, so App's today-sync can drive it. */
    currentDay: number;
    /** App's ticking clock; every reactive "today" derivation here hangs off it. */
    clockNow: Date;
    prepDone: number;
    prepTotal: number;
    profiles?: ProfileInfo[];
    showWeatherAttribution: boolean;
    staleWeatherHours: number | null;
    weatherForDay: (day: DayItinerary) => DailyWeather | null;
    onEnlarge: (card: EnlargedCard) => void;
    onSetEventStatus: (id: string, status: "done" | "skipped" | undefined) => void;
    onShareDay: (day: DayItinerary) => void;
    /** Deep-links out of the overview's phase card into a 工具 sub-page. */
    onOpenPrepare: () => void;
    onShare: () => void;
    sharing?: boolean;
    onSwitchProfile?: (id: string) => void;
    onCreateProfile?: () => void;
    onDeleteProfile?: (id: string) => void;
    onLoadCloudTrip?: (fileId: string, fileName: string) => void | Promise<void>;
    onDeleteCloudTrip?: (fileId: string) => void | Promise<void>;
}

let {
    trip,
    days,
    currentDay = $bindable(),
    clockNow,
    prepDone,
    prepTotal,
    profiles = [],
    showWeatherAttribution,
    staleWeatherHours,
    weatherForDay,
    onEnlarge,
    onSetEventStatus,
    onShareDay,
    onOpenPrepare,
    onShare,
    sharing = false,
    onSwitchProfile,
    onCreateProfile,
    onDeleteProfile,
    onLoadCloudTrip,
    onDeleteCloudTrip,
}: Props = $props();

// Breathing room above the card an auto-scroll lands on.
const EVENT_SCROLL_GAP = 8;

let todayIso = $derived(tripDayOf(clockNow));
// Edit mode shows the draft's days, so a day the trip gained can be opened and filled in before ✓.
let shownDays = $derived(tripEdit.active && tripEdit.draft ? tripEdit.draft.days : days);

let todayData = $derived(shownDays.find(d => d.date === todayIso) ?? null);
let todayDay = $derived(todayData?.day ?? null);
let nextEvent = $derived(todayData ? getNextEventInfo(todayData.timeline, todayData.date, clockNow) : null);
let nextEventLabel = $derived(nextEvent ? formatNextEventLabel(nextEvent) : null);
let countdownText = $derived(getCountdownText(trip, clockNow));

let driverPrompt = $derived(getLanguageConfig(trip.lang).driverPrompt);

let panelKeys = $derived([0, ...shownDays.map(d => d.day)]);
// The pager's chip snippet is handed a key, not a day, so the date has to be
// looked back up. Key 0 (the overview) has none.
let dayDates = $derived(new Map(shownDays.map(d => [d.day, d.date])));
let currentDayData = $derived(shownDays.find(d => d.day === currentDay) ?? null);

// Where a freshly-mounted day panel lands vertically: today opens at whatever is
// happening now, every other day at the top.
function positionPanel(day: number, panel: HTMLElement) {
    const dayData = shownDays.find(d => d.day === day);
    if (!dayData) return; // the overview; a fresh panel is already at 0
    const eventIdx = findScrollTargetEventIndex(dayData.timeline, dayData.date);
    if (eventIdx === null) return;
    const targetId = dayData.timeline[eventIdx]?._id;
    const card = targetId ? panel.querySelector<HTMLElement>(`[data-event-id="${targetId}"]`) : null;
    if (!card) return;
    const top = Math.max(0, card.getBoundingClientRect().top - panel.getBoundingClientRect().top + panel.scrollTop - EVENT_SCROLL_GAP);
    panel.scrollTo({ top, behavior: "auto" });
}
</script>

<!-- Edit mode's way out, in the pager's fixed row rather than on a card that scrolls, so ✓ is
     in reach however far down the edit went. Only while editing: the row is for reading. -->
{#snippet editControls()}
    <button
        type="button"
        onclick={() => tripEdit.discard()}
        aria-label="取消"
        title="取消"
        class="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-full text-text-secondary hover:bg-tint-2 transition active:scale-95 cursor-pointer"
    >
        <X size={20} strokeWidth={2.5} aria-hidden="true" />
    </button>
    <button
        type="button"
        onclick={() => tripEdit.finish()}
        aria-label="完成"
        title="完成"
        class="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-full bg-accent text-accent-contrast transition active:scale-95 cursor-pointer"
    >
        <Check size={20} strokeWidth={3} aria-hidden="true" />
    </button>
{/snippet}

<!-- pinnedCount={1} keeps the overview chip — panelKeys[0] — reachable however far
     the day chips scroll. -->
<TabPager
    keys={panelKeys}
    bind:current={currentDay}
    pinnedCount={1}
    onPanelReady={positionPanel}
    trailing={tripEdit.active ? editControls : undefined}
>
    {#snippet chip(day, select, active)}
        <DayChip {day} date={dayDates.get(day) ?? ""} {active} isToday={todayDay === day} onSelect={select} />
    {/snippet}
    {#snippet panel(day, select)}
        {#if day === 0}
            <TripOverview
                {trip}
                days={shownDays}
                {countdownText}
                {nextEventLabel}
                {todayIso}
                {prepDone}
                {prepTotal}
                {profiles}
                weatherFor={weatherForDay}
                onSelectDay={select}
                {onEnlarge}
                {onOpenPrepare}
                {onShare}
                {sharing}
                {onSwitchProfile}
                {onCreateProfile}
                {onDeleteProfile}
                {onLoadCloudTrip}
                {onDeleteCloudTrip}
            />
        {:else if currentDayData}
            <Timeline
                dayData={currentDayData}
                hotels={trip.hotels}
                {driverPrompt}
                mapProvider={trip.mapProvider}
                weather={weatherForDay(currentDayData)}
                now={clockNow}
                {onEnlarge}
                {onSetEventStatus}
                onShareDay={() => onShareDay(currentDayData)}
            />
            {#if showWeatherAttribution}
                <p class="text-center text-[10px] text-text-muted mt-4">
                    天氣資料：<a
                        href="https://open-meteo.com/"
                        target="_blank"
                        rel="noopener noreferrer"
                        class="underline hover:text-text-secondary transition"
                    >Open-Meteo.com</a> (CC BY 4.0){#if staleWeatherHours !== null}（{staleWeatherHours} 小時前）{/if}
                </p>
            {/if}
        {/if}
    {/snippet}
</TabPager>
