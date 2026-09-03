<script lang="ts">
import { getTodayIsoString } from "$lib/domain/utils";
import {
    checkForSwUpdate,
    initServiceWorkerUpdates,
} from "$lib/infra/pwa/sw-update";
import { gdriveSync } from "$lib/stores/gdrive.svelte";
import { initPwaInstallPrompt } from "$lib/stores/pwa-install.svelte";
import { tripStore } from "$lib/stores/trip.svelte";
import { weatherStore } from "$lib/stores/weather.svelte";
import ChatPanel from "$lib/ui/ai/ChatPanel.svelte";
import EnlargedCardOverlay from "$lib/ui/itinerary/EnlargedCardOverlay.svelte";
import ItineraryStrip from "$lib/ui/itinerary/ItineraryStrip.svelte";
import type { EnlargedCard } from "$lib/ui/shared/enlarge";
import Toast from "$lib/ui/shared/Toast.svelte";
import Checklist from "$lib/ui/tools/Checklist.svelte";
import Ledger from "$lib/ui/tools/Ledger.svelte";
import PhraseDeck from "$lib/ui/tools/PhraseDeck.svelte";
import AppSettings from "$lib/ui/tools/settings/AppSettings.svelte";
import SettingsPanel from "$lib/ui/tools/settings/SettingsPanel.svelte";
import ToolsTab from "$lib/ui/tools/ToolsTab.svelte";
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

let currentDay = $state(1);
let activeTab = $state("itinerary"); // itinerary | tools | ai
let toolsTab = $state<"prep" | "ledger" | "phrases" | "settings" | "prefs">("prep");
let enlargedCard = $state<EnlargedCard | null>(null);

// Wall-clock time, deliberately not named `now`: the scroll handlers keep
// perf-time locals under that name and the two timebases must never mix.
let clockNow = $state(new Date());

$effect(() => {
    const timer = window.setInterval(() => (clockNow = new Date()), 60000);
    return () => clearInterval(timer);
});

function openTools(tab: typeof toolsTab) {
    toolsTab = tab;
    activeTab = "tools";
}

function handleWindowKeydown(e: KeyboardEvent) {
    if (e.key === "Escape" && enlargedCard) enlargedCard = null;
}

$effect(() => {
    document.title = tripStore.data?.trip.name ?? "下面一way";
});

let lastSyncedDate = "";

function syncToToday() {
    const data = tripStore.data;
    if (!data?.days || data.days.length === 0) return;
    const todayStr = getTodayIsoString();
    lastSyncedDate = todayStr;
    const matchingDay = data.days.find(d => d.date === todayStr);
    currentDay = matchingDay ? matchingDay.day : 0;
}

function handleVisibilityChange() {
    if (document.visibilityState !== "visible") return;
    clockNow = new Date();
    checkForSwUpdate();
    void gdriveSync.refreshFiles();
    if (tripStore.data) {
        weatherStore.refresh(tripStore.data.days, tripStore.data.trip.city);
        if (getTodayIsoString() !== lastSyncedDate) syncToToday();
    }
}

onMount(async () => {
    initServiceWorkerUpdates();
    initPwaInstallPrompt(() => openTools("prefs"));

    await tripStore.maybeImportSharedItinerary();
    await tripStore.load();
    if (tripStore.data) syncToToday();
    void gdriveSync.refreshFiles();
});

let showWeatherAttribution = $derived(
    tripStore.data ? weatherStore.hasAttribution(tripStore.data.days, tripStore.data.trip.city) : false,
);

