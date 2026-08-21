<script lang="ts">
import Calendar from "@lucide/svelte/icons/calendar";
import LayoutGrid from "@lucide/svelte/icons/layout-grid";
import ListChecks from "@lucide/svelte/icons/list-checks";
import ListTodo from "@lucide/svelte/icons/list-todo";
import Loader2 from "@lucide/svelte/icons/loader-2";
import Luggage from "@lucide/svelte/icons/luggage";
import MessageSquareText from "@lucide/svelte/icons/message-square-text";
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
    type DayItinerary,
    downloadTextFile,
    saveTripData,
    serializeToYaml,
    type TripData,
    USER_YAML_KEY,
    validateYaml,
} from "./lib/api";
import {
    fetchDefaultYamlText,
    fetchItinerary,
} from "./lib/api-fetch";
import AppSettings from "./lib/components/AppSettings.svelte";
import ChatPanel from "./lib/components/ChatPanel.svelte";
import Checklist from "./lib/components/Checklist.svelte";
import EnlargedCardOverlay from "./lib/components/EnlargedCardOverlay.svelte";
import ItineraryStrip from "./lib/components/ItineraryStrip.svelte";
import Ledger from "./lib/components/Ledger.svelte";
import PhraseDeck from "./lib/components/PhraseDeck.svelte";
import SettingsPanel from "./lib/components/SettingsPanel.svelte";
import Toast from "./lib/components/Toast.svelte";
import ToolsTab from "./lib/components/ToolsTab.svelte";
import type { EnlargedCard } from "./lib/enlarge";
import { parseLegacyExpenses } from "./lib/ledger";
import { getLanguageConfig } from "./lib/phrases";
import {
    createProfile,
    deleteProfile,
    ensureActiveProfileId,
    listProfiles,
    type ProfileInfo,
    switchToProfile,
} from "./lib/profiles";
import { initPwaInstallPrompt } from "./lib/pwa-install.svelte";
import { settingsDraft } from "./lib/settings-draft.svelte";
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

let tripData = $state<TripData | null>(null);
let currentDay = $state(1);
let activeTab = $state("itinerary"); // itinerary | tools | ai
let isLoading = $state(true);
let loadError = $state<string | null>(null);

// Wall-clock time, deliberately not named `now`: the scroll handlers keep
// perf-time locals under that name and the two timebases must never mix.
let clockNow = $state(new Date());

$effect(() => {
    const timer = window.setInterval(() => (clockNow = new Date()), 60000);
    return () => clearInterval(timer);
});

// registerType "prompt": the new service worker waits until the user accepts, so
// a page in use is never reloaded under them.
let swRegistration: ServiceWorkerRegistration | undefined;
// One timestamp shared with the visibilitychange path, or resuming the app would
// re-check something the interval just checked.
let lastSwUpdateCheck = 0;
const SW_UPDATE_CHECK_MS = 60 * 60 * 1000;

// A traveler keeps the app open for days, and without polling an update is only
// noticed on a fresh navigation. Phones throttle or freeze background intervals,
// hence the visibilitychange caller too. Offline — the flagship scenario —
// update() rejects; swallow it and retry on the next check.
function checkForSwUpdate() {
    if (!swRegistration || swRegistration.installing || !navigator.onLine) return;
    if (Date.now() - lastSwUpdateCheck < SW_UPDATE_CHECK_MS) return;
    lastSwUpdateCheck = Date.now();
    swRegistration.update().catch(() => {});
}

