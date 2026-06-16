<script lang="ts">
import Calendar from "@lucide/svelte/icons/calendar";
import Car from "@lucide/svelte/icons/car";
import CheckCircle from "@lucide/svelte/icons/check-circle";
import CheckSquare from "@lucide/svelte/icons/check-square";
import Compass from "@lucide/svelte/icons/compass";
import Copy from "@lucide/svelte/icons/copy";
import DollarSign from "@lucide/svelte/icons/dollar-sign";
import Download from "@lucide/svelte/icons/download";
import History from "@lucide/svelte/icons/history";
import Lightbulb from "@lucide/svelte/icons/lightbulb";
import ListChecks from "@lucide/svelte/icons/list-checks";
import ListTodo from "@lucide/svelte/icons/list-todo";
import Loader2 from "@lucide/svelte/icons/loader-2";
import Luggage from "@lucide/svelte/icons/luggage";
import RefreshCw from "@lucide/svelte/icons/refresh-cw";
import Settings from "@lucide/svelte/icons/settings";
import TriangleAlert from "@lucide/svelte/icons/triangle-alert";
import Wallet from "@lucide/svelte/icons/wallet";
import X from "@lucide/svelte/icons/x";
import { onMount } from "svelte";
import { fade } from "svelte/transition";
import { registerSW } from "virtual:pwa-register";
import {
    backupCurrentYaml,
    buildLedgerCsv,
    createChecklistItemId,
    type DayItinerary,
    downloadTextFile,
    fetchDefaultYamlText,
    fetchItinerary,
    getYamlBackup,
    listYamlBackups,
    saveTripData,
    serializeToYaml,
    type TripData,
    USER_YAML_KEY,
    validateYaml,
    type YamlBackup,
} from "./lib/api";
import Checklist from "./lib/components/Checklist.svelte";
import DaySwitcher from "./lib/components/DaySwitcher.svelte";
import Ledger from "./lib/components/Ledger.svelte";
import TaxiHelper from "./lib/components/TaxiHelper.svelte";
import Timeline from "./lib/components/Timeline.svelte";
import TripOverview from "./lib/components/TripOverview.svelte";
import { getLanguageConfig } from "./lib/phrases";
import {
    buildShareUrl,
    clearShareHash,
    decodeShareToken,
    isShareSupported,
    parseShareToken,
    readShareTokenFromHash,
} from "./lib/share";
import type { ToastInput } from "./lib/toast";
import {
    buildDayReport,
    findCurrentEventIndex,
    formatDayDate,
    formatNextEventLabel,
    getCountdownText,
    getNextEventInfo,
    getTodayIsoString,
    toLocalIsoDate,
} from "./lib/utils";
import { acquireScreenWakeLock } from "./lib/wakelock";
import {
    type DailyWeather,
    type DailyWeatherByDate,
    loadDailyWeather,
} from "./lib/weather";

// App State using Svelte 5 Runes
let tripData = $state<TripData | null>(null);
let currentDay = $state(1);
let activeTab = $state("itinerary"); // itinerary | todo | taxi | calc
let isLoading = $state(true);
let loadError = $state<string | null>(null);

// Countdown clock: the interval only ticks `clockNow`; the label re-derives
// from it, so it also updates immediately when a new trip is saved (no manual
// sync). Named to stay distinct from the perf-time `now` locals in the scroll
// handlers — the two timebases must never mix.
let clockNow = $state(new Date());
// The day whose date is the local today — drives the overview capsule, the
// DaySwitcher 今天 marker, and rolls over automatically with the clock tick.
let todayData = $derived(tripData?.days.find(d => d.date === toLocalIsoDate(clockNow)) ?? null);
let nextEvent = $derived(todayData ? getNextEventInfo(todayData.timeline, todayData.date, clockNow) : null);
// Overview-panel capsule: during the trip surface today's next / in-progress
// event; otherwise fall back to the countdown / trip-state label.
let countdownText = $derived.by(() => {
    if (nextEvent) return formatNextEventLabel(nextEvent);
    return tripData ? getCountdownText(tripData.trip, clockNow) : "計算中…";
});

$effect(() => {
    const timer = window.setInterval(() => (clockNow = new Date()), 60000);
    return () => clearInterval(timer);
});

// Toast Notification States
let toastMessage = $state("");
let toastAction = $state<{ label: string; onAction: () => void; } | null>(null);
let isToastVisible = $state(false);
let toastTimer: number;

// PWA update flow: registerType "prompt" keeps the new service worker waiting
// until the user accepts, so an in-use page is never reloaded under them.
let needRefresh = $state(false);
let swRegistration: ServiceWorkerRegistration | undefined;
// Shared between the hourly interval and the visibilitychange path — a single
// timestamp, or a foreground check would be repeated by the next interval tick.
let lastSwUpdateCheck = 0;
const SW_UPDATE_CHECK_MS = 60 * 60 * 1000;

// A traveler may keep the app open for days; without polling, updates are only
// detected on a fresh navigation. Background intervals are throttled or frozen
// on phones, so the visibilitychange resume path calls this too. Offline (the
// flagship scenario) update() rejects — swallow it and retry next check.
function checkForSwUpdate() {
    if (!swRegistration || swRegistration.installing || !navigator.onLine) return;
    if (Date.now() - lastSwUpdateCheck < SW_UPDATE_CHECK_MS) return;
    lastSwUpdateCheck = Date.now();
    swRegistration.update().catch(() => {});
}

const updateSW = registerSW({
    onNeedRefresh() {
        needRefresh = true;
    },
    onOfflineReady() {
        triggerToast("已可離線使用");
    },
    onRegisteredSW(_swUrl, registration) {
        if (!registration) return;
        swRegistration = registration;
        // register() itself just checked for updates; start the throttle now.
        lastSwUpdateCheck = Date.now();
        window.setInterval(checkForSwUpdate, SW_UPDATE_CHECK_MS);
    },
});

// Settings States
let showSettings = $state(false);
let yamlInput = $state("");
let validationError = $state<string | null>(null);
let yamlBackups = $state<YamlBackup[]>([]);

// Enlarged card shown to a driver (local-language name / address) or to a
// counter clerk (reservation confirmation code). Lives at the app level so all
// panels share one overlay — opening it twice can never stack. `null` = closed.
type EnlargedCard =
    | { kind: "place"; title: string; localName: string; address?: string; }
    | { kind: "confirmation"; title: string; code: string; name?: string; note?: string; };
let enlargedCard = $state<EnlargedCard | null>(null);

// Keep the screen on while the card is being shown to a driver. Unsupported
// browsers (iOS standalone < 18.4) silently no-op — see lib/wakelock.ts.
$effect(() => {
    if (!enlargedCard) return;
    return acquireScreenWakeLock();
});

// Dialog focus management: remember the trigger when a dialog opens, move
// focus onto the dialog container (not the first field — focusing the YAML
// textarea would pop the mobile keyboard), and hand focus back on close.
// One effect per dialog covers every open/close path (backdrop, Esc, save).
function manageDialogFocus(isOpen: () => boolean, dialog: () => HTMLElement | undefined) {
    let returnFocus: HTMLElement | null = null;
    $effect(() => {
        if (isOpen()) {
            returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
            dialog()?.focus();
        } else {
            returnFocus?.focus();
            returnFocus = null;
        }
    });
}

let enlargedCardEl = $state<HTMLDivElement>();
let settingsDialogEl = $state<HTMLDivElement>();
manageDialogFocus(() => !!enlargedCard, () => enlargedCardEl);
manageDialogFocus(() => showSettings, () => settingsDialogEl);

function handleWindowKeydown(e: KeyboardEvent) {
    if (e.key !== "Escape") return;
    if (enlargedCard) {
        enlargedCard = null;
        return;
    }
    if (showSettings) attemptCloseSettings();
}

