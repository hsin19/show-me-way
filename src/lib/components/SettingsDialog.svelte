<script lang="ts">
import Copy from "@lucide/svelte/icons/copy";
import Download from "@lucide/svelte/icons/download";
import History from "@lucide/svelte/icons/history";
import Lightbulb from "@lucide/svelte/icons/lightbulb";
import Link2 from "@lucide/svelte/icons/link-2";
import Settings from "@lucide/svelte/icons/settings";
import TriangleAlert from "@lucide/svelte/icons/triangle-alert";
import X from "@lucide/svelte/icons/x";
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
    /** Bindable open state (persistent DOM, toggled by opacity). */
    open: boolean;
    /** Reload trip data after a successful save / restore / reset (App's loadTripData). */
    onReload: () => Promise<void>;
    onExportYaml: () => void;
    onExportUrl: () => void;
    onExportCsv: () => void;
}

let { open = $bindable(), onReload, onExportYaml, onExportUrl, onExportCsv }: Props = $props();

let yamlInput = $state("");
let validationError = $state<string | null>(null);
let yamlBackups = $state<YamlBackup[]>([]);
// Snapshot of the YAML when the editor was opened, used to detect unsaved edits.
let yamlSnapshot = "";
let dialogEl = $state<HTMLDivElement>();

// Populate the editor + backup list from storage when the dialog opens.
async function initEditor() {
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

// Init + focus on open; restore focus to the trigger on close. Focusing the
// dialog container (not the textarea) avoids popping the mobile keyboard.
let returnFocus: HTMLElement | null = null;
let wasOpen = false;
$effect(() => {
    if (open && !wasOpen) {
        returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        void initEditor();
        dialogEl?.focus();
    } else if (!open && wasOpen) {
        returnFocus?.focus();
        returnFocus = null;
    }
    wasOpen = open;
});

function handleKeydown(e: KeyboardEvent) {
    if (e.key === "Escape" && open) attemptClose();
}

// Close, warning if there are unsaved edits.
function attemptClose() {
    if (yamlInput !== yamlSnapshot && !confirm("尚有未儲存的變更，確定要關閉嗎？")) {
        return;
    }
    open = false;
    validationError = null;
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
        open = false;
        validationError = null;
        showToast(token ? "已從分享連結載入行程！" : "自訂 YAML 行程儲存成功！");
        await onReload();
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
    // Unsaved editor edits never reach USER_YAML_KEY, so no snapshot can
    // recover them — they are the only truly unrecoverable content here.
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
        validationError = err instanceof Error ? err.message : "YAML 格式錯誤，請檢查縮排！";
        yamlBackups = listYamlBackups();
        showToast("此備份內容無效，已載入編輯器，請修正後再儲存");
        return;
    }
    if (!confirm("要以此備份覆蓋目前的行程嗎？")) return;
    backupCurrentYaml();
    localStorage.setItem(USER_YAML_KEY, yaml);
    open = false;
    validationError = null;
    showToast("已還原備份的行程");
    await onReload();
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
        open = false;
        validationError = null;
        showToast("已恢復為預設行程…");
        await onReload();
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
    showToast("已清空編輯器內容");
}
</script>

<svelte:window onkeydown={handleKeydown} />

