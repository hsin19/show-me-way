<script lang="ts">
import type {
    DayItinerary,
    ProfileInfo,
    TripData,
} from "../api";
import type { EnlargedCard } from "../enlarge";
import {
    findCurrentEventIndex,
    toLocalIsoDate,
} from "../utils";
import type { DailyWeather } from "../weather";
import Timeline from "./Timeline.svelte";
import TripOverview from "./TripOverview.svelte";

interface Props {
    trip: TripData["trip"];
    days: DayItinerary[];
    /** Single source of truth for the visible day; bound so the parent's DaySwitcher stays in sync. */
    currentDay: number;
    /** Armed by the parent on (re)load; consumed here to position the strip once mounted. */
    pendingInitialScroll: boolean;
    /** App's ticking clock (passed to each day's Timeline and used for today's auto-scroll). */
    clockNow: Date;
    countdownText: string;
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
    pendingInitialScroll = $bindable(),
    clockNow,
    countdownText,
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

// --- Switch day via a horizontal scroll-snap strip (native swipe / trackpad) ---
// Each day is a full-width, full-height panel that scrolls VERTICALLY on its own
// (overflow-y-auto); the strip only scrolls horizontally. Because every panel is
// the same fixed height, nothing reflows while paging, so iOS WebKit's native
// snap stays smooth and each day keeps its own scroll position. `currentDay` is
// the single source of truth: a swipe reports the resting panel into it, and a
// programmatic change (DaySwitcher tap, overview select, initial load) brings
// the strip to it.
let dayStrip = $state<HTMLDivElement>();
// When the user last scrolled the strip horizontally; the realign effect uses it
// to stay out of the way while a swipe is still settling so it never fires a
// competing scroll. A timestamp survives the extra effect runs that two-way
// `bind:currentDay` can trigger.
let lastUserScrollAt = 0;
const REALIGN_SUPPRESS_MS = 400;
const EVENT_SCROLL_GAP = 8;

// Day number ↔ strip panel index. Panel 0 is the trip overview (day 0); the
// day panels follow in YAML order, shifted by one.
function dayToIndex(day: number): number | null {
    if (day === 0) return 0;
    const idx = days.findIndex(d => d.day === day);
    return idx < 0 ? null : idx + 1;
}

function indexToDay(idx: number): number | null {
    if (idx === 0) return 0;
    return days[idx - 1]?.day ?? null;
}

function dayOffsetLeft(day: number): number | null {
    const idx = dayToIndex(day);
    if (idx === null || !dayStrip) return null;
    return idx * dayStrip.clientWidth;
}

function scrollBehavior(): "auto" | "smooth" {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
}

// Vertical position within one day's panel: today scrolls to its in-progress
// event (none started yet → top), any other day scrolls to the top. Scrolls the
// panel itself (each panel is its own scroll container).
function applyDayScroll(day: number, behavior: "auto" | "smooth" = scrollBehavior()) {
    if (!dayStrip) return;
    const panelIdx = dayToIndex(day);
    const panel = panelIdx === null ? undefined : dayStrip.children[panelIdx] as HTMLElement | undefined;
    if (!panel) return;
    const dayData = days.find(d => d.day === day);
    if (!dayData) {
        panel.scrollTo({ top: 0, behavior });
        return;
    }
    const now = new Date();
    let eventIdx = dayData.date === toLocalIsoDate(now)
        ? findCurrentEventIndex(dayData.timeline, now)
        : null;
    // A checked-off / skipped anchor would land on a struck-through card —
    // advance to the first unresolved event, same semantics as the capsule.
    while (eventIdx !== null && dayData.timeline[eventIdx].status) {
        eventIdx = eventIdx + 1 < dayData.timeline.length ? eventIdx + 1 : null;
    }
    if (eventIdx === null) {
        panel.scrollTo({ top: 0, behavior });
        return;
    }
    const card = panel.querySelectorAll<HTMLElement>("[data-timeline-event]")[eventIdx];
    if (!card) {
        panel.scrollTo({ top: 0, behavior });
        return;
    }
    const top = Math.max(0, card.getBoundingClientRect().top - panel.getBoundingClientRect().top + panel.scrollTop - EVENT_SCROLL_GAP);
    panel.scrollTo({ top, behavior });
}

// A swipe only reports which panel it rests on (for the DaySwitcher highlight);
// the motion is all native CSS snap. No reflow happens on this change (panels are
// fixed height), so updating live is safe and smooth.
function handleStripScroll() {
    if (!dayStrip) return;
    lastUserScrollAt = performance.now();
    const idx = Math.round(dayStrip.scrollLeft / dayStrip.clientWidth);
    const day = indexToDay(idx);
    if (day !== null && day !== currentDay) {
        currentDay = day;
    }
}

// Desktop horizontal paging via wheel / trackpad. Each day panel is
// overflow-y:auto, which forces its overflow-x to compute to hidden — a scroll
// container that swallows horizontal scroll before it reaches this pager. Touch
// swipes are unaffected (mobile pages fine); this is a desktop wheel-only quirk.
// So redirect a horizontal-intent wheel (trackpad pan, tilt wheel, shift+wheel)
// to the strip ourselves. preventDefault → manual non-passive listener (Svelte's
// `onwheel` is passive). A dominant-vertical wheel stays native so the day panel
// scrolls.
$effect(() => {
    const strip = dayStrip;
    if (!strip) return;
    // One wheel gesture = one page. The lock latches on the first event and
    // releases only after the wheel goes idle, so a trackpad flick's burst of
    // momentum events can't skip several days at once.
    let wheelLocked = false;
    let wheelIdleTimer: number;
    const onWheel = (e: WheelEvent) => {
        if (e.ctrlKey) return; // pinch-zoom gesture
        let horiz: number;
        if (e.shiftKey) horiz = e.deltaX || e.deltaY; // shift+wheel → horizontal
        else if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) horiz = e.deltaX; // horizontal pan / tilt wheel
        else return; // vertical-dominant → native (the day panel scrolls)
        if (!horiz) return;
        e.preventDefault();
        // Keep the lock alive while events keep arriving; release once idle.
        clearTimeout(wheelIdleTimer);
        wheelIdleTimer = window.setTimeout(() => (wheelLocked = false), 140);
        if (wheelLocked || Math.abs(horiz) < 4) return;
        const width = strip.clientWidth;
        if (width <= 0) return;
        const curIdx = Math.round(strip.scrollLeft / width);
        const nextIdx = Math.max(0, Math.min(strip.children.length - 1, curIdx + (horiz > 0 ? 1 : -1)));
        if (nextIdx === curIdx) return;
        wheelLocked = true;
        // Instant, not smooth: Chrome cancels smooth scrolls on snap-mandatory
        // containers, leaving the strip stuck. Jumping straight to the snap point
        // is reliable (and snappy enough for a one-page wheel step).
        strip.scrollTo({ left: nextIdx * width, behavior: "auto" });
    };
    strip.addEventListener("wheel", onWheel, { passive: false });
    return () => strip.removeEventListener("wheel", onWheel);
});

