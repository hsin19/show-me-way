<script lang="ts">
import Copy from "@lucide/svelte/icons/copy";
import Download from "@lucide/svelte/icons/download";
import History from "@lucide/svelte/icons/history";
import Lightbulb from "@lucide/svelte/icons/lightbulb";
import Link2 from "@lucide/svelte/icons/link-2";
import Settings from "@lucide/svelte/icons/settings";
import TriangleAlert from "@lucide/svelte/icons/triangle-alert";
import { onMount } from "svelte";
import {
    backupCurrentYaml,
    fetchDefaultYamlText,
    getYamlBackup,
    listYamlBackups,
    serializeToYaml,
    USER_YAML_KEY,
    validateYaml,
    type YamlBackup,
} from "../api";
import { settingsDraft } from "../settings-draft.svelte";
import {
    decodeShareToken,
    parseShareToken,
} from "../share";
import {
    copyToClipboard,
    showToast,
} from "../toast.svelte";
import {
    formatDayDate,
    toLocalIsoDate,
} from "../utils";

interface Props {
    /** Reload trip data after a successful save / restore / reset (App's loadTripData). */
    onReload: () => Promise<void>;
    /** Navigate back to the itinerary after a successful save / restore / reset. */
    onDone: () => void;
    onExportYaml: () => void;
    onExportUrl: () => void;
    onExportCsv: () => void;
}

let { onReload, onDone, onExportYaml, onExportUrl, onExportCsv }: Props = $props();

let yamlInput = $state("");
let validationError = $state<string | null>(null);
let yamlBackups = $state<YamlBackup[]>([]);
// Snapshot of the persisted YAML, used to detect unsaved edits (restore/reset guards).
let yamlSnapshot = "";

// Populate the editor + backup list on mount. The panel is a page, not a
// modal — an in-session draft (settingsDraft) survives tab navigation and
// takes precedence over the persisted YAML.
onMount(async () => {
    yamlBackups = listYamlBackups();
    let persisted = localStorage.getItem(USER_YAML_KEY);
    if (persisted === null) {
        // Load default template for editing — same offline-safe fallback chain
        // as the initial load (see fetchDefaultYamlText).
        try {
            persisted = await fetchDefaultYamlText();
        } catch {
            persisted = "";
        }
    }
    yamlSnapshot = persisted;
    yamlInput = settingsDraft.yaml ?? persisted;
});

// Every keystroke updates the session draft so navigating away never loses edits.
function markDraft() {
    settingsDraft.yaml = yamlInput;
}