// Reflect the loaded trip name in the browser tab title (falls back to the default).
$effect(() => {
    document.title = tripData?.trip.name ?? "下面一way";
});

// Resolve the built-in phrase set and driver-card labels from `trip.lang`,
// falling back to English when unset/unsupported.
let langConfig = $derived(getLanguageConfig(tripData?.trip.lang));

// --- Daily weather (Open-Meteo), keyed by the exact city string from the YAML ---
let weatherByCity = $state<Record<string, { byDate: DailyWeatherByDate; fetchedAt: number; }>>({});

// City for one day's weather: day.city → trip.city → none. Blank/whitespace
// (and non-string values from hand-written YAML) count as unset and fall back.
function resolveWeatherCity(day: DayItinerary, trip = tripData?.trip): string | null {
    for (const city of [day.city, trip?.city]) {
        if (typeof city === "string" && city.trim()) return city;
    }
    return null;
}

// Reset + fetch when the trip itself changes (load / YAML save).
function loadTripWeather(data: TripData) {
    weatherByCity = {};
    refreshTripWeather(data);
}

// Fetch forecasts for every city the trip references, without clearing what's
// already displayed. Cache-first (3h TTL in lib/weather.ts), so calling this
// again is free until the data is actually stale.
function refreshTripWeather(data: TripData) {
    const cities: string[] = [];
    for (const day of data.days) {
        const city = resolveWeatherCity(day, data.trip);
        if (city && !cities.includes(city)) cities.push(city);
    }
    for (const city of cities) {
        // Merge: a refresh starts at the city's local today, but past trip days
        // already on screen must keep their badges from the previous payload.
        loadDailyWeather(city, (byDate, fetchedAt) => {
            weatherByCity[city] = {
                byDate: { ...weatherByCity[city]?.byDate, ...byDate },
                fetchedAt,
            };
        });
    }
}

// Refresh stale forecasts when the PWA is resumed from the background — during
// a trip the app stays alive in the switcher for days, and onMount never
// re-fires, so without this the forecast would be pinned to day 1's fetch.
function handleVisibilityChange() {
    if (document.visibilityState !== "visible") return;
    // Interval ticks are throttled/frozen in the background; bring the
    // countdown clock current immediately on resume.
    clockNow = new Date();
    checkForSwUpdate();
    if (tripData) {
        refreshTripWeather(tripData);
        // Cross-midnight resume: hop to the new today. The strip realigns via
        // the existing sync effect, whose settle then drives applyDayScroll.
        if (getTodayIsoString() !== lastSyncedDate) syncToToday(tripData);
    }
}

// Forecast for one day. Dates beyond the 16-day forecast horizon have no
// entry, which hides the badge.
function weatherForDay(day: DayItinerary): DailyWeather | null {
    const city = resolveWeatherCity(day);
    if (!city) return null;
    return weatherByCity[city]?.byDate[day.date] ?? null;
}

// Open-Meteo data is CC BY 4.0 — show the attribution whenever any badge does.
let showWeatherAttribution = $derived(tripData?.days.some(d => weatherForDay(d)) ?? false);

// Offline-staleness note on the attribution line. The 24h threshold must stay
// above the 3h refresh TTL so routine background refreshes are never flagged.
// Deriving from clockNow keeps the age current on ticks and foreground resume.
const STALE_WEATHER_MS = 1000 * 60 * 60 * 24;
let staleWeatherHours = $derived.by(() => {
    if (!tripData) return null;
    let oldest: number | null = null;
    for (const day of tripData.days) {
        const city = resolveWeatherCity(day, tripData.trip);
        if (!city) continue;
        const entry = weatherByCity[city];
        if (!entry || !entry.byDate[day.date]) continue;
        if (oldest === null || entry.fetchedAt < oldest) oldest = entry.fetchedAt;
    }
    if (oldest === null) return null;
    const age = clockNow.getTime() - oldest;
    return age >= STALE_WEATHER_MS ? Math.floor(age / (1000 * 60 * 60)) : null;
});

// --- Switch day via a horizontal scroll-snap strip (native swipe / trackpad) ---
// Each day is a full-width snap panel; the browser handles the gesture, so text
// selection and vertical scroll never clash with paging. `currentDay` stays the
// single source of truth: scrolling updates it, and DaySwitcher / auto-jump
// changes scroll the strip to match.
let dayStrip = $state<HTMLDivElement>();
// While we animate a programmatic jump (e.g. a DaySwitcher tap), the scroll
// handler must not react to intermediate panels — otherwise a multi-day jump
// gets hijacked and halts partway. The lock releases on *arrival* (scrollLeft
// reaches the target), not on a fixed timer, so it survives long animations.
let stripScrollLock = false;
let stripLockTimer: number;
// Marks a `currentDay` change that came from the user's own scroll, so the sync
// effect won't fire a competing `scrollTo` against the browser's native snap
// (which otherwise causes a visible jitter once the swipe settles).
let syncingFromScroll = false;

// Vertical auto-scroll once a day-switch settles: to the top, or to the
// in-progress event when the settled day is today. `lastSettledDay` lives on
// the component (not the strip) so the realign settle after a tab-switch
// remount can't re-trigger a scroll for the same day.
let lastSettledDay: number | null = null;
let stripSettleTimer: number;
// Debounce instead of `scrollend` (unsupported on older iOS Safari): the strip
// is considered settled when scroll events stop AND it rests on a snap point.
const STRIP_SETTLE_MS = 160;
const EVENT_SCROLL_GAP = 8;
// Armed by loadTripData; consumed by the initial-positioning effect below.
let pendingInitialScroll = false;
let headerEl = $state<HTMLElement>();
// Rescue for a strip stuck between snap points (WebKit occasionally drops the
// snap animation mid-glide): once scroll events stop off a snap point and no
// finger is on the strip, nudge it to the nearest panel instead of waiting
// for the user to drag it straight themselves.
let stripTouchActive = false;
let stripRescueTimer: number;
const STRIP_RESCUE_MS = 250;

// Day number ↔ strip panel index. Panel 0 is the trip overview (day 0); the
// day panels follow in YAML order, shifted by one.
function dayToIndex(day: number): number | null {
    if (day === 0) return 0;
    const idx = tripData?.days.findIndex(d => d.day === day) ?? -1;
    return idx < 0 ? null : idx + 1;
}

function indexToDay(idx: number): number | null {
    if (idx === 0) return 0;
    return tripData?.days[idx - 1]?.day ?? null;
}

function dayOffsetLeft(day: number): number | null {
    const idx = dayToIndex(day);
    if (idx === null || !dayStrip) return null;
    return idx * dayStrip.clientWidth;
}

function scrollBehavior(): "auto" | "smooth" {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
}

// Vertical position for one day: today scrolls to its in-progress event
// (none started yet → top), any other day scrolls to the top.
function applyDayScroll(day: number, behavior: "auto" | "smooth" = scrollBehavior()) {
    if (!tripData || !dayStrip) return;
    const dayData = tripData.days.find(d => d.day === day);
    if (!dayData) {
        // The overview panel (day 0) always rests at the top.
        if (day === 0) window.scrollTo({ top: 0, behavior });
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
        window.scrollTo({ top: 0, behavior });
        return;
    }
    const panelIdx = dayToIndex(day);
    const card = panelIdx === null
        ? undefined
        : dayStrip.children[panelIdx]
            ?.querySelectorAll<HTMLElement>("[data-timeline-event]")[eventIdx];
    if (!card) {
        window.scrollTo({ top: 0, behavior });
        return;
    }
    // The sticky header occupies flow space, so offsetting by its height as
    // measured NOW self-corrects: however the header ends up (collapse on
    // scroll-down, expand near the top), the content shift cancels exactly and
    // the card lands right below the final header.
    const headerH = headerEl?.offsetHeight ?? 0;
    const top = Math.max(0, card.getBoundingClientRect().top + window.scrollY - headerH - EVENT_SCROLL_GAP);
    window.scrollTo({ top, behavior });
}

