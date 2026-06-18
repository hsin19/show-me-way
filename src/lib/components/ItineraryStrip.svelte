<script lang="ts">
import { fly } from "svelte/transition";
import type {
    DayItinerary,
    ProfileInfo,
    TripData,
} from "../api";
import type { EnlargedCard } from "../enlarge";
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
import Timeline from "./Timeline.svelte";
import TripOverview from "./TripOverview.svelte";

interface Props {
    trip: TripData["trip"];
    days: DayItinerary[];
    /** Single source of truth for the visible day; bound so App's today-sync can drive it. 0 = overview. */
    currentDay: number;
    /** App's ticking clock (passed to Timeline; also drives "today" derivations and the current-event scroll). */
    clockNow: Date;
    profiles: ProfileInfo[];
    showWeatherAttribution: boolean;
    staleWeatherHours: number | null;
    weatherForDay: (day: DayItinerary) => DailyWeather | null;
    onEnlarge: (card: EnlargedCard) => void;
    onSetEventStatus: (id: string, status: "done" | "skipped" | undefined) => void;
    onShareDay: (day: DayItinerary) => void;
    onCopy: (text: string, msg: string) => void;
    onSwitchProfile: (id: string) => void;
    onCreateProfile: () => void;
    onDeleteProfile: (id: string, name: string) => void;
    onShare: () => void;
    onOpenSettings: () => void;
}

let {
    trip,
    days,
    currentDay = $bindable(),
    clockNow,
    profiles,
    showWeatherAttribution,
    staleWeatherHours,
    weatherForDay,
    onEnlarge,
    onSetEventStatus,
    onShareDay,
    onCopy,
    onSwitchProfile,
    onCreateProfile,
    onDeleteProfile,
    onShare,
    onOpenSettings,
}: Props = $props();

// --- One day on screen at a time, swapped with a slide transition ---
// Only the current panel is rendered (overview = day 0, then each day). Day
// switching is just a `currentDay` change; the view is a pure function of it, so
// there is no horizontal scroll machinery to keep in sync. Native vertical
// scroll happens inside the panel; left/right paging is a swipe/wheel gesture
// that simply steps `currentDay`.
const EVENT_SCROLL_GAP = 8;
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
// Day-change slide transition (ms / px). Tweak here for feel.
const PAGE_MS = 1000;
const PAGE_SHIFT = 120;

// "Today" derivations (consumed by the DaySwitcher marker and the overview capsule).
let todayData = $derived(days.find(d => d.date === toLocalIsoDate(clockNow)) ?? null);
let todayDay = $derived(todayData?.day ?? null);
let nextEvent = $derived(todayData ? getNextEventInfo(todayData.timeline, todayData.date, clockNow) : null);
let countdownText = $derived.by(() => {
    if (nextEvent) return formatNextEventLabel(nextEvent);
    return getCountdownText(trip, clockNow);
});

// Ordered panel keys: overview (0) then each day in order. Used for prev/next stepping.
let panelKeys = $derived([0, ...days.map(d => d.day)]);
let currentDayData = $derived(days.find(d => d.day === currentDay) ?? null);

// Slide direction for the transition (+1 = new day enters from the right).
let dir = $state(1);

// Navigate to a specific day (DaySwitcher chip / overview list). Sets the slide
// direction from the index delta, then changes the day.
function goToDay(day: number) {
    if (day === currentDay) return;
    dir = panelKeys.indexOf(day) >= panelKeys.indexOf(currentDay) ? 1 : -1;
    currentDay = day;
}

// Step to the previous / next panel, clamped to the ends.
function step(delta: number) {
    const i = panelKeys.indexOf(currentDay);
    const next = Math.max(0, Math.min(panelKeys.length - 1, i + delta));
    if (next === i) return;
    dir = delta > 0 ? 1 : -1;
    currentDay = panelKeys[next];
}