<!-- Settings overlay modal: persistent DOM toggled by opacity (an {#if} would
     drop the fade), so the closed state must be inert to stay out of the Tab
     order and the accessibility tree. -->
<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
    onclick={attemptClose}
    inert={!open}
    class="
        fixed inset-0 bg-black/95 z-[1000] flex items-center justify-center p-5 transition-opacity duration-300
        {open ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}
    "
>
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <div
        bind:this={dialogEl}
        role="dialog"
        aria-modal="true"
        aria-label="自訂 YAML 行程設定"
        tabindex="-1"
        onclick={(e => e.stopPropagation())}
        class="
            bg-[#121422] border border-white/8 rounded-3xl w-full max-w-[420px] p-6 shadow-2xl transition-transform duration-300
            flex flex-col h-[min(100dvh-2.5rem,720px)] overscroll-contain
            {open ? 'translate-y-0' : 'translate-y-5'}
        "
    >
        <div class="flex justify-between items-center mb-4 shrink-0">
            <h3 class="text-base font-bold text-text-primary flex items-center gap-1.5">
                <Settings size={18} class="text-neon-blue" aria-hidden="true" />
                自訂 YAML 行程設定
            </h3>
            <button
                onclick={attemptClose}
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
                            onclick={selectAll}
                            class="text-[11px] min-w-[44px] min-h-[44px] -mt-3 -mb-1.5 pt-1.5 px-1 text-text-secondary hover:text-neon-blue flex items-center justify-center gap-0.5 cursor-pointer font-medium transition"
                        >
                            全選
                        </button>
                        <span class="text-[9px] text-white/10 select-none">|</span>
                        <button
                            onclick={clearEditor}
                            class="text-[11px] min-w-[44px] min-h-[44px] -mt-3 -mb-1.5 pt-1.5 px-1 text-text-secondary hover:text-neon-pink flex items-center justify-center gap-0.5 cursor-pointer font-medium transition"
                        >
                            清空
                        </button>
                        <span class="text-[9px] text-white/10 select-none">|</span>
                        <button
                            onclick={() => copyToClipboard(yamlInput, "已複製編輯器中的 YAML")}
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

            <!-- Secondary sections scroll together so the YAML editor above
                 keeps its flexible height and nothing overlaps on short screens. -->
            <div class="shrink-0 max-h-[42%] overflow-y-auto overscroll-contain flex flex-col gap-2.5 -mr-1 pr-1">
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
                                        onclick={() => restore(backup.savedAt)}
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
                    <p class="mt-1.5">複製成跨裝置連結快速搬移，或下載成檔案保存，避免裝置遺失或清除瀏覽器資料時一併消失。</p>
                    <button
                        onclick={onExportUrl}
                        class="w-full min-h-[44px] flex items-center justify-center gap-1.5 px-3 rounded-lg bg-white/3 border border-neon-blue/30 text-[11px] font-bold text-neon-blue hover:bg-neon-blue/10 transition cursor-pointer mt-1.5"
                    >
                        <Link2 size={12} aria-hidden="true" /> 複製跨裝置連結（含記帳）
                    </button>
                    <div class="grid grid-cols-2 gap-2 mt-2">
                        <button
                            onclick={onExportYaml}
                            class="min-h-[44px] flex items-center justify-center gap-1 px-3 rounded-lg bg-white/3 border border-card-border text-[11px] font-bold text-text-secondary hover:text-neon-blue hover:bg-white/5 transition cursor-pointer"
                        >
                            匯出行程 YAML
                        </button>
                        <button
                            onclick={onExportCsv}
                            class="min-h-[44px] flex items-center justify-center gap-1 px-3 rounded-lg bg-white/3 border border-card-border text-[11px] font-bold text-text-secondary hover:text-neon-blue hover:bg-white/5 transition cursor-pointer"
                        >
                            匯出記帳 CSV
                        </button>
                    </div>
                </div>
            </div>
        </div>

        <div class="grid grid-cols-2 gap-2 mt-3 shrink-0">
            <button
                onclick={reset}
                class="bg-white/3 border border-card-border text-text-secondary font-bold py-3 px-4 rounded-xl text-xs hover:bg-white/5 transition cursor-pointer"
            >
                回復預設行程
            </button>
            <button
                onclick={save}
                class="bg-gradient-to-r from-neon-blue to-neon-purple text-black font-bold py-3 px-4 rounded-xl text-xs transition active:scale-[0.98] cursor-pointer"
            >
                儲存並解析
            </button>
        </div>
    </div>
</div>