// Save & validate YAML (also accepts a pasted share link).
async function save() {
    try {
        const token = parseShareToken(yamlInput);
        const source = token ? await decodeShareToken(token) : yamlInput;
        const parsed = validateYaml(source);
        // Canonicalize on save: re-serialize so the stored (and re-displayed)
        // YAML always has a consistent key order and is stripped of runtime ids.
        const tidied = serializeToYaml(parsed);
        backupCurrentYaml();
        localStorage.setItem(USER_YAML_KEY, tidied);
        yamlInput = tidied;
        yamlSnapshot = tidied;
        settingsDraft.yaml = null;
        validationError = null;
        showToast(token ? "已從分享連結載入行程！" : "自訂 YAML 行程儲存成功！");
        await onReload();
        onDone();
    } catch (err) {
        console.error("YAML Validation failed:", err);
        validationError = err instanceof Error ? err.message : "YAML 格式錯誤，請檢查縮排！";
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
async function restore(savedAt: string) {
    // Unsaved editor edits never reach USER_YAML_KEY, so restoring would
    // discard them — same guard as before the panel became a page.
    if (yamlInput !== yamlSnapshot && !confirm("尚有未儲存的變更，還原備份將捨棄這些變更，確定繼續嗎？")) {
        return;
    }
    const yaml = getYamlBackup(savedAt);
    if (!yaml) {
        showToast("找不到此備份");
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
        settingsDraft.yaml = yaml;
        validationError = err instanceof Error ? err.message : "YAML 格式錯誤，請檢查縮排！";
        yamlBackups = listYamlBackups();
        showToast("此備份內容無效，已載入編輯器，請修正後再儲存");
        return;
    }
    if (!confirm("要以此備份覆蓋目前的行程嗎？")) return;
    backupCurrentYaml();
    localStorage.setItem(USER_YAML_KEY, yaml);
    settingsDraft.yaml = null;
    validationError = null;
    showToast("已還原備份的行程");
    await onReload();
    onDone();
}

// Reset to the project default itinerary.
async function reset() {
    // Unsaved editor edits never reach USER_YAML_KEY (and may hold an invalid
    // backup loaded for repair) — same guard as restore.
    if (yamlInput !== yamlSnapshot && !confirm("尚有未儲存的變更，回復預設將捨棄這些變更，確定繼續嗎？")) {
        return;
    }
    if (confirm("要清除自訂 YAML，並恢復為專案預設的行程嗎？")) {
        backupCurrentYaml();
        localStorage.removeItem(USER_YAML_KEY);
        settingsDraft.yaml = null;
        validationError = null;
        showToast("已恢復為預設行程…");
        await onReload();
        onDone();
    }
}

function selectAll() {
    const textarea = document.getElementById("yaml-editor") as HTMLTextAreaElement | null;
    if (textarea) {
        textarea.focus();
        textarea.select();
        showToast("已全選編輯器內容");
    }
}

function clearEditor() {
    yamlInput = "";
    settingsDraft.yaml = "";
    showToast("已清空編輯器內容");
}
</script>

<div class="mb-4">
    <h2 class="text-xl font-extrabold text-text-primary tracking-tight flex items-center gap-2">
        <Settings size={22} class="text-accent" aria-hidden="true" />自訂 YAML 行程設定
    </h2>
    <p class="text-xs text-text-secondary mt-0.5">直接編輯行程資料，儲存後立即套用</p>
</div>

<div class="flex flex-col gap-2.5 text-xs">
    <!-- YAML Editor Textarea -->
    <div class="flex flex-col gap-1.5">
        <div class="flex justify-between items-center">
            <label for="yaml-editor" class="font-bold text-text-primary">行程資料 (YAML)</label>
            <!-- 44px hot zones. Width grows in-flow (no -mx) so adjacent
                 zones can't overlap; -mb is capped at the 6px gap so the
                 zones stop at the textarea below (pt-1.5 re-centers text). -->
            <div class="flex items-center gap-2.5">
                <button
                    onclick={selectAll}
                    class="text-[11px] min-w-[44px] min-h-[44px] -mt-3 -mb-1.5 pt-1.5 px-1 text-text-secondary hover:text-accent flex items-center justify-center gap-0.5 cursor-pointer font-medium transition"
                >
                    全選
                </button>
                <span class="text-[9px] text-white/10 select-none">|</span>
                <button
                    onclick={clearEditor}
                    class="text-[11px] min-w-[44px] min-h-[44px] -mt-3 -mb-1.5 pt-1.5 px-1 text-text-secondary hover:text-danger flex items-center justify-center gap-0.5 cursor-pointer font-medium transition"
                >
                    清空
                </button>
                <span class="text-[9px] text-white/10 select-none">|</span>
                <button
                    onclick={() => copyToClipboard(yamlInput, "已複製編輯器中的 YAML")}
                    class="text-[11px] min-w-[44px] min-h-[44px] -mt-3 -mb-1.5 pt-1.5 px-1 text-text-secondary hover:text-accent flex items-center justify-center gap-1 cursor-pointer font-medium transition"
                >
                    <Copy size={12} aria-hidden="true" /> 複製
                </button>
            </div>
        </div>
        <textarea
            id="yaml-editor"
            bind:value={yamlInput}
            oninput={markDraft}
            spellcheck="false"
            autocapitalize="off"
            placeholder="貼上你的 YAML 行程，或直接貼上分享連結…"
            class="w-full h-[45dvh] min-h-[240px] bg-black/40 border border-card-border rounded-xl p-3 text-[11px] text-text-primary font-mono outline-none focus:border-accent resize-none overflow-y-auto overscroll-contain"
        ></textarea>
    </div>

    <!-- Validation Error Message -->
    {#if validationError}
        <div class="flex items-start gap-1.5 text-[10px] text-danger bg-danger/10 border border-danger/20 p-2.5 rounded-lg font-mono">
            <TriangleAlert size={12} class="shrink-0 mt-px" aria-hidden="true" />
            <span>{validationError}</span>
        </div>
    {/if}

    <div class="text-[10px] text-text-muted leading-normal bg-black/20 p-3 rounded-lg border border-white/2 space-y-1">
        <p class="flex items-center gap-1">
            <Lightbulb size={12} class="shrink-0 text-accent" aria-hidden="true" />行程僅存於本機、不會上傳。
        </p>
        <ul class="list-disc pl-4 mt-1 space-y-1.5">
            <li>貼上 YAML 行程內容，或他人的分享連結，按下方儲存即可。</li>
            <li>清空並儲存會還原為預設的 <a href="./itinerary.yaml" target="_blank" rel="noopener noreferrer" class="text-accent underline hover:text-white transition">itinerary.yaml</a>。</li>
            <li>
                可用此指令安裝行程小幫手 Skill：
                <div class="bg-black/60 border border-white/5 rounded px-2 py-1 mt-1 font-mono text-[10px] select-all break-all text-text-primary">
                    npx skills add https://github.com/hsin19/show-me-way --skill itinerary-yaml-builder
                </div>
            </li>
        </ul>
    </div>

    <!-- Auto-backup restore list: snapshots taken before each destructive overwrite -->
    <div class="text-[10px] text-text-muted leading-normal bg-black/20 p-3 rounded-lg border border-white/2">
        <p class="flex items-center gap-1 font-bold text-text-primary text-xs">
            <History size={12} class="shrink-0 text-accent" aria-hidden="true" />還原備份
        </p>
        {#if yamlBackups.length === 0}
            <p class="mt-1.5">尚無自動備份。覆蓋行程前會自動保留最近 5 份。</p>
        {:else}
            <ul class="mt-1.5 space-y-1.5">
                {#each yamlBackups as backup (backup.savedAt)}
                    <li>
                        <button
                            onclick={() => restore(backup.savedAt)}
                            class="w-full min-h-[44px] flex items-center justify-between gap-2 px-3 rounded-lg bg-white/3 border border-card-border text-[11px] text-text-secondary hover:text-accent hover:bg-white/5 transition cursor-pointer"
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
    <div class="text-[10px] text-text-muted leading-normal bg-black/20 p-3 rounded-lg border border-white/2">
        <p class="flex items-center gap-1 font-bold text-text-primary text-xs">
            <Download size={12} class="shrink-0 text-accent" aria-hidden="true" />匯出資料
        </p>
        <p class="mt-1.5">複製成跨裝置連結快速搬移，或下載成檔案保存，避免裝置遺失或清除瀏覽器資料時一併消失。</p>
        <button
            onclick={onExportUrl}
            class="w-full min-h-[44px] flex items-center justify-center gap-1.5 px-3 rounded-lg bg-accent/10 text-[11px] font-bold text-accent hover:bg-accent/15 transition cursor-pointer mt-1.5"
        >
            <Link2 size={12} aria-hidden="true" /> 複製跨裝置連結（含記帳）
        </button>
        <div class="grid grid-cols-2 gap-2 mt-2">
            <button
                onclick={onExportYaml}
                class="min-h-[44px] flex items-center justify-center gap-1 px-3 rounded-lg bg-white/3 border border-card-border text-[11px] font-bold text-text-secondary hover:text-accent hover:bg-white/5 transition cursor-pointer"
            >
                匯出行程 YAML
            </button>
            <button
                onclick={onExportCsv}
                class="min-h-[44px] flex items-center justify-center gap-1 px-3 rounded-lg bg-white/3 border border-card-border text-[11px] font-bold text-text-secondary hover:text-accent hover:bg-white/5 transition cursor-pointer"
            >
                匯出記帳 CSV
            </button>
        </div>
    </div>

    <div class="grid grid-cols-2 gap-2 mt-1">
        <button
            onclick={reset}
            class="bg-white/3 border border-card-border text-text-secondary font-bold py-3 px-4 rounded-xl text-xs hover:bg-white/5 transition cursor-pointer"
        >
            回復預設行程
        </button>
        <button
            onclick={save}
            class="bg-accent text-accent-contrast font-bold py-3 px-4 rounded-xl text-xs transition active:scale-[0.98] cursor-pointer"
        >
            儲存並解析
        </button>
    </div>
</div>
