<script lang="ts">
import Calendar from "@lucide/svelte/icons/calendar";
import Car from "@lucide/svelte/icons/car";
import CheckSquare from "@lucide/svelte/icons/check-square";
import Compass from "@lucide/svelte/icons/compass";
import DollarSign from "@lucide/svelte/icons/dollar-sign";
import ListChecks from "@lucide/svelte/icons/list-checks";
import ListTodo from "@lucide/svelte/icons/list-todo";
import Loader2 from "@lucide/svelte/icons/loader-2";
import Luggage from "@lucide/svelte/icons/luggage";
import Sparkles from "@lucide/svelte/icons/sparkles";
import TriangleAlert from "@lucide/svelte/icons/triangle-alert";
import Wallet from "@lucide/svelte/icons/wallet";
import { onMount } from "svelte";
import { registerSW } from "virtual:pwa-register";
import {
    backupCurrentYaml,
    buildLedgerCsv,
    createChecklistItemId,
    createExpenseId,
    createProfile,
    type DayItinerary,
    deleteProfile,
    downloadTextFile,
    ensureActiveProfileId,
    fetchDefaultYamlText,
    fetchItinerary,
    listProfiles,
    type ProfileInfo,
    saveTripData,
    serializeToYaml,
    switchToProfile,
    type TripData,
    USER_YAML_KEY,
    validateYaml,
} from "./lib/api";
import ChatPanel from "./lib/components/ChatPanel.svelte";
import Checklist from "./lib/components/Checklist.svelte";
import EnlargedCardOverlay from "./lib/components/EnlargedCardOverlay.svelte";
import ItineraryStrip from "./lib/components/ItineraryStrip.svelte";
import Ledger from "./lib/components/Ledger.svelte";
import SettingsDialog from "./lib/components/SettingsDialog.svelte";
import TaxiHelper from "./lib/components/TaxiHelper.svelte";
import Toast from "./lib/components/Toast.svelte";
import UpdatePrompt from "./lib/components/UpdatePrompt.svelte";
import type { EnlargedCard } from "./lib/enlarge";
import { parseLegacyExpenses } from "./lib/ledger";
import { getLanguageConfig } from "./lib/phrases";
import {
    buildShareUrl,
    clearShareHash,
    decodeShareToken,
    isShareSupported,
    readShareTokenFromHash,
} from "./lib/share";
import {
    copyToClipboard,
    showToast,
} from "./lib/toast.svelte";
import {
    buildDayReport,
    getTodayIsoString,
    insertAtClamped,
    toLocalIsoDate,
} from "./lib/utils";
import {
    type DailyWeather,
    type DailyWeatherByDate,
    loadDailyWeather,
} from "./lib/weather";

// App State using Svelte 5 Runes
let tripData = $state<TripData | null>(null);
let currentDay = $state(1);
let activeTab = $state("itinerary"); // itinerary | todo | taxi | calc | ai
let isLoading = $state(true);
let loadError = $state<string | null>(null);

// Countdown clock: the interval only ticks `clockNow`; the label re-derives
// from it, so it also updates immediately when a new trip is saved (no manual
// sync). Named to stay distinct from the perf-time `now` locals in the scroll
// handlers — the two timebases must never mix.
let clockNow = $state(new Date());

$effect(() => {
    const timer = window.setInterval(() => (clockNow = new Date()), 60000);
    return () => clearInterval(timer);
});

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
        showToast("已可離線使用");
    },
    onRegisteredSW(_swUrl, registration) {
        if (!registration) return;
        swRegistration = registration;
        // register() itself just checked for updates; start the throttle now.
        lastSwUpdateCheck = Date.now();
        window.setInterval(checkForSwUpdate, SW_UPDATE_CHECK_MS);
    },
});

// Settings dialog open state (the editor/backup/export logic lives in
// SettingsDialog; App only owns whether it's shown).
let showSettings = $state(false);
// Parked (inactive) trip profiles; the active trip lives in USER_YAML_KEY.
let profiles = $state<ProfileInfo[]>([]);

// Enlarged card shown to a driver (local-language name / address) or to a
// counter clerk (reservation confirmation code). Lives at the app level so all
// panels share one overlay — opening it twice can never stack. `null` = closed.
// Focus management and screen wake-lock are owned by EnlargedCardOverlay;
// SettingsDialog handles its own Escape/focus.
let enlargedCard = $state<EnlargedCard | null>(null);

