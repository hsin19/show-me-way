<script lang="ts">
import type {
    DayItinerary,
    TripData,
} from "../api";
import type { EnlargedCard } from "../enlarge";
import type { ExpenseItem } from "../ledger";
import {
    findCurrentEventIndex,
    formatDayDate,
    formatNextEventLabel,
    getCountdownText,
    getNextEventInfo,
    toLocalIsoDate,
} from "../utils";
import type { DailyWeather } from "../weather";
import DaySwitcher from "./DaySwitcher.svelte";
import TabPager from "./TabPager.svelte";
import Timeline from "./Timeline.svelte";
import TripOverview from "./TripOverview.svelte";

interface Props {
    trip: TripData["trip"];
    days: DayItinerary[];
    /** Single source of truth for the visible day; bound so App's today-sync can drive it. 0 = overview. */
    currentDay: number;
    /** App's ticking clock (passed to Timeline; also drives "today" derivations and the current-event scroll). */
    clockNow: Date;
    /** Checked / total across todo + packing (overview pre-trip progress card). */
    prepDone: number;
    prepTotal: number;
    /** Expense records (overview post-trip spend summary card). */
    expenses: ExpenseItem[];
    showWeatherAttribution: boolean;
    staleWeatherHours: number | null;
    weatherForDay: (day: DayItinerary) => DailyWeather | null;
    onEnlarge: (card: EnlargedCard) => void;
    onSetEventStatus: (id: string, status: "done" | "skipped" | undefined) => void;
    onShareDay: (day: DayItinerary) => void;
    /** Overview phase-card deep-links into the 工具 tab sub-pages. */
    onOpenPrepare: () => void;
    onOpenLedger: () => void;
    /** Share the whole trip from the overview hero card. */
    onShare: () => void;
}

let {
    trip,
    days,
    currentDay = $bindable(),
    clockNow,
    prepDone,
    prepTotal,
    expenses,
    showWeatherAttribution,
    staleWeatherHours,
    weatherForDay,
    onEnlarge,
    onSetEventStatus,
    onShareDay,
    onOpenPrepare,
    onOpenLedger,
    onShare,
}: Props = $props();

// Gap kept above the current event card when a day panel auto-scrolls to it.
const EVENT_SCROLL_GAP = 8;

// "Today" derivations (consumed by the DaySwitcher marker and the overview capsule).
let todayIso = $derived(toLocalIsoDate(clockNow));
let todayData = $derived(days.find(d => d.date === todayIso) ?? null);
let todayDay = $derived(todayData?.day ?? null);
let nextEvent = $derived(todayData ? getNextEventInfo(todayData.timeline, todayData.date, clockNow) : null);
let countdownText = $derived.by(() => {
    if (nextEvent) return formatNextEventLabel(nextEvent);
    return getCountdownText(trip, clockNow);
});

// Ordered panel keys for the pager: overview (0) then each day in order.
let panelKeys = $derived([0, ...days.map(d => d.day)]);
let currentDayData = $derived(days.find(d => d.day === currentDay) ?? null);

// Vertical position within a freshly-rendered day panel (TabPager's
// onPanelReady): today scrolls to its in-progress event (none started yet →
// top), any other day stays at the top.
function positionPanel(day: number, panel: HTMLElement) {
    const dayData = days.find(d => d.day === day);
    if (!dayData) return; // overview rests at top (fresh panel is already at 0)
    const now = new Date();
    let eventIdx = dayData.date === toLocalIsoDate(now)
        ? findCurrentEventIndex(dayData.timeline, now)
        : null;
    // A checked-off / skipped anchor would land on a struck-through card —
    // advance to the first unresolved event, same semantics as the capsule.
    while (eventIdx !== null && dayData.timeline[eventIdx].status) {
        eventIdx = eventIdx + 1 < dayData.timeline.length ? eventIdx + 1 : null;
    }
    if (eventIdx === null) return;
    const card = panel.querySelectorAll<HTMLElement>("[data-timeline-event]")[eventIdx];
    if (!card) return;
    const top = Math.max(0, card.getBoundingClientRect().top - panel.getBoundingClientRect().top + panel.scrollTop - EVENT_SCROLL_GAP);
    panel.scrollTo({ top, behavior: "auto" });
}
</script>

<!-- Day paging (swipe / wheel / slide transition) is the shared TabPager; this
     component supplies the day data, the switcher chips, and the
     scroll-to-current-event behaviour. -->
<TabPager keys={panelKeys} bind:current={currentDay} onPanelReady={positionPanel}>
    {#snippet header(select)}
        <DaySwitcher days={days.map(d => ({ day: d.day, date: formatDayDate(d.date) }))} {currentDay} onSelect={select} {todayDay} />
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
                weatherFor={weatherForDay}
                onSelectDay={select}
                {onEnlarge}
                {onOpenPrepare}
                {onOpenLedger}
                {onShare}
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