function armStripSettle() {
    clearTimeout(stripSettleTimer);
    stripSettleTimer = window.setTimeout(onStripSettled, STRIP_SETTLE_MS);
}

function onStripSettled() {
    if (!dayStrip || !tripData) return;
    const width = dayStrip.clientWidth;
    if (width <= 0) return;
    const idx = Math.round(dayStrip.scrollLeft / width);
    // Not on a snap point: either a mid-pan rest (finger still down — the
    // rescue bails) or a genuinely stuck strip (snap dropped — rescue snaps it
    // to the nearest panel after a grace period).
    if (Math.abs(dayStrip.scrollLeft - idx * width) >= 2) {
        scheduleStripRescue();
        return;
    }
    const day = indexToDay(idx);
    if (day === null || day === lastSettledDay) return;
    // A multi-day programmatic jump pausing on an intermediate panel: wait for
    // the real arrival (the lock releases at the target).
    if (stripScrollLock && day !== currentDay) return;
    lastSettledDay = day;
    applyDayScroll(day);
}

function scheduleStripRescue() {
    clearTimeout(stripRescueTimer);
    stripRescueTimer = window.setTimeout(() => {
        const strip = dayStrip;
        if (!strip || stripTouchActive || stripScrollLock) return;
        const width = strip.clientWidth;
        if (width <= 0) return;
        const target = Math.round(strip.scrollLeft / width) * width;
        if (Math.abs(strip.scrollLeft - target) < 2) return;
        const startLeft = strip.scrollLeft;
        strip.scrollTo({ left: target, behavior: scrollBehavior() });
        // A cancelled smooth scroll emits no events (same WebKit caveat as the
        // realign effect) — if nothing moved by the deadline, jump instantly.
        window.setTimeout(() => {
            if (strip.isConnected && !stripTouchActive && Math.abs(strip.scrollLeft - startLeft) < 2) {
                strip.scrollTo({ left: target, behavior: "auto" });
            }
        }, 400);
    }, STRIP_RESCUE_MS);
}

function handleStripTouchEnd(e: TouchEvent) {
    if (e.touches.length > 0) return;
    stripTouchActive = false;
    // A release with no momentum and a dropped snap emits no further scroll
    // events, so nothing else would ever re-check — schedule the rescue here.
    scheduleStripRescue();
}

function handleStripScroll() {
    clearTimeout(stripRescueTimer); // movement = gesture or snap still working
    armStripSettle(); // feeds both user swipes and programmatic smooth scrolls
    if (!dayStrip || !tripData) return;
    if (stripScrollLock) {
        // Release once we've reached the programmatic target for currentDay.
        const target = dayOffsetLeft(currentDay);
        if (target !== null && Math.abs(dayStrip.scrollLeft - target) < 2) stripScrollLock = false;
        return;
    }
    const idx = Math.round(dayStrip.scrollLeft / dayStrip.clientWidth);
    const day = indexToDay(idx);
    if (day !== null && day !== currentDay) {
        syncingFromScroll = true;
        currentDay = day;
    }
}

// Desktop: Chrome often swallows vertical wheel events over the snap-x strip
// instead of chaining them to the page, so the itinerary won't scroll under a
// mouse wheel. Redirect dominant-vertical wheel to the window ourselves. This
// needs preventDefault, hence a manually-attached non-passive listener
// (Svelte's `onwheel` attribute is passive).
$effect(() => {
    const strip = dayStrip;
    if (!strip) return;
    const onWheel = (e: WheelEvent) => {
        if (e.ctrlKey) return; // pinch-zoom gesture
        if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return; // horizontal pan stays native
        e.preventDefault();
        // deltaMode 1 = lines (Firefox); approximate a line as 16px.
        window.scrollBy({ top: e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY, behavior: "auto" });
    };
    strip.addEventListener("wheel", onWheel, { passive: false });
    return () => strip.removeEventListener("wheel", onWheel);
});

// Keep the strip aligned to `currentDay` (e.g. after a DaySwitcher tap). Skips
// when the change came from scrolling, so the browser's snap isn't fought.
$effect(() => {
    const target = dayOffsetLeft(currentDay);
    if (target === null || !dayStrip) return;
    if (syncingFromScroll) {
        syncingFromScroll = false;
        return;
    }
    if (Math.abs(dayStrip.scrollLeft - target) > 2) {
        const strip = dayStrip;
        const startLeft = strip.scrollLeft;
        stripScrollLock = true;
        // Safety net doubles as a fallback: Chrome silently cancels smooth
        // scrolls on snap-mandatory containers (e.g. right after a remount),
        // leaving the chip and the panel desynced. If nothing moved at all by
        // the deadline, jump instantly; if the user grabbed the strip mid-
        // animation (scrollLeft moved), leave their position alone.
        clearTimeout(stripLockTimer);
        stripLockTimer = setTimeout(() => {
            stripScrollLock = false;
            if (strip.isConnected && Math.abs(strip.scrollLeft - startLeft) < 2) {
                strip.scrollTo({ left: target, behavior: "auto" });
            }
        }, 1000);
        strip.scrollTo({ left: target, behavior: scrollBehavior() });
    }
});

// Initial positioning: when today is Day 1 the strip never scrolls (scrollLeft
// is already 0), so settle detection can't fire — trigger explicitly once the
// strip is mounted and trip data is ready. Also covers re-loads from Settings.
$effect(() => {
    if (!dayStrip || !tripData || !pendingInitialScroll) return;
    pendingInitialScroll = false;
    // Pre-claim the settle so the concurrent horizontal realign (when today
    // isn't Day 1) doesn't double-fire the vertical scroll.
    lastSettledDay = currentDay;
    const day = currentDay;
    // Align the strip instantly: a fresh load should land on today without an
    // animation, and the smooth realign above is best-effort only (Chrome may
    // cancel it on a snap container that is still laying out).
    const target = dayOffsetLeft(day);
    if (target !== null && Math.abs(dayStrip.scrollLeft - target) > 2) {
        dayStrip.scrollTo({ left: target, behavior: "auto" });
    }
    requestAnimationFrame(() => applyDayScroll(day, "auto"));
});

onMount(async () => {
    // 0. If opened via a share link, offer to import it before loading.
    await maybeImportSharedItinerary();

    // 1. Fetch Trip Itinerary
    await loadTripData();
});

// If the URL hash carries a shared itinerary, decode it and ask before
// overwriting whatever itinerary already lives on this device. The hash is
// always stripped afterwards so a refresh won't re-prompt.
async function maybeImportSharedItinerary() {
    const token = readShareTokenFromHash();
    if (!token) return;
    try {
        const yaml = await decodeShareToken(token);
        const parsed = validateYaml(yaml); // throws on invalid structure/syntax
        const hasExisting = !!localStorage.getItem(USER_YAML_KEY);
        const message = hasExisting
            ? "偵測到分享的行程。要以此行程「覆蓋」目前裝置上的行程嗎？（原行程將被取代）"
            : "偵測到分享的行程，要載入嗎？";
        if (confirm(message)) {
            backupCurrentYaml();
            // Canonicalize (strip runtime ids, re-add schema line) before storing.
            localStorage.setItem(USER_YAML_KEY, serializeToYaml(parsed));
            triggerToast("已載入分享的行程");
        }
    } catch (err) {
        console.error("Failed to import shared itinerary:", err);
        triggerToast("分享連結內容無效，已略過");
    } finally {
        clearShareHash();
    }
}

