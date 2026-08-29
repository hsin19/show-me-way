<script lang="ts">
import type { ExpenseItem } from "../../domain/ledger";
import {
    findScrollTargetEventIndex,
    formatNextEventLabel,
    getCountdownText,
    getNextEventInfo,
} from "../../domain/timeline";
import type {
    DayItinerary,
    TripData,
} from "../../domain/trip";
import { toLocalIsoDate } from "../../domain/utils";
import type { DailyWeather } from "../../infra/http/weather";
import type { ProfileInfo } from "../../infra/storage/profiles";
import type { EnlargedCard } from "../shared/enlarge";
import TabPager from "../shared/TabPager.svelte";
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
    expenses: ExpenseItem[];
    profiles?: ProfileInfo[];
    showWeatherAttribution: boolean;
    staleWeatherHours: number | null;
    weatherForDay: (day: DayItinerary) => DailyWeather | null;
    onEnlarge: (card: EnlargedCard) => void;
    onSetEventStatus: (id: string, status: "done" | "skipped" | undefined) => void;
    onShareDay: (day: DayItinerary) => void;
    /** Deep-links out of the overview's phase card into a 工具 sub-page. */
    onOpenPrepare: () => void;
    onOpenLedger: () => void;
    onShare: () => void;
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
    expenses,
    profiles = [],
    showWeatherAttribution,
    staleWeatherHours,
    weatherForDay,
    onEnlarge,
    onSetEventStatus,
    onShareDay,
    onOpenPrepare,
    onOpenLedger,
    onShare,
    onSwitchProfile,
    onCreateProfile,
    onDeleteProfile,
    onLoadCloudTrip,
    onDeleteCloudTrip,
}: Props = $props();

// Breathing room above the card an auto-scroll lands on.
const EVENT_SCROLL_GAP = 8;

let todayIso = $derived(toLocalIsoDate(clockNow));
let todayData = $derived(days.find(d => d.date === todayIso) ?? null);
let todayDay = $derived(todayData?.day ?? null);
let nextEvent = $derived(todayData ? getNextEventInfo(todayData.timeline, todayData.date, clockNow) : null);
let countdownText = $derived.by(() => {
    if (nextEvent) return formatNextEventLabel(nextEvent);
    return getCountdownText(trip, clockNow);
});

let panelKeys = $derived([0, ...days.map(d => d.day)]);
// The pager's chip snippet is handed a key, not a day, so the date has to be
// looked back up. Key 0 (the overview) has none.
let dayDates = $derived(new Map(days.map(d => [d.day, d.date])));
let currentDayData = $derived(days.find(d => d.day === currentDay) ?? null);

// Where a freshly-mounted day panel lands vertically: today opens at whatever is
// happening now, every other day at the top.
function positionPanel(day: number, panel: HTMLElement) {
    const dayData = days.find(d => d.day === day);
    if (!dayData) return; // the overview; a fresh panel is already at 0
    const eventIdx = findScrollTargetEventIndex(dayData.timeline, dayData.date);
    if (eventIdx === null) return;
    const targetId = dayData.timeline[eventIdx]._id;
    const card = targetId ? panel.querySelector<HTMLElement>(`[data-event-id="${targetId}"]`) : null;
    if (!card) return;
    const top = Math.max(0, card.getBoundingClientRect().top - panel.getBoundingClientRect().top + panel.scrollTop - EVENT_SCROLL_GAP);
    panel.scrollTo({ top, behavior: "auto" });
}
</script>

<!-- pinnedCount={1} keeps the overview chip — panelKeys[0] — reachable however far
     the day chips scroll. -->
<TabPager keys={panelKeys} bind:current={currentDay} pinnedCount={1} onPanelReady={positionPanel}>
    {#snippet chip(day, select, active)}
        <DayChip {day} date={dayDates.get(day) ?? ""} {active} isToday={todayDay === day} onSelect={select} />
    {/snippet}
    {#snippet panel(day, select)}
        {#if day === 0}
            <TripOverview
                {trip}
                {days}
                {countdownText}
                {todayIso}
                {prepDone}
                {prepTotal}
                {expenses}
                {profiles}
                weatherFor={weatherForDay}
                onSelectDay={select}
                {onEnlarge}
                {onOpenPrepare}
                {onOpenLedger}
                {onShare}
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
