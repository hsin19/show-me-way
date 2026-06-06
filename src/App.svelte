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
    X,
} from "@lucide/svelte";
import {
    onDestroy,
    onMount,
} from "svelte";
import {
    fetchItinerary,
    type TripData,
    validateYaml,
} from "./lib/api";
import Checklist from "./lib/components/Checklist.svelte";
import DaySwitcher from "./lib/components/DaySwitcher.svelte";
import Ledger from "./lib/components/Ledger.svelte";
import TaxiHelper from "./lib/components/TaxiHelper.svelte";
import Timeline from "./lib/components/Timeline.svelte";
import {
    formatDateRange,
    formatDayDate,
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

let timer: number;

onMount(async () => {
    // 1. Fetch Trip Itinerary
    await loadTripData();

    // 2. Start Countdown Timer
    updateCountdown();
    timer = window.setInterval(updateCountdown, 60000);
});

onDestroy(() => {
    if (timer) clearInterval(timer);
});

async function loadTripData() {
    isLoading = true;
    loadError = null;
    try {
        const data = await fetchItinerary();
        tripData = data;

        // Auto-jump to today's itinerary if trip is active
        if (data && data.days && data.days.length > 0) {
            const todayStr = getTodayIsoString();
            const matchingDay = data.days.find(d => d.date === todayStr);

            if (matchingDay) {
                currentDay = matchingDay.day;
                console.log(`[App] Automatically selected Day ${currentDay} matching today (${todayStr})`);
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

// Open Settings & Load current YAML text
async function openSettings() {
    showSettings = true;
    validationError = null;

    const customYaml = localStorage.getItem("showmeway_user_yaml");
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
}

// Save Settings & Validate YAML
async function saveSettings() {
    try {
        validateYaml(yamlInput);
        localStorage.setItem("showmeway_user_yaml", yamlInput);
        showSettings = false;
        validationError = null;
        triggerToast("自訂 YAML 行程儲存成功！");
        await loadTripData();
    } catch (err) {
        console.error("YAML Validation failed:", err);
        const errorMessage = err instanceof Error ? err.message : "YAML 格式錯誤，請檢查縮排！";
        validationError = errorMessage;
    }
}

// Reset to Local default
async function resetToLocalDefault() {
    if (confirm("要清除自訂 YAML，並恢復為專案預設的行程嗎？")) {
        localStorage.removeItem("showmeway_user_yaml");
        showSettings = false;
        validationError = null;
        triggerToast("已恢復為預設行程...");
        await loadTripData();
    }
}

// Travel Countdown Calculator
function updateCountdown() {
    if (!tripData) return;

    const departureDate = new Date(tripData.trip.departure);
    const startDate = parseLocalDate(tripData.trip.start);
    const endDate = new Date(tripData.trip.end + "T23:59:59");
    const now = new Date();

    // 1. If currently during the trip
    if (now >= startDate && now <= endDate) {
        countdownText = "✈️ 冒險進行中！";
        return;
    }

    // 2. If after the trip completed
    if (now > endDate) {
        countdownText = "🗺️ 旅程圓滿結束";
        return;
    }

    // 3. Otherwise, show countdown to flight
    const diff = departureDate.getTime() - now.getTime();
    if (diff <= 0) {
        countdownText = "✈️ 飛機已起飛！";
        return;
    }

    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));

    if (days > 0) {
        countdownText = `⏳ 倒數 ${days} 天 ${hours} 小時`;
    } else {
        const mins = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
        countdownText = `⏳ 即將出發 ${hours}時 ${mins}分`;
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

<svelte:window onscroll={handleWindowScroll} />

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
                        <Timeline
                            dayData={activeDayData}
                            hotels={tripData.trip.hotels}
                            onCopy={handleCopy}
                        />
                    {/if}
                {:else if activeTab === "todo"}
                    <div class="mb-4">
                        <h2 class="text-xl font-extrabold text-text-primary tracking-tight">📌 行前準備與打包</h2>
                        <p class="text-xs text-text-secondary mt-0.5">狀態將自動快取於手機</p>
                    </div>
                    <Checklist title="📋 待辦事項" storageKey="todo_state" defaultItems={tripData.todo} />
                    <Checklist title="🧳 隨身行李與打包" storageKey="packing_state" defaultItems={tripData.packing} />
                {:else if activeTab === "taxi"}
                    <div class="mb-4">
                        <h2 class="text-xl font-extrabold text-text-primary tracking-tight">🚕 乘車助手 & 實用常用語</h2>
                        <p class="text-xs text-text-secondary mt-0.5">出示給司機或快速複製使用</p>
                    </div>
                    <TaxiHelper hotels={tripData.trip.hotels} phrases={tripData.phrases} onCopy={handleCopy} />
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
    <div
        onclick={() => (showSettings = false)}
        class="
            fixed inset-0 bg-black/95 z-[1000] flex items-center justify-center p-5 transition-opacity duration-300
            {showSettings ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}
        "
    >
        <div
            onclick={(e => e.stopPropagation())}
            class="
                bg-[#121422] border border-white/8 rounded-3xl w-full max-w-[420px] p-6 shadow-2xl transition-transform duration-300
                {showSettings ? 'translate-y-0' : 'translate-y-5'}
            "
        >
            <div class="flex justify-between items-center mb-4">
                <h3 class="text-base font-bold text-text-primary flex items-center gap-1.5">
                    <Settings size={18} class="text-neon-blue" />
                    自訂 YAML 行程設定
                </h3>
                <button
                    onclick={() => (showSettings = false)}
                    class="text-text-secondary hover:text-text-primary text-2xl cursor-pointer"
                >
                    <X size={24} />
                </button>
            </div>

            <div class="space-y-4 text-xs">
                <p class="text-text-secondary leading-normal">
                    直接貼上你的 YAML 行程內容。行程僅會儲存在此裝置中（不會上傳至伺服器），隱私安全無虞。
                </p>

                <!-- YAML Editor Textarea -->
                <div class="flex flex-col gap-1.5">
                    <div class="flex justify-between items-center">
                        <label for="yaml-editor" class="font-bold text-text-primary">編輯行程資料 (YAML 格式)：</label>
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
                        placeholder="貼上你的 YAML 格式行程..."
                        class="w-full bg-black/40 border border-card-border rounded-xl p-3 text-[11px] text-text-primary font-mono outline-none focus:border-neon-blue h-[240px] resize-none overflow-y-auto"
                    ></textarea>
                </div>

                <!-- Validation Error Message -->
                {#if validationError}
                    <div class="text-[10px] text-neon-pink bg-neon-pink/10 border border-neon-pink/20 p-2.5 rounded-lg font-mono">
                        ❌ {validationError}
                    </div>
                {/if}

                <div class="text-[10px] text-text-muted leading-normal bg-black/20 p-3 rounded-lg border border-white/2">
                    💡 <strong>貼心提示：</strong><br>
                    1. 建議在 VS Code 中編輯好你的 <code>itinerary.yaml</code> 後，全選複製貼上到此處。<br>
                    2. 若清空並儲存，將會自動載入專案預設的 <a href="https://raw.githubusercontent.com/hsin19/show-me-way/refs/heads/main/public/itinerary.yaml" target="_blank" rel="noopener noreferrer" class="text-neon-blue underline hover:text-white transition">itinerary.yaml</a>。
                </div>
            </div>

            <div class="grid grid-cols-2 gap-2 mt-5">
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
