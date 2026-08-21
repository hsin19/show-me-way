<script lang="ts">
import Check from "@lucide/svelte/icons/check";
import CloudOff from "@lucide/svelte/icons/cloud-off";
import Download from "@lucide/svelte/icons/download";
import ExternalLink from "@lucide/svelte/icons/external-link";
import HardDrive from "@lucide/svelte/icons/hard-drive";
import History from "@lucide/svelte/icons/history";
import Info from "@lucide/svelte/icons/info";
import Monitor from "@lucide/svelte/icons/monitor";
import Moon from "@lucide/svelte/icons/moon";
import Palette from "@lucide/svelte/icons/palette";
import Settings from "@lucide/svelte/icons/settings";
import Share from "@lucide/svelte/icons/share";
import Sparkles from "@lucide/svelte/icons/sparkles";
import SquarePlus from "@lucide/svelte/icons/square-plus";
import Sun from "@lucide/svelte/icons/sun";
import Trash2 from "@lucide/svelte/icons/trash-2";
import TriangleAlert from "@lucide/svelte/icons/triangle-alert";
import {
    clearGeminiApiKey,
    type GeminiModelFilterMode,
    loadGeminiApiKey,
    loadGeminiModelFilter,
    saveGeminiApiKey,
    saveGeminiModelFilter,
} from "../gemini";
import { createModelPicker } from "../gemini-models.svelte";
import {
    canPromptPwaInstall,
    isIosDevice,
    isStandaloneMode,
    promptPwaInstall,
} from "../pwa-install.svelte";
import {
    clearApiCache,
    clearAppLocalStorage,
    clearYamlBackups,
    getStorageSummary,
} from "../storage-admin";
import {
    setThemePref,
    theme,
    type ThemePref,
} from "../theme.svelte";
import { showToast } from "../toast.svelte";
import { formatBytes } from "../utils";
import {
    APP_VERSION,
    formatBuildDate,
    REPO_URL,
    versionCommitUrl,
} from "../version";
import ConfirmBar from "./ConfirmBar.svelte";
import GitHubIcon from "./icons/GitHubIcon.svelte";

// Everything here is a property of the device, not of a trip: nothing on this
// page travels with a profile. Trip-level settings are 行程管理.

const commitUrl = versionCommitUrl();

const THEMES: { id: ThemePref; label: string; icon: typeof Sun; hint: string; }[] = [
    { id: "system", label: "跟隨系統", icon: Monitor, hint: "依裝置的深淺色設定自動切換" },
    { id: "light", label: "淺色", icon: Sun, hint: "紙感淺色，白天在外面看得比較清楚" },
    { id: "dark", label: "深色", icon: Moon, hint: "沉穩深藍，夜間或室內比較不刺眼" },
];

let activeHint = $derived(THEMES.find(t => t.id === theme.pref)?.hint ?? "");

let apiKey = $state<string | null>(loadGeminiApiKey());
let keyInput = $state(loadGeminiApiKey() ?? "");
let filterMode = $state<GeminiModelFilterMode>(loadGeminiModelFilter());
// The same helper ChatPanel's header select runs on, so the two cannot disagree
// about which model is default.
const modelPicker = createModelPicker(() => apiKey, () => filterMode);

function handleSaveKey(e: SubmitEvent) {
    e.preventDefault();
    const key = keyInput.trim();
    if (!key) return;
    saveGeminiApiKey(key);
    apiKey = key;
    showToast("已儲存 API 金鑰");
}

function handleClearKey() {
    clearGeminiApiKey();
    apiKey = null;
    keyInput = "";
    modelPicker.reset();
    confirming = null;
    showToast("已清除 API 金鑰");
}

function handleFilterModeChange(newMode: GeminiModelFilterMode) {
    filterMode = newMode;
    saveGeminiModelFilter(newMode);
}

// Read once per mount, which is enough because TabPager rebuilds this page every
// time it is visited.
let storageSummary = $state(getStorageSummary());
// A single slot, so opening one confirmation closes any other.
let confirming = $state<"backups" | "reset" | "apiKey" | null>(null);

