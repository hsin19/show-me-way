<script lang="ts">
import {
    Calendar,
    CheckCircle,
    CheckSquare,
    Compass,
    Copy,
    DollarSign,
    Loader2,
    Settings,
    Share2,
    X,
} from "@lucide/svelte";
import {
    onDestroy,
    onMount,
} from "svelte";
import {
    createChecklistItemId,
    fetchItinerary,
    saveTripData,
    serializeToYaml,
    type TripData,
    USER_YAML_KEY,
    validateYaml,
} from "./lib/api";
import Checklist from "./lib/components/Checklist.svelte";
import DaySwitcher from "./lib/components/DaySwitcher.svelte";
import Ledger from "./lib/components/Ledger.svelte";
import TaxiHelper from "./lib/components/TaxiHelper.svelte";
import Timeline from "./lib/components/Timeline.svelte";
import { getLanguageConfig } from "./lib/phrases";
import {
    buildShareUrl,
    clearShareHash,
    decodeShareToken,
    isShareSupported,
    parseShareToken,
    readShareTokenFromHash,
} from "./lib/share";
import {
    formatDateRange,
    formatDayDate,
    getCountdownText,
    getTodayIsoString,
    parseLocalDate,
} from "./lib/utils";

// App State using Svelte 5 Runes
let tripData = $state<TripData | null>(null);
let currentDay = $state(1);
let activeTab = $state("itinerary"); // itinerary | todo | taxi | calc
let countdownText = $state("計算中...");
let isLoading = $state(true);
let loadError = $state<string | null>(null);

// Toast Notification States
let toastMessage = $state("");
let isToastVisible = $state(false);

// Settings States
let showSettings = $state(false);
let yamlInput = $state("");
let validationError = $state<string | null>(null);

// Scroll & Header Collapse States
let isHeaderCollapsed = $state(false);
let lastScrollTop = 0;

function handleWindowKeydown(e: KeyboardEvent) {
    if (e.key === "Escape" && showSettings) {
        attemptCloseSettings();
    }
}

function handleWindowScroll() {
    const scrollTop = window.scrollY || document.documentElement.scrollTop;
    if (scrollTop > lastScrollTop && scrollTop > 30) {
        isHeaderCollapsed = true;
    } else if (scrollTop < lastScrollTop) {
        isHeaderCollapsed = false;
    }
    lastScrollTop = scrollTop;
}

$effect(() => {
    if (activeTab) {
        isHeaderCollapsed = false;
    }
});

// Derived values for current active day (with date formatted for display)
let activeDayData = $derived.by(() => {
    if (!tripData) return null;
    return tripData.days.find(d => d.day === currentDay) || tripData.days[0];
});

// Resolve the built-in phrase set and driver-card labels from `trip.lang`,
// falling back to English when unset/unsupported.
let langConfig = $derived(getLanguageConfig(tripData?.trip.lang));

// --- Swipe to switch day (mobile gesture) ---
let swipeStartX = 0;
let swipeStartY = 0;
let swipeTracking = false;

// Move to an adjacent day by offset (+1 next / -1 previous), clamped to range
function goToAdjacentDay(offset: number) {
    if (!tripData) return;
    const idx = tripData.days.findIndex(d => d.day === currentDay);
    if (idx === -1) return;
    const nextIdx = idx + offset;
    if (nextIdx >= 0 && nextIdx < tripData.days.length) {
        currentDay = tripData.days[nextIdx].day;
    }
}

function handleSwipeStart(e: PointerEvent) {
    if (activeTab !== "itinerary") return;
    swipeStartX = e.clientX;
    swipeStartY = e.clientY;
    swipeTracking = true;
}

function handleSwipeEnd(e: PointerEvent) {
    if (!swipeTracking) return;
    swipeTracking = false;
    const dx = e.clientX - swipeStartX;
    const dy = e.clientY - swipeStartY;
    // Require a mostly-horizontal gesture with enough travel to avoid clashing with vertical scroll
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) {
        goToAdjacentDay(dx < 0 ? 1 : -1);
    }
}

let timer: number;