// Local date `currentDay` was last auto-synced to. A resume on the SAME date
// must never override the user's manual day browsing; only an actual rollover
// (cross-midnight background → foreground) re-syncs.
let lastSyncedDate = "";

// Auto-jump to today's itinerary if the trip is active.
function syncToToday(data: TripData) {
    if (!data.days || data.days.length === 0) return;
    const todayStr = getTodayIsoString();
    lastSyncedDate = todayStr;
    const matchingDay = data.days.find(d => d.date === todayStr);

    // Outside the trip dates, land on the overview panel (day 0) — that's
    // where the countdown / wrap-up label lives.
    currentDay = matchingDay ? matchingDay.day : 0;
}

async function loadTripData() {
    isLoading = true;
    loadError = null;
    try {
        const data = await fetchItinerary();
        tripData = data;
        loadTripWeather(data);

        // Fold any legacy per-list checked-state into the itinerary, then write
        // the unified data back so YAML becomes the single source of truth.
        if (migrateLegacyChecklistState(data)) {
            persistTripData();
        }

        syncToToday(data);
        pendingInitialScroll = true;
    } catch (err) {
        console.error("Failed to load trip data:", err);
        loadError = "無法載入或解析行程資料。請開啟設定確認 YAML 語法。";
    } finally {
        isLoading = false;
    }
}

// Persist the current in-memory trip data back into the user YAML so edits
// (add / delete / toggle on checklists) survive a reload.
function persistTripData() {
    if (!tripData) return;
    try {
        saveTripData(tripData);
    } catch (err) {
        console.error("Failed to persist trip data:", err);
        triggerToast("儲存失敗，請稍後再試");
    }
}

// One-time migration: older versions kept checklist checked-state in separate
// localStorage keys (todo_state / packing_state). Fold those values into the
// itinerary data (single source of truth) and remove the legacy keys.
function migrateLegacyChecklistState(data: TripData): boolean {
    let migrated = false;
    const legacy: Array<["todo" | "packing", string]> = [
        ["todo", "todo_state"],
        ["packing", "packing_state"],
    ];
    for (const [listKey, storageKey] of legacy) {
        const saved = localStorage.getItem(storageKey);
        if (!saved) continue;
        try {
            const map = JSON.parse(saved) as Record<string, boolean>;
            for (const item of data[listKey]) {
                // Legacy YAML keyed checked-state by a persisted `id`, which is
                // no longer part of the schema; read it off the raw parsed item.
                const legacyId = (item as { id?: string; }).id;
                if (legacyId && legacyId in map) item.checked = map[legacyId];
            }
            migrated = true;
        } catch (e) {
            console.error("Failed to migrate legacy checklist state:", e);
        }
        localStorage.removeItem(storageKey);
    }
    return migrated;
}

// --- Checklist editing handlers (todo / packing) ---
function toggleChecklistItem(list: "todo" | "packing", id: string) {
    if (!tripData) return;
    const item = tripData[list].find(i => i._id === id);
    if (!item) return;
    item.checked = !item.checked;
    persistTripData();
}

function addChecklistItem(list: "todo" | "packing", text: string) {
    if (!tripData) return;
    tripData[list].push({
        _id: createChecklistItemId(list === "todo" ? "todo" : "pack"),
        text,
        checked: false,
    });
    persistTripData();
}

function deleteChecklistItem(list: "todo" | "packing", id: string) {
    if (!tripData) return;
    const index = tripData[list].findIndex(i => i._id === id);
    if (index < 0) return;
    const removed = { ...tripData[list][index] };
    tripData[list] = tripData[list].filter(i => i._id !== id);
    persistTripData();
    const label = removed.text.length > 10 ? `${removed.text.slice(0, 10)}…` : removed.text;
    triggerToast({
        message: `已刪除「${label}」`,
        actionLabel: "復原",
        onAction: () => {
            if (!tripData) return;
            // The list may have changed since the delete (e.g. another item
            // removed) — reinsert the snapshot at its original position,
            // clamped to the current length.
            const next = [...tripData[list]];
            next.splice(Math.min(index, next.length), 0, removed);
            tripData[list] = next;
            persistTripData();
        },
    });
}

// --- Timeline event check-in (done / skipped); `undefined` clears the mark ---
function setEventStatus(id: string, nextStatus: "done" | "skipped" | undefined) {
    if (!tripData) return;
    for (const day of tripData.days) {
        const event = day.timeline.find(e => e._id === id);
        if (!event) continue;
        if (nextStatus === undefined) delete event.status;
        else event.status = nextStatus;
        persistTripData();
        return;
    }
}

function addTripWallet(name: string) {
    if (!tripData) return;
    if (!tripData.trip.wallets) {
        tripData.trip.wallets = [];
    }
    if (!tripData.trip.wallets.includes(name)) {
        tripData.trip.wallets.push(name);
        persistTripData();
    }
}

// Snapshot of the YAML when the editor was opened, used to detect unsaved edits
let yamlSnapshot = "";

// Open Settings & Load current YAML text
async function openSettings() {
    showSettings = true;
    validationError = null;
    yamlBackups = listYamlBackups();

    const customYaml = localStorage.getItem(USER_YAML_KEY);
    if (customYaml) {
        yamlInput = customYaml;
    } else {
        // Load default template for editing — same offline-safe fallback chain
        // as the initial load (see fetchDefaultYamlText).
        try {
            yamlInput = await fetchDefaultYamlText();
        } catch {
            yamlInput = "";
        }
    }

    yamlSnapshot = yamlInput;
}

// Close settings, warning if there are unsaved edits
function attemptCloseSettings() {
    if (yamlInput !== yamlSnapshot && !confirm("尚有未儲存的變更，確定要關閉嗎？")) {
        return;
    }
    showSettings = false;
    validationError = null;
}

// Save Settings & Validate YAML
async function saveSettings() {
    try {
        // Allow pasting a share link directly: decode it to YAML before parsing.
        const token = parseShareToken(yamlInput);
        const source = token ? await decodeShareToken(token) : yamlInput;
        const parsed = validateYaml(source);
        // Canonicalize on save: re-serialize the parsed data so the stored (and
        // re-displayed) YAML always has a consistent key order and is stripped
        // of runtime/legacy ids. This is what makes the layout look the same
        // every time Settings is reopened.
        const tidied = serializeToYaml(parsed);
        backupCurrentYaml();
        localStorage.setItem(USER_YAML_KEY, tidied);
        yamlInput = tidied;
        yamlSnapshot = tidied;
        showSettings = false;
        validationError = null;
        triggerToast(token ? "已從分享連結載入行程！" : "自訂 YAML 行程儲存成功！");
        await loadTripData();
    } catch (err) {
        console.error("YAML Validation failed:", err);
        const errorMessage = err instanceof Error ? err.message : "YAML 格式錯誤，請檢查縮排！";
        validationError = errorMessage;
    }
}

// Generate a self-contained share link from the currently loaded trip and
// offer it through the native share sheet (clipboard fallback). Triggered from
// the overview panel, so feedback goes through toasts (no settings modal open).
async function shareCurrentTrip() {
    if (!tripData) return;
    if (!isShareSupported()) {
        triggerToast("此瀏覽器不支援連結壓縮，無法產生分享連結");
        return;
    }
    try {
        const url = await buildShareUrl(serializeToYaml(tripData));
        await shareOrCopy({ url }, url, "分享連結已複製！網址較長，可用短網址服務縮短");
    } catch (err) {
        console.error("Failed to build share link:", err);
        triggerToast("無法產生分享連結，請稍後再試");
    }
}

