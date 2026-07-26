<script lang="ts">
import CloudOff from "@lucide/svelte/icons/cloud-off";
import HardDrive from "@lucide/svelte/icons/hard-drive";
import History from "@lucide/svelte/icons/history";
import Info from "@lucide/svelte/icons/info";
import Monitor from "@lucide/svelte/icons/monitor";
import Moon from "@lucide/svelte/icons/moon";
import Palette from "@lucide/svelte/icons/palette";
import Settings from "@lucide/svelte/icons/settings";
import Sun from "@lucide/svelte/icons/sun";
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
} from "../version";
import ConfirmBar from "./ConfirmBar.svelte";
import GitHubIcon from "./icons/GitHubIcon.svelte";

// App-level preferences, as opposed to the trip-level 行程管理 page. Nothing
// here travels with a trip profile or the itinerary YAML.

const THEMES: { id: ThemePref; label: string; icon: typeof Sun; hint: string; }[] = [
    { id: "system", label: "跟隨系統", icon: Monitor, hint: "依裝置的深淺色設定自動切換" },
    { id: "light", label: "淺色", icon: Sun, hint: "紙感淺色，白天在外面看得比較清楚" },
    { id: "dark", label: "深色", icon: Moon, hint: "沉穩深藍，夜間或室內比較不刺眼" },
];

let activeHint = $derived(THEMES.find(t => t.id === theme.pref)?.hint ?? "");

// Read once per mount: TabPager renders only the current panel, so revisiting
// this page remounts it and re-reads storage.
let storageSummary = $state(getStorageSummary());
// One at a time — opening either confirmation closes the other.
let confirming = $state<"backups" | "reset" | null>(null);

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
    // Reload rather than re-render: components still hold the cleared trip in
    // memory and would write parts of it back on the next save.
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

<!-- Storage tile: name, what it holds, how much of it there is, and one action.
     The clear button carries a 44px hit area pulled back with negative margins
     so the tile stays compact. -->
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

<section class="panel rounded-xl p-3.5 mt-3">
    <div class="flex items-center justify-between mb-2">
        <h3 class="text-sm font-bold text-text-primary flex items-center gap-1.5">
            <Info size={16} class="text-accent" aria-hidden="true" />關於 App
        </h3>
        <a
            href="https://github.com/hsin19/show-me-way"
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
        版本：{APP_VERSION} · {formatBuildDate()}
    </p>
</section>