function refreshSummary() {
    storageSummary = getStorageSummary();
}

function handleClearApiCache() {
    const count = clearApiCache();
    refreshSummary();
    showToast(`已清除 ${count} 項 API 快取`);
}

function handleClearBackups() {
    clearYamlBackups();
    confirming = null;
    refreshSummary();
    showToast("已清除行程歷史備份");
}

function handleFullReset() {
    clearAppLocalStorage();
    confirming = null;
    refreshSummary();
    showToast("已重置本 App 的所有資料，即將重新載入…");
    // A reload, not a re-render: components still hold the cleared trip in memory
    // and would write parts of it straight back on the next save.
    setTimeout(() => {
        window.location.reload();
    }, 1000);
}
</script>

<div class="mb-4">
    <h2 class="text-xl font-extrabold text-text-primary tracking-tight flex items-center gap-2">
        <Settings size={22} class="text-accent" aria-hidden="true" />App 設定
    </h2>
    <p class="text-xs text-text-secondary mt-0.5">此頁的設定屬於整個 App，不隨行程切換</p>
</div>

<section class="panel rounded-xl p-3.5">
    <h3 class="text-sm font-bold text-text-primary mb-2.5 flex items-center gap-1.5">
        <Palette size={16} class="text-accent" aria-hidden="true" />外觀
    </h3>

    <!-- radiogroup rather than three buttons: this is one setting with three
         mutually exclusive values, and arrow keys should move between them. -->
    <div role="radiogroup" aria-label="外觀主題" class="flex gap-2">
        {#each THEMES as option (option.id)}
            {@const selected = theme.pref === option.id}
            <button
                type="button"
                role="radio"
                aria-checked={selected}
                onclick={() => setThemePref(option.id)}
                class="
                    flex-1 min-h-[44px] flex flex-col items-center justify-center gap-1 px-2 py-2.5
                    rounded-xl border text-[11px] font-bold transition duration-200 cursor-pointer
                    {selected
                    ? 'bg-accent/15 border-accent/40 text-accent'
                    : 'bg-tint-1 border-card-border text-text-secondary hover:bg-tint-2'}
                "
            >
                <option.icon size={17} aria-hidden="true" />
                {option.label}
            </button>
        {/each}
    </div>

    <!-- No line break before the fullwidth parenthesis: Svelte would keep the
         whitespace and zh-TW punctuation must sit flush against the text. -->
    <p class="text-[11px] text-text-muted mt-2.5 leading-normal">
        {activeHint}{#if theme.pref === "system"}<span class="text-text-secondary"
            >（目前為{
                    theme.resolved === "dark"
                    ? "深色"
                    : "淺色"
                }）</span>{/if}
    </p>
</section>

<section class="panel rounded-xl p-3.5 mt-3">
    <div class="flex items-center justify-between mb-2.5">
        <h3 class="text-sm font-bold text-text-primary flex items-center gap-1.5">
            <Sparkles size={16} class="text-accent" aria-hidden="true" />AI 助手設定 (Gemini API)
        </h3>
        <!-- The badge reports what the models call said about the key, not merely
             that one is stored — a green tick on a rejected key would be a lie. -->
        {#if apiKey && modelPicker.error}
            <span class="text-[11px] font-semibold text-danger bg-danger/10 px-2 py-0.5 rounded-full border border-danger/20 flex items-center gap-1">
                <TriangleAlert size={12} aria-hidden="true" />金鑰無法使用
            </span>
        {:else if apiKey && !modelPicker.loading}
            <span class="text-[11px] font-semibold text-positive bg-positive/10 px-2 py-0.5 rounded-full border border-positive/20 flex items-center gap-1">
                <Check size={12} aria-hidden="true" />金鑰可用
            </span>
        {/if}
    </div>

    <form onsubmit={handleSaveKey} class="space-y-3">
        <div>
            <label for="gemini-api-key-input" class="block text-xs font-semibold text-text-secondary mb-1">
                Google Gemini API 金鑰
            </label>
            <div class="flex gap-2">
                <input
                    id="gemini-api-key-input"
                    bind:value={keyInput}
                    type="password"
                    autocomplete="off"
                    aria-label="Gemini API 金鑰"
                    placeholder="貼上 API 金鑰…"
                    class="flex-1 min-w-0 bg-well-deep border border-card-border rounded-xl px-3 py-2 text-xs text-text-primary outline-none focus:border-accent transition"
                />
                <button
                    type="submit"
                    disabled={!keyInput.trim() || keyInput.trim() === apiKey}
                    class="bg-accent text-accent-contrast font-bold px-3 py-2 rounded-xl text-xs transition active:scale-[0.98] cursor-pointer disabled:opacity-40 shrink-0"
                >
                    儲存
                </button>
                {#if apiKey}
                    <button
                        type="button"
                        onclick={() => (confirming = "apiKey")}
                        aria-label="清除 API 金鑰"
                        title="清除 API 金鑰"
                        class="bg-tint-1 border border-card-border hover:bg-danger/10 hover:border-danger/40 text-text-secondary hover:text-danger font-bold p-2 rounded-xl transition active:scale-[0.98] cursor-pointer flex items-center justify-center shrink-0"
                    >
                        <Trash2 size={16} aria-hidden="true" />
                    </button>
                {/if}
            </div>
        </div>

        {#if confirming === "apiKey"}
            <div>
                <ConfirmBar
                    message="清除 API 金鑰後，AI 行程小幫手將無法使用，直到重新填寫金鑰。確定清除？"
                    confirmLabel="確定清除"
                    onconfirm={handleClearKey}
                    oncancel={() => (confirming = null)}
                />
            </div>
        {/if}

        {#if modelPicker.error}
            <div role="alert" class="flex items-start gap-2 rounded-xl border border-danger/30 bg-danger/10 px-3 py-2">
                <TriangleAlert size={14} class="text-danger shrink-0 mt-0.5" aria-hidden="true" />
                <p class="text-[11px] text-text-secondary leading-relaxed whitespace-pre-line">{modelPicker.error}</p>
            </div>
        {/if}

        {#if apiKey}
            <div>
                <span class="block text-xs font-semibold text-text-secondary mb-1">
                    模型篩選範圍
                </span>
                <div class="flex gap-2 mb-3">
                    <button
                        type="button"
                        onclick={() => handleFilterModeChange("default")}
                        class="flex-1 py-1.5 px-3 rounded-xl border text-xs font-bold transition cursor-pointer flex items-center justify-center gap-1.5 {filterMode === 'default' ? 'bg-accent/15 border-accent/40 text-accent' : 'bg-tint-1 border-card-border text-text-secondary hover:bg-tint-2'}"
                    >
                        {#if filterMode === "default"}
                            <Check size={14} aria-hidden="true" />
                        {/if}
                        預設 (推薦)
                    </button>
                    <button
                        type="button"
                        onclick={() => handleFilterModeChange("all")}
                        class="flex-1 py-1.5 px-3 rounded-xl border text-xs font-bold transition cursor-pointer flex items-center justify-center gap-1.5 {filterMode === 'all' ? 'bg-accent/15 border-accent/40 text-accent' : 'bg-tint-1 border-card-border text-text-secondary hover:bg-tint-2'}"
                    >
                        {#if filterMode === "all"}
                            <Check size={14} aria-hidden="true" />
                        {/if}
                        全部 (不篩選)
                    </button>
                </div>
            </div>

            <div>
                <label for="gemini-model-select" class="block text-xs font-semibold text-text-secondary mb-1">
                    AI 模型選擇
                </label>
                <select
                    id="gemini-model-select"
                    bind:value={modelPicker.selected}
                    disabled={modelPicker.loading}
                    aria-label="選擇 AI 模型"
                    class="w-full bg-well-deep border border-card-border rounded-xl px-3 py-2 text-xs text-text-primary outline-none focus:border-accent transition cursor-pointer disabled:opacity-50"
                >
                    {#if modelPicker.list.length === 0}
                        <option value={modelPicker.selected}>{modelPicker.selected || (modelPicker.loading ? "載入模型中…" : "自動選擇")}</option>
                    {:else}
                        {#each modelPicker.list as m (m.id)}
                            <option value={m.id}>{m.displayName}</option>
                        {/each}
                    {/if}
                </select>
            </div>
        {/if}

        <div class="text-[11px] text-text-muted leading-relaxed pt-1 flex items-center gap-2">
            <span>金鑰僅存於本機</span>
            <span>·</span>
            <a
                href="https://aistudio.google.com/app/apikey"
                target="_blank"
                rel="noopener noreferrer"
                class="inline-flex items-center gap-1 text-accent hover:underline font-medium"
            >
                <span>取得免費金鑰</span>
                <ExternalLink size={11} aria-hidden="true" />
            </a>
        </div>
    </form>
</section>

<!-- The clear button's 44px hit area is pulled back with negative margins, so the
     tile stays compact without shrinking the target. -->
{#snippet storageTile(
    label: string,
    hint: string,
    Icon: typeof Sun,
    stats: { keyCount: number; sizeBytes: number; },
    onclear: () => void,
)}
    <div class="bg-well rounded-lg p-2.5 border border-line-faint flex flex-col justify-between">
        <div>
            <div class="text-[11px] font-bold text-text-primary flex items-center gap-1">
                <Icon size={13} class="text-accent shrink-0" aria-hidden="true" />{label}
            </div>
            <div class="text-[10px] text-text-muted mt-0.5">{hint}</div>
        </div>
        <div class="mt-2.5 flex items-center justify-between">
            <span class="text-[11px] font-mono font-bold text-text-secondary">
                {stats.keyCount} 項（{formatBytes(stats.sizeBytes)}）
            </span>
            <button
                type="button"
                onclick={onclear}
                disabled={stats.keyCount === 0}
                class="
                    -my-2 -mr-1 px-2 min-h-[44px] flex items-center text-[11px] font-bold underline
                    text-accent hover:text-accent/80 cursor-pointer
                    disabled:opacity-40 disabled:no-underline disabled:cursor-not-allowed
                "
            >
                清除
            </button>
        </div>
    </div>
{/snippet}

<section class="panel rounded-xl p-3.5 mt-3">
    <div class="flex items-center justify-between mb-2.5">
        <h3 class="text-sm font-bold text-text-primary flex items-center gap-1.5">
            <HardDrive size={16} class="text-accent" aria-hidden="true" />本機儲存
        </h3>
        <span class="text-[11px] font-semibold text-text-secondary bg-tint-1 px-2 py-0.5 rounded-full border border-card-border">
            共 {formatBytes(storageSummary.totalBytes)}
        </span>
    </div>

    <div class="grid grid-cols-2 gap-2">
        {@render storageTile(
            "API 快取",
            "天氣與匯率，清除後重抓",
            CloudOff,
            storageSummary.apiCache,
            handleClearApiCache,
        )}
        {@render storageTile(
            "行程歷史備份",
            "自動留存的 5 份快照",
            History,
            storageSummary.backups,
            () => (confirming = "backups"),
        )}
    </div>

    {#if confirming === "backups"}
        <div class="mt-2">
            <ConfirmBar
                message="備份是覆蓋行程前唯一的還原點，清除後無法復原。確定清除？"
                confirmLabel="確定清除"
                onconfirm={handleClearBackups}
                oncancel={() => (confirming = null)}
            />
        </div>
    {/if}

    <div class="mt-2">
        {#if confirming === "reset"}
            <ConfirmBar
                message="將清除本 App 的行程、備份與所有設定，且無法復原。確定重置？"
                confirmLabel="確定重置"
                onconfirm={handleFullReset}
                oncancel={() => (confirming = null)}
            />
        {:else}
            <button
                type="button"
                onclick={() => (confirming = "reset")}
                class="
                    w-full min-h-[44px] px-3 rounded-xl bg-tint-1 border border-card-border text-text-muted
                    text-xs font-bold transition duration-200 cursor-pointer
                    hover:text-danger hover:border-danger/40 hover:bg-danger/10
                "
            >
                重置全部本機資料
            </button>
        {/if}
    </div>
</section>

{#if !isStandaloneMode()}
    <section class="panel rounded-xl p-3.5 mt-3">
        <div class="flex items-center justify-between mb-2">
            <h3 class="text-sm font-bold text-text-primary flex items-center gap-1.5">
                <Download size={16} class="text-accent" aria-hidden="true" />安裝 App 至主畫面
            </h3>
        </div>

        {#if isIosDevice()}
            <p class="text-xs text-text-muted mb-2.5">
                在 iOS Safari 上，只需 2 個步驟即可將 App 加到 iPhone / iPad 主畫面：
            </p>
            <div class="space-y-2 text-xs bg-tint-1/60 p-3 rounded-xl border border-line-faint">
                <div class="flex items-center gap-2 text-text-primary">
                    <span class="w-5 h-5 rounded-full bg-accent/15 text-accent font-bold flex items-center justify-center text-[11px] shrink-0">1</span>
                    <span>點擊瀏覽器底部的 <strong>「分享」</strong> 按鈕</span>
                    <Share size={15} class="text-accent inline shrink-0" aria-hidden="true" />
                </div>
                <div class="flex items-center gap-2 text-text-primary">
                    <span class="w-5 h-5 rounded-full bg-accent/15 text-accent font-bold flex items-center justify-center text-[11px] shrink-0">2</span>
                    <span>向下捲動並選取 <strong>「加入主畫面」</strong></span>
                    <SquarePlus size={15} class="text-accent inline shrink-0" aria-hidden="true" />
                </div>
            </div>
        {:else if canPromptPwaInstall()}
            <p class="text-xs text-text-muted mb-3">
                取得全螢幕與流暢的離線行程體驗，點擊下方按鈕即可快速安裝。
            </p>
            <button
                type="button"
                onclick={() => void promptPwaInstall()}
                class="
                    w-full py-2.5 px-4 rounded-xl bg-accent text-accent-contrast
                    text-xs font-bold transition duration-200 cursor-pointer
                    flex items-center justify-center gap-2 hover:opacity-90 active:scale-[0.98]
                "
            >
                <Download size={16} aria-hidden="true" />
                立即安裝 App
            </button>
        {:else}
            <p class="text-xs text-text-muted mb-2">
                請透過瀏覽器快速安裝：
            </p>
            <div class="text-xs bg-tint-1/60 p-3 rounded-xl border border-line-faint text-text-primary space-y-1.5">
                <div>
                    點擊瀏覽器上方 <strong>網址列右側</strong> 的「安裝圖示」（電腦版 Chrome / Edge 或部分手機瀏覽器）。
                </div>
                <div class="text-text-muted text-[11px]">
                    若未顯示圖示，亦可點擊選單 (⋮) ➔ 選取 <strong>「安裝應用程式」</strong> 或 <strong>「新增至主畫面」</strong>。
                </div>
            </div>
        {/if}
    </section>
{/if}

<section class="panel rounded-xl p-3.5 mt-3">
    <div class="flex items-center justify-between mb-2">
        <h3 class="text-sm font-bold text-text-primary flex items-center gap-1.5">
            <Info size={16} class="text-accent" aria-hidden="true" />關於 App
        </h3>
        <a
            href={REPO_URL}
            target="_blank"
            rel="noopener noreferrer"
            class="
                -m-2 min-h-[44px] min-w-[44px] flex items-center justify-center
                text-text-muted hover:text-text-primary transition-colors
            "
            aria-label="GitHub 專案庫"
        >
            <GitHubIcon size={16} aria-hidden="true" />
        </a>
    </div>
    <p class="text-[11px] text-text-muted leading-normal">
        版本：{#if commitUrl}<a
                href={commitUrl}
                target="_blank"
                rel="noopener noreferrer"
                class="underline decoration-dotted underline-offset-2 hover:text-text-primary transition-colors"
            >{APP_VERSION}</a>{:else}{APP_VERSION}{/if} · {formatBuildDate()}
    </p>
</section>