// Horizontal swipe (mobile) → step a day. Read on touchend so vertical scrolling
// is never intercepted; only a clearly-horizontal flick past the threshold pages.
const SWIPE_MIN = 50;
let touchX = 0;
let touchY = 0;
function onTouchStart(e: TouchEvent) {
    touchX = e.touches[0].clientX;
    touchY = e.touches[0].clientY;
}
function onTouchEnd(e: TouchEvent) {
    const t = e.changedTouches[0];
    const dx = t.clientX - touchX;
    const dy = t.clientY - touchY;
    if (Math.abs(dx) > SWIPE_MIN && Math.abs(dx) > Math.abs(dy) * 1.5) {
        step(dx < 0 ? 1 : -1);
    }
}

// Desktop horizontal wheel / trackpad → step a day. One step per gesture (lock
// releases once the wheel goes idle), so a flick's burst can't skip several days.
let pager = $state<HTMLElement>();
$effect(() => {
    const el = pager;
    if (!el) return;
    let locked = false;
    let idleTimer: number;
    const onWheel = (e: WheelEvent) => {
        if (e.ctrlKey) return; // pinch-zoom
        let horiz: number;
        if (e.shiftKey) horiz = e.deltaX || e.deltaY;
        else if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) horiz = e.deltaX;
        else return; // vertical-dominant → native panel scroll
        if (!horiz) return;
        e.preventDefault();
        clearTimeout(idleTimer);
        idleTimer = window.setTimeout(() => (locked = false), 140);
        if (locked || Math.abs(horiz) < 4) return;
        locked = true;
        step(horiz > 0 ? 1 : -1);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
});

// Vertical position within the freshly-rendered day panel: today scrolls to its
// in-progress event (none started yet → top), any other day stays at the top.
let panelEl = $state<HTMLElement>();
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

// Reposition whenever the panel (re)mounts for a new day. `{#key currentDay}`
// recreates the section, so `panelEl` is reassigned each switch; rAF waits for
// the new content to lay out before measuring the current-event card.
$effect(() => {
    const day = currentDay;
    const panel = panelEl;
    if (!panel) return;
    requestAnimationFrame(() => positionPanel(day, panel));
});
</script>

<div class="flex flex-col h-full">
    <!-- Day switcher header: chips drive the same `currentDay` as the pager below. -->
    <header class="shrink-0 z-[100] bg-[#0d0e15]/85 backdrop-blur-xl border-b border-white/5 pt-[calc(12px+var(--safe-top))] px-5">
        <div class="max-w-3xl mx-auto w-full">
            <DaySwitcher days={days.map(d => ({ day: d.day, date: formatDayDate(d.date) }))} {currentDay} onSelect={goToDay} {todayDay} />
        </div>
    </header>

    <!-- Pager viewport: one panel at a time, slid in/out on day change. -->
    <!-- svelte-ignore a11y_no_static_element_interactions (touch handlers only
         observe a horizontal flick to page; they never block scrolling) -->
    <div bind:this={pager} class="relative flex-1 min-h-0 overflow-hidden">
        {#key currentDay}
            <section
                bind:this={panelEl}
                ontouchstart={onTouchStart}
                ontouchend={onTouchEnd}
                in:fly={{ x: dir * PAGE_SHIFT, duration: reduceMotion ? 0 : PAGE_MS }}
                class="absolute inset-0 overflow-y-auto overscroll-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            >
                <div class="max-w-3xl mx-auto w-full p-5">
                    {#if currentDay === 0}
                        <TripOverview
                            {trip}
                            {days}
                            {countdownText}
                            {profiles}
                            weatherFor={weatherForDay}
                            onSelectDay={goToDay}
                            {onSwitchProfile}
                            {onCreateProfile}
                            {onDeleteProfile}
                            {onShare}
                            {onOpenSettings}
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
                            onCopy={onCopy}
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
                </div>
            </section>
        {/key}
    </div>
</div>