function handleWindowKeydown(e: KeyboardEvent) {
    if (e.key === "Escape" && enlargedCard) enlargedCard = null;
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
        // Cross-midnight resume: hop to the new today (ItineraryStrip repositions
        // to it as a pure reaction to currentDay changing).
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

onMount(async () => {
    // 0. If opened via a share link, offer to import it before loading.
    await maybeImportSharedItinerary();

    // 1. Fetch Trip Itinerary
    await loadTripData();
});

// If the URL hash carries a shared itinerary, decode it and ask before
// importing. With profiles the import is non-destructive: it lands as a NEW
// trip (the current one is parked, not overwritten). The hash is always
// stripped afterwards so a refresh won't re-prompt.
async function maybeImportSharedItinerary() {
    const token = readShareTokenFromHash();
    if (!token) return;
    try {
        const yaml = await decodeShareToken(token);
        const parsed = validateYaml(yaml); // throws on invalid structure/syntax
        const hasExisting = !!localStorage.getItem(USER_YAML_KEY);
        const message = hasExisting
            ? "偵測到分享的行程，要匯入為新行程嗎？（目前行程會保留，可隨時切回）"
            : "偵測到分享的行程，要匯入嗎？";
        if (confirm(message)) {
            // Park the current trip and switch to the imported one. Canonicalize
            // first (strip runtime ids, re-add schema line). loadTripData runs
            // right after in onMount, so the imported trip becomes active.
            createProfile(serializeToYaml(parsed));
            showToast("已匯入分享的行程");
        }
    } catch (err) {
        console.error("Failed to import shared itinerary:", err);
        showToast("分享連結內容無效，已略過");
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
        // Give the active trip a stable profile id (no-op once assigned), so
        // it can be parked when the user later switches to another trip.
        ensureActiveProfileId();
        profiles = listProfiles();
        loadTripWeather(data);

        // Fold any legacy localStorage state (checklist checked-state, ledger
        // expenses) into the itinerary, then write the unified data back so YAML
        // becomes the single source of truth.
        let migrated = migrateLegacyChecklistState(data);
        if (migrateLegacyLedger(data)) migrated = true;
        if (migrated) persistTripData();

        syncToToday(data);
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
        showToast("儲存失敗，請稍後再試");
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

// One-time migration: older versions kept expense records in a standalone
// `ledger_expenses` localStorage key. Fold them into the itinerary YAML (single
// source of truth, so they now travel with the trip profile) and drop the key.
// Only folds when the YAML has no expenses yet, so it can't double-import.
function migrateLegacyLedger(data: TripData): boolean {
    const saved = localStorage.getItem("ledger_expenses");
    if (saved === null) return false;
    try {
        const parsed: unknown = JSON.parse(saved);
        // Only fold when the YAML has no expenses yet, so it can't double-import.
        if (data.expenses.length === 0) {
            data.expenses.push(...parseLegacyExpenses(parsed, toLocalIsoDate(new Date()), createExpenseId));
        }
    } catch (e) {
        console.error("Failed to migrate legacy ledger:", e);
    }
    localStorage.removeItem("ledger_expenses");
    return true;
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
    showToast({
        message: `已刪除「${label}」`,
        actionLabel: "復原",
        onAction: () => {
            if (!tripData) return;
            // The list may have changed since the delete (e.g. another item
            // removed) — reinsert the snapshot at its original position,
            // clamped to the current length.
            tripData[list] = insertAtClamped(tripData[list], index, removed);
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

// --- Ledger expense handlers; records live in the itinerary YAML (TripData.expenses) ---
function addExpense(name: string, amount: number, type: string) {
    if (!tripData) return;
    // Newest first, matching the previous ledger ordering.
    tripData.expenses.unshift({
        _id: createExpenseId(),
        name,
        amount,
        type,
        // Local YYYY-MM-DD (project date convention) — sortable in CSV export.
        date: toLocalIsoDate(new Date()),
    });
    persistTripData();
}

function deleteExpense(id: string) {
    if (!tripData) return;
    const index = tripData.expenses.findIndex(e => e._id === id);
    if (index < 0) return;
    const removed = { ...tripData.expenses[index] };
    tripData.expenses = tripData.expenses.filter(e => e._id !== id);
    persistTripData();
    showToast({
        message: "紀錄已刪除",
        actionLabel: "復原",
        onAction: () => {
            if (!tripData) return;
            // Reinsert the snapshot at its original position, clamped to the
            // current length (the list may have changed meanwhile).
            tripData.expenses = insertAtClamped(tripData.expenses, index, removed);
            persistTripData();
        },
    });
}

function resetLedger() {
    if (!tripData) return;
    tripData.expenses = [];
    persistTripData();
}

// --- AI conversational edit: apply a full itinerary YAML proposed by the chat ---
// Validated again here (defense in depth — ChatPanel already validated before
// offering the apply button) and the pre-edit YAML is snapshotted into the
// backup ring so the change is undoable from Settings. Updates tripData in
// place rather than going through loadTripData, so the AI tab (and its
// in-memory conversation) is never unmounted mid-edit. Returns whether applied.
function applyAiEdit(yaml: string): boolean {
    let parsed: TripData;
    try {
        parsed = validateYaml(yaml);
    } catch (err) {
        console.error("Failed to apply AI edit:", err);
        showToast("AI 的修改內容無效，已略過");
        return false;
    }
    backupCurrentYaml(); // snapshot the pre-edit YAML before overwriting
    tripData = parsed;
    persistTripData();
    loadTripWeather(parsed);
    showToast("已套用 AI 修改的行程");
    return true;
}

// Generate a self-contained share link from the currently loaded trip and
// offer it through the native share sheet (clipboard fallback). Triggered from
// the overview panel, so feedback goes through toasts (no settings modal open).
async function shareCurrentTrip() {
    if (!tripData) return;
    if (!isShareSupported()) {
        showToast("此瀏覽器不支援連結壓縮，無法產生分享連結");
        return;
    }
    try {
        // Strip personal expense records from the shared link — they're for the
        // trip owner's own device / file backup only, not the people they share
        // the itinerary with. (File export below keeps them; that's a local backup.)
        const url = await buildShareUrl(serializeToYaml({ ...tripData, expenses: [] }));
        await shareOrCopy({ url }, url, "分享連結已複製！網址較長，可用短網址服務縮短");
    } catch (err) {
        console.error("Failed to build share link:", err);
        showToast("無法產生分享連結，請稍後再試");
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
        showToast("目前沒有可匯出的行程");
        return;
    }
    try {
        downloadTextFile(`show-me-way-行程-${exportDateStamp()}.yaml`, serializeToYaml(tripData), "application/yaml;charset=utf-8");
        showToast("已匯出行程 YAML");
    } catch (err) {
        console.error("Failed to export trip YAML:", err);
        showToast("匯出失敗，請稍後再試");
    }
}

// Export the WHOLE trip (including expenses) as a share link, for moving your
// own trip between your own devices — the inverse of `shareCurrentTrip`, which
// strips expenses for sharing with other people.
async function exportTripUrl() {
    if (!tripData) {
        showToast("目前沒有可匯出的行程");
        return;
    }
    if (!isShareSupported()) {
        showToast("此瀏覽器不支援連結壓縮，無法產生連結");
        return;
    }
    try {
        const url = await buildShareUrl(serializeToYaml(tripData));
        await shareOrCopy({ url }, url, "已複製跨裝置連結（含記帳），在另一台裝置貼上即可");
    } catch (err) {
        console.error("Failed to build transfer link:", err);
        showToast("無法產生連結，請稍後再試");
    }
}

function exportLedgerCsv() {
    try {
        const csv = buildLedgerCsv(tripData?.expenses ?? []);
        if (csv === null) {
            showToast("尚無記帳紀錄可匯出");
            return;
        }
        downloadTextFile(`show-me-way-記帳-${exportDateStamp()}.csv`, csv, "text/csv;charset=utf-8");
        showToast("已匯出記帳 CSV");
    } catch (err) {
        console.error("Failed to export ledger CSV:", err);
        showToast("匯出失敗，請稍後再試");
    }
}

// --- Trip profiles: swap the whole itinerary in/out (see lib/api) ---
// Triggered from the day-0 overview. Each flow persists the live trip into
// USER_YAML_KEY first so it is parked with its latest content, then reloads.

async function handleCreateProfile() {
    if (!tripData) return;
    let yaml: string;
    try {
        yaml = await fetchDefaultYamlText();
    } catch (err) {
        console.error("Failed to prepare new profile:", err);
        showToast("無法建立新行程，請稍後再試");
        return;
    }
    // Park the current trip, start the new one from the default template, then
    // open Settings so the user fills in its content (and renames it) right away.
    saveTripData(tripData);
    createProfile(yaml);
    await loadTripData();
    showToast("已建立新行程，請填入行程內容");
    showSettings = true;
}

async function handleSwitchProfile(id: string) {
    if (!tripData) return;
    saveTripData(tripData);
    try {
        switchToProfile(id);
    } catch (err) {
        console.error("Failed to switch profile:", err);
        showToast("找不到該行程");
        profiles = listProfiles();
        return;
    }
    showToast("已切換行程");
    await loadTripData();
}

function handleDeleteProfile(id: string, name: string) {
    if (!confirm(`要刪除行程「${name}」嗎？此動作無法復原。`)) return;
    deleteProfile(id);
    profiles = listProfiles();
    showToast("已刪除行程");
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
    copyToClipboard(copyText, copyMsg);
}
</script>

<svelte:window onkeydown={handleWindowKeydown} />
<svelte:document onvisibilitychange={handleVisibilityChange} />

<!-- Fixed-height app shell: the window itself never scrolls; the header and nav
     are flow children and the content area between them owns its own scroll
     (each itinerary day panel scrolls independently). standalone:h-screen — in
     the installed PWA, dvh is stale on cold start (phantom browser chrome, no
     correction event until the viewport is exercised) while 100vh is exact
     because standalone mode has no dynamic chrome; browser tabs keep h-dvh. -->
<div class="flex flex-col h-dvh standalone:h-screen overflow-hidden bg-bg-main text-text-primary animate-fade-in">
    <!-- Main content area: fills the shell; each branch
         owns its own scroll. The itinerary strip scrolls per-day internally; the
         other tabs scroll as a whole. -->
    <main class="flex-1 min-h-0 w-full">
        {#if isLoading}
            <div class="h-full flex flex-col items-center justify-center gap-3 pt-[var(--safe-top)]">
                <Loader2 class="animate-spin text-neon-blue" size={36} />
                <p class="text-text-secondary text-sm">正在載入行程資料…</p>
            </div>
        {:else if loadError}
            <div class="h-full overflow-y-auto">
                <div class="max-w-3xl mx-auto w-full p-5 pt-[calc(20px+var(--safe-top))]">
                    <div class="glass-panel rounded-2xl p-6 text-center border-neon-pink/35 shadow-[0_0_15px_rgba(255,42,116,0.1)]">
                        <TriangleAlert size={32} class="text-neon-pink mx-auto mb-3" aria-hidden="true" />
                        <p class="text-text-primary text-sm font-semibold mb-4">{loadError}</p>
                        <button
                            onclick={() => (showSettings = true)}
                            class="bg-gradient-to-r from-neon-blue to-neon-purple text-black font-bold py-2.5 px-6 rounded-xl text-xs transition active:scale-[0.98] cursor-pointer"
                        >
                            開啟設定並貼上 YAML
                        </button>
                    </div>
                </div>
            </div>
        {:else if tripData}
            {#if activeTab === "itinerary"}
                {#if tripData.days.length > 0}
                    <ItineraryStrip
                        trip={tripData.trip}
                        days={tripData.days}
                        bind:currentDay
                        {clockNow}
                        {profiles}
                        {showWeatherAttribution}
                        {staleWeatherHours}
                        weatherForDay={weatherForDay}
                        onEnlarge={card => (enlargedCard = card)}
                        onSetEventStatus={setEventStatus}
                        onShareDay={shareDayReport}
                        onSwitchProfile={handleSwitchProfile}
                        onCreateProfile={handleCreateProfile}
                        onDeleteProfile={handleDeleteProfile}
                        onShare={shareCurrentTrip}
                        onOpenSettings={() => (showSettings = true)}
                    />
                {/if}
            {:else if activeTab === "ai"}
                <ChatPanel {tripData} onApplyEdit={applyAiEdit} />
            {:else}
                <div class="h-full overflow-y-auto overscroll-contain">
                    <div class="max-w-3xl mx-auto w-full p-5 pt-[calc(20px+var(--safe-top))] animate-fade-in">
                        {#if activeTab === "todo"}
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
                                {clockNow}
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
                                expenses={tripData.expenses}
                                onAddWallet={addTripWallet}
                                onAddExpense={addExpense}
                                onDeleteExpense={deleteExpense}
                                onReset={resetLedger}
                            />
                        {/if}
                    </div>
                </div>
            {/if}
        {/if}
    </main>

    <!-- Bottom Tab Navigation: a flow child of the fixed-height shell (no longer
         position:fixed — the shell doesn't scroll). -->
    <nav class="shrink-0 h-[calc(64px+var(--safe-bottom))] bg-[#0d0e15]/88 backdrop-blur-2xl border-t border-white/5 z-[100]">
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
            <button
                onclick={() => (activeTab = "ai")}
                class="flex flex-col items-center justify-center flex-1 h-full text-text-muted transition-colors cursor-pointer {activeTab === 'ai' ? 'text-neon-blue' : ''}"
            >
                <Sparkles size={20} class={activeTab === "ai" ? "stroke-neon-blue filter drop-shadow-[0_0_4px_rgba(0,240,255,0.4)]" : ""} />
                <span class="text-[10px] font-semibold mt-1">AI</span>
            </button>
        </div>
    </nav>

    <!-- Global toast (reads the toast service directly), PWA update banner, and
         the fullscreen enlarged-card overlay — each self-contained. -->
    <Toast />

    <UpdatePrompt show={needRefresh} onUpdate={() => void updateSW(true)} onDismiss={() => (needRefresh = false)} />

    <EnlargedCardOverlay card={enlargedCard} onClose={() => (enlargedCard = null)} />

    <SettingsDialog
        bind:open={showSettings}
        onReload={loadTripData}
        onExportYaml={exportTripYaml}
        onExportUrl={exportTripUrl}
        onExportCsv={exportLedgerCsv}
    />
</div>