onMount(async () => {
    // 0. If opened via a share link, offer to import it before loading.
    await maybeImportSharedItinerary();

    // 1. Fetch Trip Itinerary
    await loadTripData();

    // 2. Start Countdown Timer
    updateCountdown();
    timer = window.setInterval(updateCountdown, 60000);
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

onDestroy(() => {
    if (timer) clearInterval(timer);
});

async function loadTripData() {
    isLoading = true;
    loadError = null;
    try {
        const data = await fetchItinerary();
        tripData = data;

        // Fold any legacy per-list checked-state into the itinerary, then write
        // the unified data back so YAML becomes the single source of truth.
        if (migrateLegacyChecklistState(data)) {
            persistTripData();
        }

        // Auto-jump to today's itinerary if trip is active
        if (data && data.days && data.days.length > 0) {
            const todayStr = getTodayIsoString();
            const matchingDay = data.days.find(d => d.date === todayStr);

            if (matchingDay) {
                currentDay = matchingDay.day;
            } else {
                // Default to Day 1 if before start, or last Day if after end
                const today = new Date();
                const lastDayDate = parseLocalDate(data.days[data.days.length - 1].date);
                const lastDayEnd = new Date(lastDayDate.getTime() + 24 * 60 * 60 * 1000);

                if (today > lastDayEnd) {
                    currentDay = data.days[data.days.length - 1].day;
                } else {
                    currentDay = 1;
                }
            }
        }
    } catch (err) {
        console.error("Failed to load trip data:", err);
        loadError = "無法載入或解析行程資料。請點擊右上角設定確認 YAML 語法。";
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
    tripData[list] = tripData[list].filter(i => i._id !== id);
    persistTripData();
}

// Snapshot of the YAML when the editor was opened, used to detect unsaved edits
let yamlSnapshot = "";

// Open Settings & Load current YAML text
async function openSettings() {
    showSettings = true;
    validationError = null;

    const customYaml = localStorage.getItem(USER_YAML_KEY);
    if (customYaml) {
        yamlInput = customYaml;
    } else {
        // Load default template for editing
        try {
            let res = await fetch("./itinerary.local.yaml");
            if (!res.ok) {
                res = await fetch("./itinerary.yaml");
            }
            yamlInput = await res.text();
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

// Generate a self-contained share link from the current editor content and
// copy it to the clipboard. Validates first so we never share broken YAML.
async function generateShareLink() {
    if (!isShareSupported()) {
        validationError = "此瀏覽器不支援連結壓縮，無法產生分享連結。";
        return;
    }
    try {
        const parsed = validateYaml(yamlInput);
        const url = await buildShareUrl(serializeToYaml(parsed));
        validationError = null;
        handleCopy(url, "分享連結已複製！網址較長，可用短網址服務縮短");
    } catch (err) {
        console.error("Failed to build share link:", err);
        validationError = err instanceof Error
            ? `無法產生分享連結：${err.message}`
            : "無法產生分享連結，請檢查 YAML 內容。";
    }
}

// Reset to Local default
async function resetToLocalDefault() {
    if (confirm("要清除自訂 YAML，並恢復為專案預設的行程嗎？")) {
        localStorage.removeItem(USER_YAML_KEY);
        showSettings = false;
        validationError = null;
        triggerToast("已恢復為預設行程...");
        await loadTripData();
    }
}

// Travel Countdown Calculator
function updateCountdown() {
    if (!tripData) return;
    countdownText = getCountdownText(tripData.trip);
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

// Trigger Toast Notification
function triggerToast(msg: string) {
    toastMessage = msg;
    isToastVisible = true;
    setTimeout(() => {
        isToastVisible = false;
    }, 2500);
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

<svelte:window onscroll={handleWindowScroll} onkeydown={handleWindowKeydown} />

<div class="flex flex-col min-h-screen bg-[#0b0c13] text-text-primary pb-[calc(80px+var(--safe-bottom))] animate-fade-in">
    <!-- App Header -->
    <header class="sticky top-0 z-[100] bg-[#0d0e15]/85 backdrop-blur-xl border-b border-white/5 pt-[calc(15px+var(--safe-top))] px-5 transition-all duration-300 {isHeaderCollapsed ? 'pb-2' : 'pb-3'}">
        <div class="max-w-3xl mx-auto w-full">
            <div class="transition-all duration-300 ease-in-out overflow-hidden {isHeaderCollapsed ? 'max-h-0 opacity-0 mb-0 scale-95 pointer-events-none' : 'max-h-[80px] opacity-100 mb-3'}">
                <div class="flex justify-between items-center">
                    <div class="flex items-center gap-3">
                        <div>
                            <h1 class="text-lg font-black bg-gradient-to-r from-white to-[#cbd5e1] bg-clip-text text-transparent tracking-tight">
                                {tripData ? tripData.trip.name : "ShowMeWay"}
                            </h1>
                            <p class="text-[11px] text-text-secondary font-medium tracking-wide">
                                {tripData ? formatDateRange(tripData.trip.start, tripData.trip.end) : "旅行規劃小助手"}
                            </p>
                        </div>
                    </div>

                    <div class="flex items-center gap-2">
                        <div class="bg-neon-pink/12 border border-neon-pink/30 text-neon-pink text-[11px] font-bold px-3 py-1.5 rounded-full shadow-[0_0_15px_rgba(255,42,116,0.25)] text-shadow-[0_0_4px_rgba(255,42,116,0.3)]">
                            {countdownText}
                        </div>
                        <button
                            onclick={openSettings}
                            class="p-2 border border-card-border text-text-secondary rounded-xl hover:bg-white/5 hover:text-text-primary transition cursor-pointer"
                            title="開啟 YAML 設定"
                        >
                            <Settings size={16} />
                        </button>
                    </div>
                </div>
            </div>

            {#if tripData && activeTab === "itinerary"}
                <!-- Day Switcher component (Formats ISO dates to MM/DD(W) dynamically) -->
                <DaySwitcher days={tripData.days.map(d => ({ day: d.day, date: formatDayDate(d.date) }))} bind:currentDay />
            {/if}
        </div>
    </header>

    <!-- Main Content Area -->
    <main class="flex-1 p-5 max-w-3xl mx-auto w-full">
        {#if isLoading}
            <div class="flex flex-col items-center justify-center py-20 gap-3">
                <Loader2 class="animate-spin text-neon-blue" size={36} />
                <p class="text-text-secondary text-sm">正在載入行程資料...</p>
            </div>
        {:else if loadError}
            <div class="glass-panel rounded-2xl p-6 text-center border-neon-pink/35 shadow-[0_0_15px_rgba(255,42,116,0.1)]">
                <span class="text-3xl block mb-3">⚠️</span>
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
                    {#if activeDayData}
                        <!-- svelte-ignore a11y_no_static_element_interactions -->
                        <div
                            class="touch-pan-y"
                            onpointerdown={handleSwipeStart}
                            onpointerup={handleSwipeEnd}
                            onpointercancel={() => (swipeTracking = false)}
                        >
                            {#key currentDay}
                                <div class="animate-fade-in">
                                    <Timeline
                                        dayData={activeDayData}
                                        hotels={tripData.trip.hotels}
                                        onCopy={handleCopy}
                                    />
                                </div>
                            {/key}
                        </div>
                    {/if}
                {:else if activeTab === "todo"}
                    <div class="mb-4">
                        <h2 class="text-xl font-extrabold text-text-primary tracking-tight">📌 行前準備與打包</h2>
                        <p class="text-xs text-text-secondary mt-0.5">狀態將自動快取於手機</p>
                    </div>
                    <Checklist
                        title="📋 待辦事項"
                        items={tripData.todo}
                        onToggle={id => toggleChecklistItem("todo", id)}
                        onAdd={text => addChecklistItem("todo", text)}
                        onDelete={id => deleteChecklistItem("todo", id)}
                    />
                    <Checklist
                        title="🧳 隨身行李與打包"
                        items={tripData.packing}
                        onToggle={id => toggleChecklistItem("packing", id)}
                        onAdd={text => addChecklistItem("packing", text)}
                        onDelete={id => deleteChecklistItem("packing", id)}
                    />
                {:else if activeTab === "taxi"}
                    <div class="mb-4">
                        <h2 class="text-xl font-extrabold text-text-primary tracking-tight">🚕 乘車助手 & 實用常用語</h2>
                        <p class="text-xs text-text-secondary mt-0.5">出示給司機或快速複製使用</p>
                    </div>
                    <TaxiHelper
                        hotels={tripData.trip.hotels}
                        phrases={langConfig.phrases}
                        driverPrompt={langConfig.driverPrompt}
                        copyAddressLabel={langConfig.copyAddressLabel}
                        onCopy={handleCopy}
                    />
                {:else if activeTab === "calc"}
                    <div class="mb-4">
                        <h2 class="text-xl font-extrabold text-text-primary tracking-tight">💱 匯率與消費記帳</h2>
                        <p class="text-xs text-text-secondary mt-0.5">出國換算與儲值餘額管理</p>
                    </div>
                    <Ledger onToast={triggerToast} />
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

    <!-- Global Toast Notification -->
    <div
        class="
            fixed bottom-[85px] left-1/2 -translate-x-1/2 bg-neon-blue text-black font-bold text-xs py-2.5 px-5 rounded-full z-[2000] shadow-[0_4px_15px_rgba(0,240,255,0.3)] transition-all duration-300 flex items-center gap-1.5
            {isToastVisible ? 'opacity-100 translate-y-0 visible' : 'opacity-0 translate-y-5 invisible'}
        "
    >
        <CheckCircle size={14} class="stroke-[3]" />
        {toastMessage}
    </div>

    <!-- Settings Overlay Modal -->
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
        onclick={attemptCloseSettings}
        class="
            fixed inset-0 bg-black/95 z-[1000] flex items-center justify-center p-5 transition-opacity duration-300
            {showSettings ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}
        "
    >
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
            onclick={(e => e.stopPropagation())}
            class="
                bg-[#121422] border border-white/8 rounded-3xl w-full max-w-[420px] p-6 shadow-2xl transition-transform duration-300
                flex flex-col h-[min(100dvh-2.5rem,720px)]
                {showSettings ? 'translate-y-0' : 'translate-y-5'}
            "
        >
            <div class="flex justify-between items-center mb-4 shrink-0">
                <h3 class="text-base font-bold text-text-primary flex items-center gap-1.5">
                    <Settings size={18} class="text-neon-blue" />
                    自訂 YAML 行程設定
                </h3>
                <button
                    onclick={attemptCloseSettings}
                    class="text-text-secondary hover:text-text-primary text-2xl cursor-pointer"
                >
                    <X size={24} />
                </button>
            </div>

            <div class="flex-1 min-h-0 flex flex-col gap-2.5 text-xs">
                <!-- YAML Editor Textarea -->
                <div class="flex-1 min-h-0 flex flex-col gap-1.5">
                    <div class="flex justify-between items-center">
                        <label for="yaml-editor" class="font-bold text-text-primary">行程資料 (YAML)</label>
                        <div class="flex items-center gap-2.5">
                            <button
                                onclick={selectAllYaml}
                                class="text-[10px] text-text-secondary hover:text-neon-blue flex items-center gap-0.5 cursor-pointer font-medium transition"
                            >
                                全選
                            </button>
                            <span class="text-[9px] text-white/10 select-none">|</span>
                            <button
                                onclick={clearYaml}
                                class="text-[10px] text-text-secondary hover:text-neon-pink flex items-center gap-0.5 cursor-pointer font-medium transition"
                            >
                                清空
                            </button>
                            <span class="text-[9px] text-white/10 select-none">|</span>
                            <button
                                onclick={() => handleCopy(yamlInput, "已複製編輯器中的 YAML")}
                                class="text-[10px] text-text-secondary hover:text-neon-blue flex items-center gap-1 cursor-pointer font-medium transition"
                            >
                                <Copy size={10} /> 複製
                            </button>
                        </div>
                    </div>
                    <textarea
                        id="yaml-editor"
                        bind:value={yamlInput}
                        placeholder="貼上你的 YAML 行程，或直接貼上分享連結..."
                        class="w-full flex-1 min-h-[160px] bg-black/40 border border-card-border rounded-xl p-3 text-[11px] text-text-primary font-mono outline-none focus:border-neon-blue resize-none overflow-y-auto"
                    ></textarea>
                </div>

                <!-- Validation Error Message -->
                {#if validationError}
                    <div class="text-[10px] text-neon-pink bg-neon-pink/10 border border-neon-pink/20 p-2.5 rounded-lg font-mono">
                        ❌ {validationError}
                    </div>
                {/if}

                <div class="shrink-0 text-[10px] text-text-muted leading-normal bg-black/20 p-3 rounded-lg border border-white/2 space-y-1">
                    💡 行程僅存於本機、不會上傳。
                    <ul class="list-disc pl-4 mt-1 space-y-1.5">
                        <li>貼上 YAML 行程內容，或他人的分享連結，按下方儲存即可。</li>
                        <li>清空並儲存會還原為預設的 <a href="https://raw.githubusercontent.com/hsin19/show-me-way/refs/heads/main/public/itinerary.yaml" target="_blank" rel="noopener noreferrer" class="text-neon-blue underline hover:text-white transition">itinerary.yaml</a>。</li>
                        <li>
                            可用此指令安裝行程小幫手 Skill：
                            <div class="bg-black/60 border border-white/5 rounded px-2 py-1 mt-1 font-mono text-[9px] select-all break-all text-text-primary">
                                npx skills add https://github.com/hsin19/show-me-way --skill itinerary-yaml-builder
                            </div>
                        </li>
                    </ul>
                </div>
            </div>

            <button
                onclick={generateShareLink}
                class="shrink-0 w-full mt-3 bg-white/3 border border-neon-blue/30 text-neon-blue font-bold py-3 px-4 rounded-xl text-xs flex items-center justify-center gap-1.5 hover:bg-neon-blue/10 transition active:scale-[0.98] cursor-pointer"
            >
                <Share2 size={14} /> 產生並複製分享連結
            </button>

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