// 今日報平安: share one day's plain-text report. Uses the same native share
// sheet (with clipboard fallback) as the trip-link share above.
async function shareDayReport(dayData: DayItinerary) {
    if (!tripData) return;
    const text = buildDayReport(dayData, tripData.trip.hotels, tripData.trip.name);
    await shareOrCopy({ text }, text, "已複製今日行程，可直接貼上分享");
}

// --- File export: the escape hatch for the localStorage single-point-of-loss
// risk — gets the trip YAML and the ledger records off this device as files. ---
function exportDateStamp(): string {
    return toLocalIsoDate(new Date()).replaceAll("-", "");
}

function exportTripYaml() {
    if (!tripData) {
        triggerToast("目前沒有可匯出的行程");
        return;
    }
    try {
        downloadTextFile(`show-me-way-行程-${exportDateStamp()}.yaml`, serializeToYaml(tripData), "application/yaml;charset=utf-8");
        triggerToast("已匯出行程 YAML");
    } catch (err) {
        console.error("Failed to export trip YAML:", err);
        triggerToast("匯出失敗，請稍後再試");
    }
}

function exportLedgerCsv() {
    try {
        const csv = buildLedgerCsv();
        if (csv === null) {
            triggerToast("尚無記帳紀錄可匯出");
            return;
        }
        downloadTextFile(`show-me-way-記帳-${exportDateStamp()}.csv`, csv, "text/csv;charset=utf-8");
        triggerToast("已匯出記帳 CSV");
    } catch (err) {
        console.error("Failed to export ledger CSV:", err);
        triggerToast("匯出失敗，請稍後再試");
    }
}

// zh-TW timestamp for the backup list, e.g. "06/11(四) 14:30".
function formatBackupTime(savedAt: string): string {
    const date = new Date(savedAt);
    if (isNaN(date.getTime())) return savedAt;
    const hh = String(date.getHours()).padStart(2, "0");
    const mm = String(date.getMinutes()).padStart(2, "0");
    return `${formatDayDate(toLocalIsoDate(date))} ${hh}:${mm}`;
}

// Restore an auto-backup. Validation runs before anything else so a failed
// restore never touches the backup ring; the snapshot of the current YAML is
// taken right before the overwrite. The backup content is read out first, or
// a full ring could evict the very entry being restored.
async function restoreYamlBackup(savedAt: string) {
    // Unsaved editor edits never reach USER_YAML_KEY, so no snapshot can
    // recover them — they are the only truly unrecoverable content here.
    if (yamlInput !== yamlSnapshot && !confirm("尚有未儲存的變更，還原備份將捨棄這些變更，確定繼續嗎？")) {
        return;
    }
    const yaml = getYamlBackup(savedAt);
    if (!yaml) {
        triggerToast("找不到此備份");
        yamlBackups = listYamlBackups();
        return;
    }
    try {
        validateYaml(yaml);
    } catch (err) {
        // A backup saved under older, looser validation rules can fail here.
        // Load it into the editor so the exact error can guide a manual fix.
        console.error("Backup YAML validation failed:", err);
        yamlInput = yaml;
        validationError = err instanceof Error ? err.message : "YAML 格式錯誤，請檢查縮排！";
        yamlBackups = listYamlBackups();
        triggerToast("此備份內容無效，已載入編輯器，請修正後再儲存");
        return;
    }
    if (!confirm("要以此備份覆蓋目前的行程嗎？")) return;
    backupCurrentYaml();
    localStorage.setItem(USER_YAML_KEY, yaml);
    showSettings = false;
    validationError = null;
    triggerToast("已還原備份的行程");
    await loadTripData();
}

// Reset to Local default
async function resetToLocalDefault() {
    // Unsaved editor edits never reach USER_YAML_KEY (and may hold an invalid
    // backup loaded for repair) — same guard as restoreYamlBackup.
    if (yamlInput !== yamlSnapshot && !confirm("尚有未儲存的變更，回復預設將捨棄這些變更，確定繼續嗎？")) {
        return;
    }
    if (confirm("要清除自訂 YAML，並恢復為專案預設的行程嗎？")) {
        backupCurrentYaml();
        localStorage.removeItem(USER_YAML_KEY);
        showSettings = false;
        validationError = null;
        triggerToast("已恢復為預設行程…");
        await loadTripData();
    }
}

// Global Clipboard Copy
function handleCopy(text: string, successMsg = "已複製") {
    navigator.clipboard.writeText(text).then(() => {
        triggerToast(successMsg);
    }).catch(() => {
        const textarea = document.createElement("textarea");
        textarea.value = text;
        textarea.style.position = "fixed";
        document.body.appendChild(textarea);
        textarea.select();
        try {
            document.execCommand("copy");
            triggerToast(successMsg);
        } catch {
            triggerToast("複製失敗，請手動複製");
        }
        document.body.removeChild(textarea);
    });
}

// Share via the native share sheet when available, otherwise fall back to the
// clipboard. Keeps every "分享" action consistent: a user-cancelled share sheet
// stays silent, while a missing API or a real failure degrades to a copy.
async function shareOrCopy(data: { url?: string; text?: string; title?: string; }, copyText: string, copyMsg: string) {
    if (typeof navigator.share === "function") {
        try {
            await navigator.share(data);
            return;
        } catch (err) {
            // User cancel (closed the sheet) is silent by design; real failures
            // (busy sheet, permission) degrade to the clipboard path below.
            if ((err as DOMException)?.name === "AbortError") return;
        }
    }
    handleCopy(copyText, copyMsg);
}

// Trigger Toast Notification: a plain message, or an action variant
// ({ message, actionLabel, onAction }) used for undo — that one stays up
// longer so the button can actually be reached.
function triggerToast(toast: ToastInput) {
    const opts = typeof toast === "string" ? { message: toast } : toast;
    toastMessage = opts.message;
    toastAction = opts.actionLabel && opts.onAction
        ? { label: opts.actionLabel, onAction: opts.onAction }
        : null;
    isToastVisible = true;
    // Back-to-back toasts must restart the clock, or the first timer would
    // hide the second toast early and cut an undo window short.
    clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => {
        isToastVisible = false;
    }, toastAction ? 4500 : 2500);
}

function handleToastAction() {
    const action = toastAction?.onAction;
    clearTimeout(toastTimer);
    isToastVisible = false;
    action?.();
}

// Select all text in the YAML editor
function selectAllYaml() {
    const textarea = document.getElementById("yaml-editor") as HTMLTextAreaElement | null;
    if (textarea) {
        textarea.focus();
        textarea.select();
        triggerToast("已全選編輯器內容");
    }
}

// Clear all text in the YAML editor
function clearYaml() {
    yamlInput = "";
    triggerToast("已清空編輯器內容");
}
</script>

<svelte:window onkeydown={handleWindowKeydown} />
<svelte:document onvisibilitychange={handleVisibilityChange} />