const updateSW = registerSW({
    onNeedRefresh() {
        showToast({
            message: "已有新版本",
            actionLabel: "立即更新",
            onAction: () => void updateSW(true),
            kind: "update",
            persist: true,
            // Fires once per newly waiting worker, so two deploys in one long
            // session would otherwise stack two immortal notices.
            dedupeKey: "sw-update",
        });
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

// App owns the 工具 sub-page so the overview's phase card and the load-error CTA
// can deep-link into one.
let toolsTab = $state<"prep" | "ledger" | "phrases" | "settings" | "prefs">("prep");

function openTools(tab: typeof toolsTab) {
    toolsTab = tab;
    activeTab = "tools";
}
// Parked profiles only — the active trip lives in USER_YAML_KEY.
let profiles = $state<ProfileInfo[]>([]);

// One overlay for the whole app, so opening a second enlarged card can never
// stack one on top of another. EnlargedCardOverlay owns focus and the wake lock;
// only the Escape key is handled here.
let enlargedCard = $state<EnlargedCard | null>(null);

function handleWindowKeydown(e: KeyboardEvent) {
    if (e.key === "Escape" && enlargedCard) enlargedCard = null;
}

$effect(() => {
    document.title = tripData?.trip.name ?? "下面一way";
});

let langConfig = $derived(getLanguageConfig(tripData?.trip.lang));

let prepDone = $derived(tripData ? [...tripData.todo, ...tripData.packing].filter(i => i.checked).length : 0);
let prepTotal = $derived(tripData ? tripData.todo.length + tripData.packing.length : 0);

// Keyed by the exact city string out of the YAML, spelling and all.
let weatherByCity = $state<Record<string, { byDate: DailyWeatherByDate; fetchedAt: number; }>>({});

// day.city → trip.city → none. Blank, whitespace and non-string values (from a
// hand-written YAML) all count as unset and fall through.
function resolveWeatherCity(day: DayItinerary, trip = tripData?.trip): string | null {
    for (const city of [day.city, trip?.city]) {
        if (typeof city === "string" && city.trim()) return city;
    }
    return null;
}

// For a different trip, where the previous trip's cities are no longer relevant.
function loadTripWeather(data: TripData) {
    weatherByCity = {};
    refreshTripWeather(data);
}

// Keeps what is already on screen. Cache-first (3h TTL in lib/weather.ts), so
// calling it repeatedly costs nothing until the data is actually stale.
function refreshTripWeather(data: TripData) {
    const cities: string[] = [];
    for (const day of data.days) {
        const city = resolveWeatherCity(day, data.trip);
        if (city && !cities.includes(city)) cities.push(city);
    }
    for (const city of cities) {
        // Merged, not replaced: a refresh starts at the city's local today, and
        // past days on screen must keep the badges from the previous payload.
        loadDailyWeather(city, (byDate, fetchedAt) => {
            weatherByCity[city] = {
                byDate: { ...weatherByCity[city]?.byDate, ...byDate },
                fetchedAt,
            };
        });
    }
}

// During a trip the app sits in the switcher for days and onMount never re-fires,
// so resuming is the only chance to catch up on everything below.
function handleVisibilityChange() {
    if (document.visibilityState !== "visible") return;
    // Background interval ticks are throttled or frozen, so the clock is behind.
    clockNow = new Date();
    checkForSwUpdate();
    if (tripData) {
        refreshTripWeather(tripData);
        // Resumed across midnight: ItineraryStrip repositions as a pure reaction
        // to currentDay changing.
        if (getTodayIsoString() !== lastSyncedDate) syncToToday(tripData);
    }
}

// Null past the 16-day forecast horizon, which hides the badge.
function weatherForDay(day: DayItinerary): DailyWeather | null {
    const city = resolveWeatherCity(day);
    if (!city) return null;
    return weatherByCity[city]?.byDate[day.date] ?? null;
}

// Open-Meteo data is CC BY 4.0 — show the attribution whenever any badge does.
let showWeatherAttribution = $derived(tripData?.days.some(d => weatherForDay(d)) ?? false);

// Must stay above weather.ts's 3h refresh TTL, or a routine refresh gets flagged
// as stale. Derived from clockNow so the age advances on ticks and on resume.
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
    initPwaInstallPrompt(() => openTools("prefs"));

    // Before the load, so an imported trip is what gets loaded.
    await maybeImportSharedItinerary();
    await loadTripData();
});

// Non-destructive: the shared trip lands as a NEW profile and the current one is
// parked, not overwritten. The hash is always stripped afterwards, including on
// decline or failure, so a refresh cannot re-prompt.
async function maybeImportSharedItinerary() {
    const token = readShareTokenFromHash();
    if (!token) return;
    try {
        const yaml = await decodeShareToken(token);
        const parsed = validateYaml(yaml);
        const hasExisting = !!localStorage.getItem(USER_YAML_KEY);
        const message = "偵測到分享的行程，要匯入為新行程嗎？（目前行程會保留，可隨時切回）";
        if (!hasExisting || confirm(message)) {
            // Re-serialized rather than stored raw, so a hand-edited share link
            // is canonicalized (runtime ids out, schema modeline back in).
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

// Guards the user's manual day browsing: only an actual date rollover re-syncs,
// never a resume on the same day.
let lastSyncedDate = "";

function syncToToday(data: TripData) {
    if (!data.days || data.days.length === 0) return;
    const todayStr = getTodayIsoString();
    lastSyncedDate = todayStr;
    const matchingDay = data.days.find(d => d.date === todayStr);

    // Day 0 outside the trip dates: the overview is where the countdown and the
    // wrap-up label live.
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

function persistTripData() {
    if (!tripData) return;
    try {
        saveTripData(tripData);
    } catch (err) {
        console.error("Failed to persist trip data:", err);
        showToast("儲存失敗，請稍後再試");
    }
}

// Older versions kept checked-state in its own localStorage keys. Runs once —
// the keys are removed on the way out — and reports whether a save is owed.
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
                // The old state was keyed by a persisted `id` that the schema no
                // longer has, so it is read off the raw parsed item.
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

// Older versions kept expense records in their own localStorage key; in the YAML
// they travel with the trip profile instead. Runs once — the key is removed on
// the way out — and reports whether a save is owed.
function migrateLegacyLedger(data: TripData): boolean {
    const saved = localStorage.getItem("ledger_expenses");
    if (saved === null) return false;
    try {
        const parsed: unknown = JSON.parse(saved);
        // Guards against double-importing into a trip that already has records.
        if (data.expenses.length === 0) {
            data.expenses.push(...parseLegacyExpenses(parsed, toLocalIsoDate(new Date()), createExpenseId));
        }
    } catch (e) {
        console.error("Failed to migrate legacy ledger:", e);
    }
    localStorage.removeItem("ledger_expenses");
    return true;
}

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
    // `text` is optional at the gate, and this toast is the only place that ever
    // reads it back.
    const text = removed.text ?? "";
    const label = text.length > 10 ? `${text.slice(0, 10)}…` : text;
    showToast({
        message: `已刪除「${label}」`,
        actionLabel: "復原",
        onAction: () => {
            if (!tripData) return;
            // `index` may be stale — another item could have gone while the toast
            // was up — which is why the insert clamps.
            tripData[list] = insertAtClamped(tripData[list], index, removed);
            persistTripData();
        },
    });
}

/** `undefined` clears the check-in mark. */
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

function addExpense(name: string, amount: number, type: string, date?: string) {
    if (!tripData) return;
    // Newest first — the ledger has always listed them that way.
    tripData.expenses.unshift({
        _id: createExpenseId(),
        name,
        amount,
        type,
        // Caller-picked day for backfilled records; otherwise the local date,
        // per the project convention, and sortable in the CSV export.
        date: date || toLocalIsoDate(new Date()),
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

/**
 * Replace the whole trip with a YAML the AI chat proposed and the user accepted;
 * false if it was rejected. Revalidates even though ChatPanel already did, and
 * backs the old YAML up first — this is the only undo for an AI edit.
 */
function applyAiEdit(yaml: string): boolean {
    let parsed: TripData;
    try {
        parsed = validateYaml(yaml);
    } catch (err) {
        console.error("Failed to apply AI edit:", err);
        showToast("AI 的修改內容無效，已略過");
        return false;
    }
    // Snapshot before persistTripData overwrites it — the toast's 復原 needs the
    // pre-edit YAML, and the backup ring alone would leave undo buried in 行程管理.
    const previousYaml = localStorage.getItem(USER_YAML_KEY);
    backupCurrentYaml();
    // Assigned in place rather than via loadTripData, which would unmount the AI
    // tab and take its in-memory conversation with it.
    tripData = parsed;
    persistTripData();
    loadTripWeather(parsed);
    if (previousYaml) {
        showToast({
            message: "已套用 AI 修改的行程",
            actionLabel: "復原",
            onAction: () => {
                let restored: TripData;
                try {
                    restored = validateYaml(previousYaml);
                } catch (err) {
                    console.error("Failed to undo AI edit:", err);
                    showToast("復原失敗，可到行程管理還原備份");
                    return;
                }
                // Backs up again so the AI version itself stays recoverable.
                backupCurrentYaml();
                tripData = restored;
                persistTripData();
                loadTripWeather(restored);
                showToast("已復原為套用前的行程");
            },
        });
    } else {
        showToast("已套用 AI 修改的行程");
    }
    return true;
}

/** 分享行程: hand someone else a link to this trip. */
async function shareCurrentTrip() {
    if (!tripData) return;
    if (!isShareSupported()) {
        showToast("此瀏覽器不支援連結壓縮，無法產生分享連結");
        return;
    }
    try {
        // Expenses stripped: what the owner spent is not part of an itinerary
        // shared with other people. `exportTripUrl` deliberately keeps them.
        const url = await buildShareUrl(serializeToYaml({ ...tripData, expenses: [] }));
        await shareOrCopy({ url }, url, "分享連結已複製！網址較長，可用短網址服務縮短");
    } catch (err) {
        console.error("Failed to build share link:", err);
        showToast("無法產生分享連結，請稍後再試");
    }
}

/** 今日報平安: send one day's plain-text report to whoever is waiting at home. */
async function shareDayReport(dayData: DayItinerary) {
    if (!tripData) return;
    const text = buildDayReport(dayData, tripData.trip.hotels, tripData.trip.name);
    await shareOrCopy({ text }, text, "已複製今日行程，可直接貼上分享");
}

// The file exports below are the escape hatch from localStorage being a single
// point of loss: they get the trip and the ledger off this device.
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

/** 含記帳: move your own trip to your own other device, expenses and all. */
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

// Every profile flow below saves the live trip before swapping, or the outgoing
// trip is parked without whatever the user just changed.
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
    saveTripData(tripData);
    createProfile(yaml);
    // A leftover draft belongs to the previous trip and outranks the persisted
    // YAML in the editor, so it would be saved over the new one.
    settingsDraft.yaml = null;
    await loadTripData();
    showToast("已建立新行程，請填入行程內容");
    // Straight to 行程管理: a template trip is useless until it is filled in.
    openTools("settings");
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
    // Same hazard as in handleCreateProfile: the draft belongs to the old trip.
    settingsDraft.yaml = null;
    showToast("已切換行程");
    await loadTripData();
    // Switching is initiated from 工具, but what the user asked for is the trip.
    activeTab = "itinerary";
}

function handleDeleteProfile(id: string) {
    deleteProfile(id);
    profiles = listProfiles();
    showToast("已刪除行程");
}

/** What every 分享 action goes through, so they all behave the same way. */
async function shareOrCopy(data: { url?: string; text?: string; title?: string; }, copyText: string, copyMsg: string) {
    if (typeof navigator.share === "function") {
        try {
            await navigator.share(data);
            return;
        } catch (err) {
            // Closing the sheet is a decision, not a failure — stay silent. Only
            // a real error (busy sheet, permission) falls through to the copy.
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
    <!-- Every branch below owns its own scrolling: the itinerary strip scrolls
         per day, the other tabs scroll as a whole. -->
    <main class="flex-1 min-h-0 w-full">
        {#if isLoading}
            <div class="h-full flex flex-col items-center justify-center gap-3 pt-[var(--safe-top)]">
                <Loader2 class="animate-spin text-accent" size={36} />
                <p class="text-text-secondary text-sm">正在載入行程資料…</p>
            </div>
        {:else if activeTab === "tools"}
            <!-- 工具 tab renders even on a YAML load error so 行程管理 stays
                 reachable to fix the data; trip-dependent pages hide instead. -->
            <ToolsTab bind:tab={toolsTab} hasTrip={!!tripData} hasPhrases={langConfig.phrases.length > 0}>
                {#snippet prep()}
                    {#if tripData}
                        <div class="mb-4">
                            <h2 class="text-xl font-extrabold text-text-primary tracking-tight flex items-center gap-2">
                                <ListChecks size={22} class="text-accent" aria-hidden="true" />行前準備與打包
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
                    {/if}
                {/snippet}
                {#snippet ledger()}
                    {#if tripData}
                        <div class="mb-4">
                            <h2 class="text-xl font-extrabold text-text-primary tracking-tight flex items-center gap-2">
                                <Wallet size={22} class="text-accent" aria-hidden="true" />匯率與消費記帳
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
                            onExportCsv={exportLedgerCsv}
                        />
                    {/if}
                {/snippet}
                {#snippet phrases()}
                    <div class="mb-4">
                        <h2 class="text-xl font-extrabold text-text-primary tracking-tight flex items-center gap-2">
                            <MessageSquareText size={22} class="text-accent" aria-hidden="true" />實用常用語
                        </h2>
                        <p class="text-xs text-text-secondary mt-0.5">點字卡即可複製，出示給店員或司機看</p>
                    </div>
                    <PhraseDeck phrases={langConfig.phrases} />
                {/snippet}
                {#snippet settings()}
                    <SettingsPanel
                        activeTripName={tripData?.trip.name ?? null}
                        {profiles}
                        onReload={loadTripData}
                        onDone={() => (activeTab = "itinerary")}
                        onSwitchProfile={handleSwitchProfile}
                        onCreateProfile={handleCreateProfile}
                        onDeleteProfile={handleDeleteProfile}
                        onExportYaml={exportTripYaml}
                        onExportUrl={exportTripUrl}
                    />
                {/snippet}
                {#snippet prefs()}
                    <AppSettings />
                {/snippet}
            </ToolsTab>
        {:else if loadError}
            <div class="h-full overflow-y-auto">
                <div class="max-w-3xl mx-auto w-full p-5 pt-[calc(20px+var(--safe-top))]">
                    <div class="panel rounded-2xl p-6 text-center border border-danger/30">
                        <TriangleAlert size={32} class="text-danger mx-auto mb-3" aria-hidden="true" />
                        <p class="text-text-primary text-sm font-semibold mb-4">{loadError}</p>
                        <button
                            onclick={() => openTools("settings")}
                            class="bg-accent text-accent-contrast font-bold py-2.5 px-6 rounded-xl text-xs transition active:scale-[0.98] cursor-pointer"
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
                        {prepDone}
                        {prepTotal}
                        expenses={tripData.expenses}
                        {profiles}
                        {showWeatherAttribution}
                        {staleWeatherHours}
                        weatherForDay={weatherForDay}
                        onSwitchProfile={handleSwitchProfile}
                        onCreateProfile={handleCreateProfile}
                        onDeleteProfile={handleDeleteProfile}
                        onEnlarge={card => (enlargedCard = card)}
                        onSetEventStatus={setEventStatus}
                        onShareDay={shareDayReport}
                        onOpenPrepare={() => openTools("prep")}
                        onOpenLedger={() => openTools("ledger")}
                        onShare={shareCurrentTrip}
                    />
                {/if}
            {:else if activeTab === "ai"}
                <ChatPanel
                    {tripData}
                    onApplyEdit={applyAiEdit}
                    onOpenAppSettings={() => openTools("prefs")}
                />
            {/if}
        {/if}
    </main>

    <!-- A flow child, not position:fixed: the shell above never scrolls. -->
    <nav class="shrink-0 h-[calc(64px+var(--safe-bottom))] bg-bg-main/90 backdrop-blur-2xl border-t border-line z-[100]">
        <div class="max-w-3xl mx-auto w-full h-full flex justify-around items-center pb-[var(--safe-bottom)]">
            <button
                onclick={() => (activeTab = "itinerary")}
                class="flex flex-col items-center justify-center flex-1 h-full transition-colors cursor-pointer {activeTab === 'itinerary' ? 'text-accent' : 'text-text-muted'}"
            >
                <Calendar size={20} />
                <span class="text-[10px] font-semibold mt-1">行程</span>
            </button>
            <button
                onclick={() => (activeTab = "tools")}
                class="flex flex-col items-center justify-center flex-1 h-full transition-colors cursor-pointer {activeTab === 'tools' ? 'text-accent' : 'text-text-muted'}"
            >
                <LayoutGrid size={20} />
                <span class="text-[10px] font-semibold mt-1">工具</span>
            </button>
            <button
                onclick={() => (activeTab = "ai")}
                class="flex flex-col items-center justify-center flex-1 h-full transition-colors cursor-pointer {activeTab === 'ai' ? 'text-accent' : 'text-text-muted'}"
            >
                <Sparkles size={20} />
                <span class="text-[10px] font-semibold mt-1">AI</span>
            </button>
        </div>
    </nav>

    <!-- Reads the toast service directly, so it takes no props. -->
    <Toast />

    <EnlargedCardOverlay card={enlargedCard} onClose={() => (enlargedCard = null)} />
</div>
