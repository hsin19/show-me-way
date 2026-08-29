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
import {
    backupCurrentYaml,
    createChecklistItemId,
    createExpenseId,
    type DayItinerary,
    downloadTextFile,
    genTripId,
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
import { migrateGdriveSyncState } from "./lib/gdrive";
import { gdriveSync } from "./lib/gdrive.svelte";
import {
    buildLedgerCsv,
    parseLegacyExpenses,
} from "./lib/ledger";
import { getLanguageConfig } from "./lib/phrases";
import {
    createProfile,
    deleteProfile,
    ensureActiveProfileId,
    isActiveProfile,
    listProfiles,
    type ProfileInfo,
    switchToProfile,
    tripIdFromYaml,
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
import { importSharedTrip } from "./lib/share-import";
import {
    checkForSwUpdate,
    initServiceWorkerUpdates,
} from "./lib/sw-update";
import { buildDayReport } from "./lib/timeline";
import {
    shareOrCopyToClipboard,
    showToast,
} from "./lib/toast.svelte";
import {
    getTodayIsoString,
    insertAtClamped,
    toLocalIsoDate,
} from "./lib/utils";
import {
    type DailyWeather,
    type DailyWeatherByDate,
    loadDailyWeather,
    resolveTripCity,
    staleAgeHours,
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
        const city = resolveTripCity(day.city, data.trip.city);
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
    void gdriveSync.refreshFiles();
    if (tripData) {
        refreshTripWeather(tripData);
        // Resumed across midnight: ItineraryStrip repositions as a pure reaction
        // to currentDay changing.
        if (getTodayIsoString() !== lastSyncedDate) syncToToday(tripData);
    }
}

// Null past the 16-day forecast horizon, which hides the badge.
function weatherForDay(day: DayItinerary): DailyWeather | null {
    const city = resolveTripCity(day.city, tripData?.trip.city);
    if (!city) return null;
    return weatherByCity[city]?.byDate[day.date] ?? null;
}

// Open-Meteo data is CC BY 4.0 — show the attribution whenever any badge does.
let showWeatherAttribution = $derived(tripData?.days.some(d => weatherForDay(d)) ?? false);

// Derived from clockNow so the age advances on ticks and on resume.
let staleWeatherHours = $derived.by(() => {
    if (!tripData) return null;
    let oldest: number | null = null;
    for (const day of tripData.days) {
        const city = resolveTripCity(day.city, tripData.trip.city);
        if (!city) continue;
        const entry = weatherByCity[city];
        if (!entry || !entry.byDate[day.date]) continue;
        if (oldest === null || entry.fetchedAt < oldest) oldest = entry.fetchedAt;
    }
    return staleAgeHours(oldest, clockNow.getTime());
});

onMount(async () => {
    initServiceWorkerUpdates();
    initPwaInstallPrompt(() => openTools("prefs"));

    // Before the load, so an imported trip is what gets loaded.
    await maybeImportSharedItinerary();
    await loadTripData();
    // A head start on the switcher's cloud rows, so opening the drawer usually has the
    // list already rather than re-fetching on first open.
    void gdriveSync.refreshFiles();
});

// Never overwrites without asking: an unrecognised trip lands as a NEW profile with the
// current one parked, and a link carrying a trip this device already holds asks before
// replacing it. The hash is always stripped afterwards, including on decline or failure,
// so a refresh cannot re-prompt.
async function maybeImportSharedItinerary() {
    const token = readShareTokenFromHash();
    if (!token) return;
    try {
        // `onMount` reloads right after, and there is no live `tripData` to persist yet.
        const outcome = importSharedTrip(validateYaml(await decodeShareToken(token)));
        if (outcome.kind === "overwritten") showToast("已用分享連結更新行程，可在行程管理還原前一版");
        else if (outcome.kind === "imported") showToast("已匯入分享的行程");
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
    // Whatever draft belonged to the previous active trip outranks the persisted
    // YAML in the editor and would be saved over the trip loaded here — see
    // settings-draft.svelte.ts's invariant.
    settingsDraft.yaml = null;
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

        migrateGdriveSyncState();
        let migrated = migrateLegacyChecklistState(data);
        if (migrateLegacyLedger(data)) migrated = true;
        // A trip saved before ids existed has one minted on every load until it is
        // written back, and an identity that changes each launch is worse than none: a
        // Drive push would stamp the file with a value the next load no longer holds.
        // Only for a trip already in storage — writing the bundled template out would
        // silently adopt it as the user's own and stop it tracking the shipped one.
        const storedYaml = localStorage.getItem(USER_YAML_KEY);
        if (storedYaml !== null && tripIdFromYaml(storedYaml) !== data.trip.id) migrated = true;
        if (migrated) persistTripData();

        syncToToday(data);
    } catch (err) {
        console.error("Failed to load trip data:", err);
        loadError = "無法載入或解析行程資料。請開啟設定確認 YAML 語法。";
    } finally {
        isLoading = false;
    }
}

/** Returns whether the save actually landed, so a caller that must not proceed past a failed save (e.g. before parking this trip and swapping in another) can bail out instead of ignoring it. */
function persistTripData(): boolean {
    if (!tripData) return false;
    try {
        const yaml = serializeToYaml(tripData);
        saveTripData(tripData, yaml);
        // ensureActiveProfileId, not a `?? "default"` fallback: the id keys this trip's
        // sync state, and two trips sharing a literal would share one Drive file.
        const activeId = ensureActiveProfileId();
        // Debounced and opt-in-checked inside the sync state; this runs on every tap.
        gdriveSync.scheduleSync(yaml, activeId);
        return true;
    } catch (err) {
        console.error("Failed to persist trip data:", err);
        showToast("儲存失敗，請稍後再試");
        return false;
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

/**
 * Remove `id` from a `_id`-keyed list, persist, and offer an undo toast that
 * reinserts it — reading the list fresh via `getList` both times, since `tripData`
 * can go null or the list can change while the toast is up.
 */
function deleteWithUndo<T extends { _id?: string; }>(
    getList: () => T[] | null,
    setList: (next: T[]) => void,
    id: string,
    toastMessage: (removed: T) => string,
) {
    const list = getList();
    if (!list) return;
    const index = list.findIndex(i => i._id === id);
    if (index < 0) return;
    const removed = { ...list[index] };
    setList(list.filter(i => i._id !== id));
    persistTripData();
    // The undo toast can still be showing after the user switches to a different trip —
    // its closure keeps running regardless — so it must not splice `removed` into
    // whatever trip happens to be active by the time 復原 is tapped.
    const profileIdAtDelete = ensureActiveProfileId();
    showToast({
        message: toastMessage(removed),
        actionLabel: "復原",
        onAction: () => {
            if (!isActiveProfile(profileIdAtDelete)) {
                showToast("行程已切換，無法復原");
                return;
            }
            const current = getList();
            if (!current) return;
            // `index` may be stale — another item could have gone while the toast
            // was up — which is why the insert clamps.
            setList(insertAtClamped(current, index, removed));
            persistTripData();
        },
    });
}

function deleteChecklistItem(list: "todo" | "packing", id: string) {
    deleteWithUndo(
        () => tripData?.[list] ?? null,
        next => {
            if (tripData) tripData[list] = next;
        },
        id,
        removed => {
            // `text` is optional at the gate, and this toast is the only place that ever
            // reads it back.
            const text = removed.text ?? "";
            const label = text.length > 10 ? `${text.slice(0, 10)}…` : text;
            return `已刪除「${label}」`;
        },
    );
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
    deleteWithUndo(
        () => tripData?.expenses ?? null,
        next => {
            if (tripData) tripData.expenses = next;
        },
        id,
        () => "紀錄已刪除",
    );
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
    // The model re-authors the whole document, so an id it dropped or invented would be
    // minted fresh here and orphan this trip's Drive file. An AI edit is always an edit to
    // the trip on screen, so its identity is not the model's to change.
    if (tripData) parsed.trip.id = tripData.trip.id;
    // Snapshot before persistTripData overwrites it — the toast's 復原 needs the
    // pre-edit YAML, and the backup ring alone would leave undo buried in 行程管理.
    const previousYaml = localStorage.getItem(USER_YAML_KEY);
    // Same reasoning as deleteWithUndo: the undo toast can outlive a profile switch.
    const profileIdAtEdit = ensureActiveProfileId();
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
                if (!isActiveProfile(profileIdAtEdit)) {
                    showToast("行程已切換，無法復原");
                    return;
                }
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
        await shareOrCopyToClipboard({ url }, url, "分享連結已複製！網址較長，可用短網址服務縮短");
    } catch (err) {
        console.error("Failed to build share link:", err);
        showToast("無法產生分享連結，請稍後再試");
    }
}

/** 今日報平安: send one day's plain-text report to whoever is waiting at home. */
async function shareDayReport(dayData: DayItinerary) {
    if (!tripData) return;
    const text = buildDayReport(dayData, tripData.trip.hotels, tripData.trip.name);
    await shareOrCopyToClipboard({ text }, text, "已複製今日行程，可直接貼上分享");
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
        await shareOrCopyToClipboard({ url }, url, "已複製跨裝置連結（含記帳），在另一台裝置貼上即可");
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
    // persistTripData, not a raw saveTripData: a storage failure here must abort the
    // switch rather than park a trip whose latest edits never actually landed.
    if (!persistTripData()) return;
    try {
        createProfile(yaml);
    } catch (err) {
        console.error("Failed to create profile:", err);
        showToast("建立新行程失敗，請稍後再試");
        return;
    }
    await loadTripData();
    showToast("已建立新行程，請填入行程內容");
    // Straight to 行程管理: a template trip is useless until it is filled in.
    openTools("settings");
}

/**
 * 兩份都留 — the conflict resolution that discards nothing. The cloud copy has already
 * landed in this trip's slot, keeping its id and so its Drive binding; what was here
 * becomes a trip of its own.
 *
 * Re-identified and renamed because from here these are two trips: sharing an id would
 * have them fight over one Drive file, and sharing a name would make the switcher
 * unreadable. The caller has persisted the incoming copy already, which is what
 * `createProfile` parks in its place.
 */
async function branchLocalCopy(localYaml: string) {
    let forked: TripData;
    try {
        forked = validateYaml(localYaml);
    } catch (err) {
        console.error("Failed to branch the local copy:", err);
        showToast("保留本機版本失敗：內容無法解析");
        return;
    }
    forked.trip.id = genTripId();
    forked.trip.name = `${forked.trip.name}（本機版）`;
    try {
        createProfile(serializeToYaml(forked));
    } catch (err) {
        console.error("Failed to branch the local copy:", err);
        showToast("保留本機版本失敗，請稍後再試");
        return;
    }
    await loadTripData();
    showToast(`已保留兩份，這台裝置的版本另存為「${forked.trip.name}」`);
}

async function handleSwitchProfile(id: string) {
    if (!tripData) return;
    if (!persistTripData()) return;
    try {
        switchToProfile(id);
    } catch (err) {
        console.error("Failed to switch profile:", err);
        // switchToProfile's own message names the actual problem (e.g. an unknown
        // id); anything else — a DOMException from a full quota, say, which is not
        // even `instanceof Error` — falls back to a generic message instead of
        // misreporting itself as "trip not found".
        showToast(err instanceof Error ? err.message : "切換行程失敗，請稍後再試");
        profiles = listProfiles();
        return;
    }
    showToast("已切換行程");
    await loadTripData();
    // Switching is initiated from 工具, but what the user asked for is the trip.
    activeTab = "itinerary";
}

function handleDeleteProfile(id: string) {
    deleteProfile(id);
    gdriveSync.unbindTrip(id);
    profiles = listProfiles();
    showToast("已刪除行程");
}

async function handleLoadCloudTrip(fileId: string, fileName: string) {
    // persistTripData, not a raw saveTripData: this is the outgoing trip's last save
    // before it gets parked, and its answer has to be honoured — parking a trip whose
    // latest edits never reached storage loses them for good.
    const result = await gdriveSync.importCloudTripAsProfile(fileId, persistTripData);
    if (!result) return;
    if (!result.ok) {
        console.error("Cloud YAML validation failed:", result.error);
        showToast("此雲端行程格式有誤，請到行程管理修正");
        openTools("settings");
        return;
    }
    await loadTripData();
    showToast(`已從 Google Drive 載入「${fileName.replace(/\.ya?ml$/i, "")}」`);
    activeTab = "itinerary";
}

async function handleDeleteCloudTrip(fileId: string) {
    await gdriveSync.deleteTrip(fileId);
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
                        onBranchLocalCopy={branchLocalCopy}
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
                        onLoadCloudTrip={handleLoadCloudTrip}
                        onDeleteCloudTrip={handleDeleteCloudTrip}
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