let staleWeatherHours = $derived.by(() => {
    if (!tripStore.data) return null;
    return weatherStore.getStaleAgeHours(tripStore.data.days, tripStore.data.trip.city, clockNow.getTime());
});
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
        {#if tripStore.isLoading}
            <div class="h-full flex flex-col items-center justify-center gap-3 pt-[var(--safe-top)]">
                <Loader2 class="animate-spin text-accent" size={36} />
                <!-- A scanned QR spends its whole network wait on this line, so it
                     names what is actually happening rather than the generic load. -->
                <p class="text-text-secondary text-sm">
                    {tripStore.sharedLinkLoading ? "正在取得分享的行程…" : "正在載入行程資料…"}
                </p>
            </div>
        {:else if activeTab === "tools"}
            <!-- 工具 tab renders even on a YAML load error so 行程管理 stays
                 reachable to fix the data; trip-dependent pages hide instead. -->
            <ToolsTab bind:tab={toolsTab} hasTrip={!!tripStore.data} hasPhrases={tripStore.langConfig.phrases.length > 0}>
                {#snippet prep()}
                    {#if tripStore.data}
                        <div class="mb-4">
                            <h2 class="text-xl font-extrabold text-text-primary tracking-tight flex items-center gap-2">
                                <ListChecks size={22} class="text-accent" aria-hidden="true" />行前準備與打包
                            </h2>
                            <p class="text-xs text-text-secondary mt-0.5">狀態將自動快取於手機</p>
                        </div>
                        <Checklist
                            title="待辦事項"
                            icon={ListTodo}
                            items={tripStore.data.todo}
                            onToggle={id => tripStore.toggleChecklistItem("todo", id)}
                            onAdd={text => tripStore.addChecklistItem("todo", text)}
                            onDelete={id => tripStore.deleteChecklistItem("todo", id)}
                        />
                        <Checklist
                            title="隨身行李與打包"
                            icon={Luggage}
                            items={tripStore.data.packing}
                            onToggle={id => tripStore.toggleChecklistItem("packing", id)}
                            onAdd={text => tripStore.addChecklistItem("packing", text)}
                            onDelete={id => tripStore.deleteChecklistItem("packing", id)}
                        />
                    {/if}
                {/snippet}
                {#snippet ledger()}
                    {#if tripStore.data}
                        <div class="mb-4">
                            <h2 class="text-xl font-extrabold text-text-primary tracking-tight flex items-center gap-2">
                                <Wallet size={22} class="text-accent" aria-hidden="true" />匯率與消費記帳
                            </h2>
                            <p class="text-xs text-text-secondary mt-0.5">出國換算與儲值餘額管理</p>
                        </div>
                        <Ledger
                            currency={tripStore.data.trip.currency}
                            wallets={tripStore.data.trip.wallets}
                            expenses={tripStore.data.expenses}
                            onAddWallet={name => tripStore.addTripWallet(name)}
                            onAddExpense={(name, amount, type, date) => tripStore.addExpense(name, amount, type, date)}
                            onDeleteExpense={id => tripStore.deleteExpense(id)}
                            onReset={() => tripStore.resetLedger()}
                            onExportCsv={() => tripStore.exportLedgerCsv()}
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
                    <PhraseDeck phrases={tripStore.langConfig.phrases} />
                {/snippet}
                {#snippet settings()}
                    <SettingsPanel
                        activeTripName={tripStore.data?.trip.name ?? null}
                        profiles={tripStore.profiles}
                        onReload={() => tripStore.load()}
                        onDone={() => (activeTab = "itinerary")}
                        onSwitchProfile={id => tripStore.switchProfile(id, () => (activeTab = "itinerary"))}
                        onCreateProfile={() => tripStore.createProfile(() => openTools("settings"))}
                        onDeleteProfile={id => tripStore.deleteProfile(id)}
                        onBranchLocalCopy={localYaml => tripStore.branchLocalCopy(localYaml)}
                        onExportYaml={() => tripStore.exportTripYaml()}
                        onShareTrip={() => tripStore.shareCurrentTrip()}
                        onRevokeShareLink={() => tripStore.revokeShareLink()}
                        sharing={tripStore.isSharing}
                    />
                {/snippet}
                {#snippet prefs()}
                    <AppSettings />
                {/snippet}
            </ToolsTab>
        {:else if tripStore.loadError}
            <div class="h-full overflow-y-auto">
                <div class="max-w-3xl mx-auto w-full p-5 pt-[calc(20px+var(--safe-top))]">
                    <div class="panel rounded-2xl p-6 text-center border border-danger/30">
                        <TriangleAlert size={32} class="text-danger mx-auto mb-3" aria-hidden="true" />
                        <p class="text-text-primary text-sm font-semibold mb-4">{tripStore.loadError}</p>
                        <button
                            onclick={() => openTools("settings")}
                            class="bg-accent text-accent-contrast font-bold py-2.5 px-6 rounded-xl text-xs transition active:scale-[0.98] cursor-pointer"
                        >
                            開啟設定並貼上 YAML
                        </button>
                    </div>
                </div>
            </div>
        {:else if tripStore.data}
            {#if activeTab === "itinerary"}
                {#if tripStore.data.days.length > 0}
                    <ItineraryStrip
                        trip={tripStore.data.trip}
                        days={tripStore.data.days}
                        bind:currentDay
                        {clockNow}
                        prepDone={tripStore.prepDone}
                        prepTotal={tripStore.prepTotal}
                        expenses={tripStore.data.expenses}
                        profiles={tripStore.profiles}
                        {showWeatherAttribution}
                        {staleWeatherHours}
                        weatherForDay={day => weatherStore.forDay(day, tripStore.data?.trip.city)}
                        onSwitchProfile={id => tripStore.switchProfile(id, () => (activeTab = "itinerary"))}
                        onCreateProfile={() => tripStore.createProfile(() => openTools("settings"))}
                        onDeleteProfile={id => tripStore.deleteProfile(id)}
                        onLoadCloudTrip={(fileId, fileName) => tripStore.loadCloudTrip(fileId, fileName, () => (activeTab = "itinerary"), () => openTools("settings"))}
                        onDeleteCloudTrip={fileId => tripStore.deleteCloudTrip(fileId)}
                        onEnlarge={card => (enlargedCard = card)}
                        onSetEventStatus={(id, status) => tripStore.setEventStatus(id, status)}
                        onShareDay={dayData => tripStore.shareDayReport(dayData)}
                        onOpenPrepare={() => openTools("prep")}
                        onOpenLedger={() => openTools("ledger")}
                        onShare={() => tripStore.shareCurrentTrip()}
                        sharing={tripStore.isSharing}
                    />
                {/if}
            {:else if activeTab === "ai"}
                <ChatPanel
                    tripData={tripStore.data}
                    onApplyEdit={yaml => tripStore.applyAiEdit(yaml)}
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