<div class="flex flex-col min-h-screen bg-bg-main text-text-primary pb-[calc(80px+var(--safe-bottom))] animate-fade-in">
    <!-- App Header: just the day switcher now — trip name, countdown and the
         settings entry live on the overview panel (day 0) inside the strip. -->
    {#if tripData && activeTab === "itinerary"}
        <header bind:this={headerEl} class="sticky top-0 z-[100] bg-[#0d0e15]/85 backdrop-blur-xl border-b border-white/5 pt-[calc(12px+var(--safe-top))] px-5">
            <div class="max-w-3xl mx-auto w-full">
                <!-- Day Switcher component (Formats ISO dates to MM/DD(W) dynamically) -->
                <DaySwitcher days={tripData.days.map(d => ({ day: d.day, date: formatDayDate(d.date) }))} bind:currentDay todayDay={todayData?.day ?? null} />
            </div>
        </header>
    {/if}

    <!-- Main Content Area: pads for the notch itself when the header is absent
         (loading / error / non-itinerary tabs). -->
    <main class="flex-1 p-5 max-w-3xl mx-auto w-full {tripData && activeTab === 'itinerary' ? '' : 'pt-[calc(20px+var(--safe-top))]'}">
        {#if isLoading}
            <div class="flex flex-col items-center justify-center py-20 gap-3">
                <Loader2 class="animate-spin text-neon-blue" size={36} />
                <p class="text-text-secondary text-sm">正在載入行程資料…</p>
            </div>
        {:else if loadError}
            <div class="glass-panel rounded-2xl p-6 text-center border-neon-pink/35 shadow-[0_0_15px_rgba(255,42,116,0.1)]">
                <TriangleAlert size={32} class="text-neon-pink mx-auto mb-3" aria-hidden="true" />
                <p class="text-text-primary text-sm font-semibold mb-4">{loadError}</p>
                <button
                    onclick={openSettings}
                    class="bg-gradient-to-r from-neon-blue to-neon-purple text-black font-bold py-2.5 px-6 rounded-xl text-xs transition active:scale-[0.98] cursor-pointer"
                >
                    開啟設定並貼上 YAML
                </button>
            </div>
        {:else if tripData}
            <!-- Tab contents rendering -->
            <div class="animate-fade-in">
                {#if activeTab === "itinerary"}
                    {#if tripData.days.length > 0}
                        <!-- Horizontal scroll-snap strip: the trip overview (panel 0),
                             then one full-width panel per day. The row is as tall as
                             its tallest panel, so off-screen panels are capped to one
                             viewport (max-h-dvh): they stay visible while swiping, but
                             a short day no longer gets dead scroll space below it from
                             a longer sibling. -->
                        <!-- svelte-ignore a11y_no_static_element_interactions (touch
                             handlers only observe the gesture for snap rescue) -->
                        <div
                            bind:this={dayStrip}
                            onscroll={handleStripScroll}
                            ontouchstart={() => {
                                stripTouchActive = true;
                                clearTimeout(stripRescueTimer);
                            }}
                            ontouchend={handleStripTouchEnd}
                            ontouchcancel={handleStripTouchEnd}
                            class="flex overflow-x-auto overscroll-x-contain snap-x snap-mandatory items-start [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
                        >
                            <section class="snap-start snap-always shrink-0 w-full {currentDay === 0 ? '' : 'max-h-dvh overflow-hidden'}">
                                <TripOverview
                                    trip={tripData.trip}
                                    days={tripData.days}
                                    {countdownText}
                                    weatherFor={weatherForDay}
                                    onSelectDay={day => (currentDay = day)}
                                    onShare={shareCurrentTrip}
                                    onOpenSettings={openSettings}
                                />
                            </section>
                            {#each tripData.days as day (day.day)}
                                <!-- snap-always: scroll-snap-stop forces one panel per swipe (no momentum skipping) -->
                                <section class="snap-start snap-always shrink-0 w-full {currentDay === day.day ? '' : 'max-h-dvh overflow-hidden'}">
                                    <Timeline
                                        dayData={day}
                                        hotels={tripData.trip.hotels}
                                        mapProvider={tripData.trip.mapProvider}
                                        weather={weatherForDay(day)}
                                        now={clockNow}
                                        onEnlarge={card => (enlargedCard = card)}
                                        onSetEventStatus={setEventStatus}
                                        onShareDay={() => shareDayReport(day)}
                                        onCopy={handleCopy}
                                    />
                                </section>
                            {/each}
                        </div>
                        {#if showWeatherAttribution}
                            <p class="text-center text-[10px] text-text-muted mt-2">
                                天氣資料：<a
                                    href="https://open-meteo.com/"
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    class="underline hover:text-text-secondary transition"
                                >Open-Meteo.com</a> (CC BY 4.0){#if staleWeatherHours !== null}（{staleWeatherHours} 小時前）{/if}
                            </p>
                        {/if}
                    {/if}
                {:else if activeTab === "todo"}
                    <div class="mb-4">
                        <h2 class="text-xl font-extrabold text-text-primary tracking-tight flex items-center gap-2">
                            <ListChecks size={22} class="text-neon-blue" aria-hidden="true" />行前準備與打包
                        </h2>
                        <p class="text-xs text-text-secondary mt-0.5">狀態將自動快取於手機</p>
                    </div>
                    <Checklist
                        title="待辦事項"
                        icon={ListTodo}
                        items={tripData.todo}
                        onToggle={id => toggleChecklistItem("todo", id)}
                        onAdd={text => addChecklistItem("todo", text)}
                        onDelete={id => deleteChecklistItem("todo", id)}
                    />
                    <Checklist
                        title="隨身行李與打包"
                        icon={Luggage}
                        items={tripData.packing}
                        onToggle={id => toggleChecklistItem("packing", id)}
                        onAdd={text => addChecklistItem("packing", text)}
                        onDelete={id => deleteChecklistItem("packing", id)}
                    />
                {:else if activeTab === "taxi"}
                    <div class="mb-4">
                        <h2 class="text-xl font-extrabold text-text-primary tracking-tight flex items-center gap-2">
                            <Car size={22} class="text-neon-blue" aria-hidden="true" />乘車助手 & 實用常用語
                        </h2>
                        <p class="text-xs text-text-secondary mt-0.5">出示給司機或快速複製使用</p>
                    </div>
                    <TaxiHelper
                        hotels={tripData.trip.hotels}
                        phrases={langConfig.phrases}
                        driverPrompt={langConfig.driverPrompt}
                        copyAddressLabel={langConfig.copyAddressLabel}
                        onCopy={handleCopy}
                        onEnlarge={card => (enlargedCard = card)}
                    />
                {:else if activeTab === "calc"}
                    <div class="mb-4">
                        <h2 class="text-xl font-extrabold text-text-primary tracking-tight flex items-center gap-2">
                            <Wallet size={22} class="text-neon-blue" aria-hidden="true" />匯率與消費記帳
                        </h2>
                        <p class="text-xs text-text-secondary mt-0.5">出國換算與儲值餘額管理</p>
                    </div>
                    <Ledger
                        currency={tripData.trip.currency}
                        wallets={tripData.trip.wallets}
                        onAddWallet={addTripWallet}
                        onToast={triggerToast}
                    />
                {/if}
            </div>
        {/if}
    </main>

    <!-- Bottom Tab Navigation -->
    <nav class="fixed bottom-0 left-0 right-0 h-[calc(64px+var(--safe-bottom))] bg-[#0d0e15]/88 backdrop-blur-2xl border-t border-white/5 z-[100]">
        <div class="max-w-3xl mx-auto w-full h-full flex justify-around items-center pb-[var(--safe-bottom)]">
            <button
                onclick={() => (activeTab = "itinerary")}
                class="flex flex-col items-center justify-center flex-1 h-full text-text-muted transition-colors cursor-pointer {activeTab === 'itinerary' ? 'text-neon-blue' : ''}"
            >
                <Calendar size={20} class={activeTab === "itinerary" ? "stroke-neon-blue filter drop-shadow-[0_0_4px_rgba(0,240,255,0.4)]" : ""} />
                <span class="text-[10px] font-semibold mt-1">行程</span>
            </button>
            <button
                onclick={() => (activeTab = "todo")}
                class="flex flex-col items-center justify-center flex-1 h-full text-text-muted transition-colors cursor-pointer {activeTab === 'todo' ? 'text-neon-blue' : ''}"
            >
                <CheckSquare size={20} class={activeTab === "todo" ? "stroke-neon-blue filter drop-shadow-[0_0_4px_rgba(0,240,255,0.4)]" : ""} />
                <span class="text-[10px] font-semibold mt-1">準備</span>
            </button>
            <button
                onclick={() => (activeTab = "taxi")}
                class="flex flex-col items-center justify-center flex-1 h-full text-text-muted transition-colors cursor-pointer {activeTab === 'taxi' ? 'text-neon-blue' : ''}"
            >
                <Compass size={20} class={activeTab === "taxi" ? "stroke-neon-blue filter drop-shadow-[0_0_4px_rgba(0,240,255,0.4)]" : ""} />
                <span class="text-[10px] font-semibold mt-1">助手</span>
            </button>
            <button
                onclick={() => (activeTab = "calc")}
                class="flex flex-col items-center justify-center flex-1 h-full text-text-muted transition-colors cursor-pointer {activeTab === 'calc' ? 'text-neon-blue' : ''}"
            >
                <DollarSign size={20} class={activeTab === "calc" ? "stroke-neon-blue filter drop-shadow-[0_0_4px_rgba(0,240,255,0.4)]" : ""} />
                <span class="text-[10px] font-semibold mt-1">記帳</span>
            </button>
        </div>
    </nav>

    <!-- Global Toast Notification: sits between the nav (64px+safe) and the
         update banner (148px+safe). pointer-events-none on the pill so a
         passing notice never intercepts taps aimed at the banner below the
         z-[2000] layer; only the undo action button re-enables them. -->
    <div
        role="status"
        aria-live="polite"
        class="
            pointer-events-none fixed bottom-[calc(96px+var(--safe-bottom))] left-1/2 -translate-x-1/2 bg-neon-blue text-black font-bold text-xs py-2.5 px-5 rounded-full z-[2000] shadow-[0_4px_15px_rgba(0,240,255,0.3)] transition-[opacity,transform] duration-300 flex items-center gap-1.5
            {isToastVisible ? 'opacity-100 translate-y-0 visible' : 'opacity-0 translate-y-5 invisible'}
        "
    >
        <CheckCircle size={14} class="stroke-[3]" aria-hidden="true" />
        {toastMessage}
        {#if toastAction}
            <button
                onclick={handleToastAction}
                class="pointer-events-auto min-w-[44px] min-h-[44px] -my-3.5 -mr-4 pl-2 pr-3.5 flex items-center justify-center font-black underline underline-offset-2 cursor-pointer"
            >
                {toastAction.label}
            </button>
        {/if}
    </div>

    <!-- PWA Update Prompt -->
    {#if needRefresh}
        <!-- z-[200]: above the nav (z-[100]) but below full-screen overlays
             (z-[1000]) so it never intercepts taps meant for an open modal.
             148px+safe keeps it clear of the toast at 96px+safe. -->
        <div class="fixed bottom-[calc(148px+var(--safe-bottom))] left-1/2 -translate-x-1/2 z-[200] bg-[#121422] border border-neon-blue/40 rounded-full py-1.5 pl-4 pr-1.5 flex items-center gap-2 shadow-[0_4px_15px_rgba(0,240,255,0.2)] whitespace-nowrap animate-fade-in">
            <span role="alert" class="text-xs font-bold text-text-primary">已有新版本，可立即更新</span>
            <button
                onclick={() => void updateSW(true)}
                class="bg-neon-blue text-black text-xs font-bold rounded-full min-h-[44px] px-4 flex items-center gap-1.5 cursor-pointer"
            >
                <RefreshCw size={14} aria-hidden="true" />
                立即更新
            </button>
            <button
                onclick={() => (needRefresh = false)}
                aria-label="稍後更新"
                class="min-w-[44px] min-h-[44px] flex items-center justify-center text-text-secondary hover:text-text-primary cursor-pointer"
            >
                <X size={18} aria-hidden="true" />
            </button>
        </div>
    {/if}

    <!-- Fullscreen enlarged-card overlay: a place's local-language name (and
         hotel address) for a driver / local staff, or a reservation
         confirmation code for a check-in counter. -->
    {#if enlargedCard}
        {@const data = enlargedCard}
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
            transition:fade={{ duration: 300 }}
            onoutrostart={e => e.currentTarget.classList.add("pointer-events-none")}
            onclick={() => (enlargedCard = null)}
            class="fixed inset-0 bg-black/95 z-[1000] flex items-center justify-center p-5"
        >
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <div
                bind:this={enlargedCardEl}
                role="dialog"
                aria-modal="true"
                aria-label="放大顯示：{data.title}"
                tabindex="-1"
                onclick={(e => e.stopPropagation())}
                class="bg-[#121422] border border-white/8 rounded-3xl w-full max-w-[400px] p-6 shadow-2xl overscroll-contain"
            >
                <div class="flex justify-between items-center mb-6">
                    <h3 class="text-sm text-text-secondary">
                        {data.kind === "confirmation" ? "出示給櫃台人員看（點碼可複製）" : "出示給司機 / 店員看（點字可複製）"}
                    </h3>
                    <button
                        onclick={() => (enlargedCard = null)}
                        aria-label="關閉"
                        class="min-w-[44px] min-h-[44px] -my-2.5 -mr-2.5 flex items-center justify-center text-text-secondary hover:text-text-primary cursor-pointer"
                    >
                        <X size={24} aria-hidden="true" />
                    </button>
                </div>

                <div class="text-center break-words px-2">
                    <p class="text-sm text-text-secondary mb-3">{data.title}</p>
                    {#if data.kind === "confirmation"}
                        <button
                            type="button"
                            onclick={() => handleCopy(data.code, "已複製確認碼")}
                            class="text-neon-blue text-4xl font-black leading-normal tracking-widest block w-full break-all cursor-pointer transition active:scale-[0.98] drop-shadow-[0_0_8px_rgba(0,240,255,0.3)]"
                            title="點一下複製"
                        >
                            {data.code}
                        </button>
                        {#if data.name}
                            <p class="text-white text-2xl font-black leading-normal break-words mt-3">{data.name}</p>
                        {/if}
                        {#if data.note}
                            <p class="text-xs text-text-secondary leading-relaxed mt-3">{data.note}</p>
                        {/if}
                    {:else}
                        <button
                            type="button"
                            onclick={() => handleCopy(data.localName, "已複製名稱")}
                            class="text-white text-2xl font-black leading-normal block w-full break-words cursor-pointer transition active:scale-[0.98]"
                            title="點一下複製"
                        >
                            {data.localName}
                        </button>
                        {#if data.address}
                            <button
                                type="button"
                                onclick={() => handleCopy(data.address ?? "", "已複製地址")}
                                class="text-neon-blue text-3xl font-black leading-normal block w-full break-words mt-3 cursor-pointer transition active:scale-[0.98] drop-shadow-[0_0_8px_rgba(0,240,255,0.3)]"
                                title="點一下複製"
                            >
                                {data.address}
                            </button>
                        {/if}
                    {/if}
                </div>
            </div>
        </div>
    {/if}

    <!-- Settings Overlay Modal: persistent DOM toggled by opacity (an {#if}
         would drop the fade), so the closed state must be inert to stay out
         of the Tab order and the accessibility tree. -->
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
        onclick={attemptCloseSettings}
        inert={!showSettings}
        class="
            fixed inset-0 bg-black/95 z-[1000] flex items-center justify-center p-5 transition-opacity duration-300
            {showSettings ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}
        "
    >
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <div
            bind:this={settingsDialogEl}
            role="dialog"
            aria-modal="true"
            aria-label="自訂 YAML 行程設定"
            tabindex="-1"
            onclick={(e => e.stopPropagation())}
            class="
                bg-[#121422] border border-white/8 rounded-3xl w-full max-w-[420px] p-6 shadow-2xl transition-transform duration-300
                flex flex-col h-[min(100dvh-2.5rem,720px)] overscroll-contain
                {showSettings ? 'translate-y-0' : 'translate-y-5'}
            "
        >
            <div class="flex justify-between items-center mb-4 shrink-0">
                <h3 class="text-base font-bold text-text-primary flex items-center gap-1.5">
                    <Settings size={18} class="text-neon-blue" aria-hidden="true" />
                    自訂 YAML 行程設定
                </h3>
                <button
                    onclick={attemptCloseSettings}
                    aria-label="關閉設定"
                    class="text-text-secondary hover:text-text-primary text-2xl cursor-pointer"
                >
                    <X size={24} aria-hidden="true" />
                </button>
            </div>

            <div class="flex-1 min-h-0 flex flex-col gap-2.5 text-xs">
                <!-- YAML Editor Textarea -->
                <div class="flex-1 min-h-0 flex flex-col gap-1.5">
                    <div class="flex justify-between items-center">
                        <label for="yaml-editor" class="font-bold text-text-primary">行程資料 (YAML)</label>
                        <!-- 44px hot zones. Width grows in-flow (no -mx) so adjacent
                             zones can't overlap; -mb is capped at the 6px gap so the
                             zones stop at the textarea below (pt-1.5 re-centers text). -->
                        <div class="flex items-center gap-2.5">
                            <button
                                onclick={selectAllYaml}
                                class="text-[11px] min-w-[44px] min-h-[44px] -mt-3 -mb-1.5 pt-1.5 px-1 text-text-secondary hover:text-neon-blue flex items-center justify-center gap-0.5 cursor-pointer font-medium transition"
                            >
                                全選
                            </button>
                            <span class="text-[9px] text-white/10 select-none">|</span>
                            <button
                                onclick={clearYaml}
                                class="text-[11px] min-w-[44px] min-h-[44px] -mt-3 -mb-1.5 pt-1.5 px-1 text-text-secondary hover:text-neon-pink flex items-center justify-center gap-0.5 cursor-pointer font-medium transition"
                            >
                                清空
                            </button>
                            <span class="text-[9px] text-white/10 select-none">|</span>
                            <button
                                onclick={() => handleCopy(yamlInput, "已複製編輯器中的 YAML")}
                                class="text-[11px] min-w-[44px] min-h-[44px] -mt-3 -mb-1.5 pt-1.5 px-1 text-text-secondary hover:text-neon-blue flex items-center justify-center gap-1 cursor-pointer font-medium transition"
                            >
                                <Copy size={12} aria-hidden="true" /> 複製
                            </button>
                        </div>
                    </div>
                    <textarea
                        id="yaml-editor"
                        bind:value={yamlInput}
                        spellcheck="false"
                        autocapitalize="off"
                        placeholder="貼上你的 YAML 行程，或直接貼上分享連結…"
                        class="w-full flex-1 min-h-[160px] bg-black/40 border border-card-border rounded-xl p-3 text-[11px] text-text-primary font-mono outline-none focus:border-neon-blue resize-none overflow-y-auto overscroll-contain"
                    ></textarea>
                </div>

                <!-- Validation Error Message -->
                {#if validationError}
                    <div class="flex items-start gap-1.5 text-[10px] text-neon-pink bg-neon-pink/10 border border-neon-pink/20 p-2.5 rounded-lg font-mono">
                        <TriangleAlert size={12} class="shrink-0 mt-px" aria-hidden="true" />
                        <span>{validationError}</span>
                    </div>
                {/if}

                <div class="shrink-0 text-[10px] text-text-muted leading-normal bg-black/20 p-3 rounded-lg border border-white/2 space-y-1">
                    <p class="flex items-center gap-1">
                        <Lightbulb size={12} class="shrink-0 text-neon-blue" aria-hidden="true" />行程僅存於本機、不會上傳。
                    </p>
                    <ul class="list-disc pl-4 mt-1 space-y-1.5">
                        <li>貼上 YAML 行程內容，或他人的分享連結，按下方儲存即可。</li>
                        <li>清空並儲存會還原為預設的 <a href="./itinerary.yaml" target="_blank" rel="noopener noreferrer" class="text-neon-blue underline hover:text-white transition">itinerary.yaml</a>。</li>
                        <li>
                            可用此指令安裝行程小幫手 Skill：
                            <div class="bg-black/60 border border-white/5 rounded px-2 py-1 mt-1 font-mono text-[10px] select-all break-all text-text-primary">
                                npx skills add https://github.com/hsin19/show-me-way --skill itinerary-yaml-builder
                            </div>
                        </li>
                    </ul>
                </div>

                <!-- Auto-backup restore list: snapshots taken before each destructive overwrite -->
                <div class="shrink-0 text-[10px] text-text-muted leading-normal bg-black/20 p-3 rounded-lg border border-white/2">
                    <p class="flex items-center gap-1 font-bold text-text-primary text-xs">
                        <History size={12} class="shrink-0 text-neon-blue" aria-hidden="true" />還原備份
                    </p>
                    {#if yamlBackups.length === 0}
                        <p class="mt-1.5">尚無自動備份。覆蓋行程前會自動保留最近 5 份。</p>
                    {:else}
                        <ul class="mt-1.5 space-y-1.5 max-h-[140px] overflow-y-auto overscroll-contain">
                            {#each yamlBackups as backup (backup.savedAt)}
                                <li>
                                    <button
                                        onclick={() => restoreYamlBackup(backup.savedAt)}
                                        class="w-full min-h-[44px] flex items-center justify-between gap-2 px-3 rounded-lg bg-white/3 border border-card-border text-[11px] text-text-secondary hover:text-neon-blue hover:bg-white/5 transition cursor-pointer"
                                    >
                                        <span class="font-mono">{formatBackupTime(backup.savedAt)}</span>
                                        <span class="text-[10px] font-bold">還原</span>
                                    </button>
                                </li>
                            {/each}
                        </ul>
                    {/if}
                </div>

                <!-- File export: data leaves the device as files (backups above still live in the same localStorage) -->
                <div class="shrink-0 text-[10px] text-text-muted leading-normal bg-black/20 p-3 rounded-lg border border-white/2">
                    <p class="flex items-center gap-1 font-bold text-text-primary text-xs">
                        <Download size={12} class="shrink-0 text-neon-blue" aria-hidden="true" />匯出資料
                    </p>
                    <p class="mt-1.5">下載成檔案保存，避免裝置遺失或清除瀏覽器資料時一併消失。</p>
                    <div class="grid grid-cols-2 gap-2 mt-1.5">
                        <button
                            onclick={exportTripYaml}
                            class="min-h-[44px] flex items-center justify-center gap-1 px-3 rounded-lg bg-white/3 border border-card-border text-[11px] font-bold text-text-secondary hover:text-neon-blue hover:bg-white/5 transition cursor-pointer"
                        >
                            匯出行程 YAML
                        </button>
                        <button
                            onclick={exportLedgerCsv}
                            class="min-h-[44px] flex items-center justify-center gap-1 px-3 rounded-lg bg-white/3 border border-card-border text-[11px] font-bold text-text-secondary hover:text-neon-blue hover:bg-white/5 transition cursor-pointer"
                        >
                            匯出記帳 CSV
                        </button>
                    </div>
                </div>
            </div>

            <div class="grid grid-cols-2 gap-2 mt-3 shrink-0">
                <button
                    onclick={resetToLocalDefault}
                    class="bg-white/3 border border-card-border text-text-secondary font-bold py-3 px-4 rounded-xl text-xs hover:bg-white/5 transition cursor-pointer"
                >
                    回復預設行程
                </button>
                <button
                    onclick={saveSettings}
                    class="bg-gradient-to-r from-neon-blue to-neon-purple text-black font-bold py-3 px-4 rounded-xl text-xs transition active:scale-[0.98] cursor-pointer"
                >
                    儲存並解析
                </button>
            </div>
        </div>
    </div>
</div>