// Bring the strip to `currentDay` and vertically position that day — for
// programmatic changes only (DaySwitcher tap, overview select). Skipped while
// the user is swiping so the native snap is never fought.
$effect(() => {
    const target = dayOffsetLeft(currentDay);
    if (target === null || !dayStrip) return;
    if (performance.now() - lastUserScrollAt < REALIGN_SUPPRESS_MS) return;
    if (Math.abs(dayStrip.scrollLeft - target) > 2) {
        dayStrip.scrollTo({ left: target, behavior: scrollBehavior() });
    }
    applyDayScroll(currentDay);
});

// Initial positioning on (re)load: jump to currentDay instantly, then position.
$effect(() => {
    if (!dayStrip || !pendingInitialScroll) return;
    pendingInitialScroll = false;
    const day = currentDay;
    const target = dayOffsetLeft(day);
    if (target !== null && Math.abs(dayStrip.scrollLeft - target) > 2) {
        dayStrip.scrollTo({ left: target, behavior: "auto" });
    }
    requestAnimationFrame(() => applyDayScroll(day, "auto"));
});
</script>

<div class="flex flex-col h-full">
    <!-- Horizontal scroll-snap pager: the trip overview (panel 0), then one
         full-width panel per day. Each panel is full-height and scrolls
         vertically on its own, so paging never reflows and stays smooth. -->
    <div
        bind:this={dayStrip}
        onscroll={handleStripScroll}
        class="flex flex-1 min-h-0 overflow-x-auto overflow-y-hidden overscroll-x-contain snap-x snap-mandatory [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
        <section class="snap-start snap-always shrink-0 w-full h-full overflow-y-auto overflow-x-hidden overscroll-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <div class="max-w-3xl mx-auto w-full p-5">
                <TripOverview
                    {trip}
                    {days}
                    {countdownText}
                    {profiles}
                    weatherFor={weatherForDay}
                    onSelectDay={day => (currentDay = day)}
                    {onSwitchProfile}
                    {onCreateProfile}
                    {onDeleteProfile}
                    {onShare}
                    {onOpenSettings}
                />
            </div>
        </section>
        {#each days as day (day.day)}
            <!-- snap-always: scroll-snap-stop forces one panel per swipe (no momentum skipping) -->
            <section class="snap-start snap-always shrink-0 w-full h-full overflow-y-auto overflow-x-hidden overscroll-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                <div class="max-w-3xl mx-auto w-full p-5">
                    <Timeline
                        dayData={day}
                        hotels={trip.hotels}
                        mapProvider={trip.mapProvider}
                        weather={weatherForDay(day)}
                        now={clockNow}
                        {onEnlarge}
                        {onSetEventStatus}
                        onShareDay={() => onShareDay(day)}
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
                </div>
            </section>
        {/each}
    </div>
</div>
