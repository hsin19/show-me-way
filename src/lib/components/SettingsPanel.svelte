<script lang="ts">
import Cloud from "@lucide/svelte/icons/cloud";
import CloudUpload from "@lucide/svelte/icons/cloud-upload";
import Copy from "@lucide/svelte/icons/copy";
import Download from "@lucide/svelte/icons/download";
import History from "@lucide/svelte/icons/history";
import Lightbulb from "@lucide/svelte/icons/lightbulb";
import Link2 from "@lucide/svelte/icons/link-2";
import RefreshCw from "@lucide/svelte/icons/refresh-cw";
import Sliders from "@lucide/svelte/icons/sliders";
import Trash2 from "@lucide/svelte/icons/trash-2";
import TriangleAlert from "@lucide/svelte/icons/triangle-alert";
import { onMount } from "svelte";
import {
    backupCurrentYaml,
    getYamlBackup,
    listYamlBackups,
    serializeToYaml,
    USER_YAML_KEY,
    validateYaml,
    type YamlBackup,
} from "../api";
import { fetchDefaultYamlText } from "../api-fetch";
import { gdriveSync } from "../gdrive.svelte";
import {
    getActiveProfileId,
    type ProfileInfo,
    tripNameFromYaml,
} from "../profiles";
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
import ConfirmBar from "./ConfirmBar.svelte";
import ProfileManager from "./ProfileManager.svelte";

interface Props {
    /** Null while the YAML fails to load — this page has to work in exactly that case. */
    activeTripName: string | null;
    /** The parked trips only; the active one is not in this list. */
    profiles: ProfileInfo[];
    /** Awaited after a save / restore / reset, so `onDone` navigates to fresh data. */
    onReload: () => Promise<void>;
    onDone: () => void;
    onSwitchProfile: (id: string) => void;
    onCreateProfile: () => void;
    onDeleteProfile: (id: string, name: string) => void;
    onExportYaml: () => void;
    onExportUrl: () => void;
}

let {
    activeTripName,
    profiles,
    onReload,
    onDone,
    onSwitchProfile,
    onCreateProfile,
    onDeleteProfile,
    onExportYaml,
    onExportUrl,
}: Props = $props();

let yamlInput = $state("");
let validationError = $state<string | null>(null);
let yamlBackups = $state<YamlBackup[]>([]);
// What the editor is compared against to spot unsaved edits.
let yamlSnapshot = $state("");

// This is a page, not a modal, so leaving the tab unmounts it — an in-session
// draft outranks the persisted YAML on the way back in.
onMount(async () => {
    yamlBackups = listYamlBackups();
    if (gdriveSync.isConnected) {
        void gdriveSync.refreshFiles();
    }
    let persisted = localStorage.getItem(USER_YAML_KEY);
    if (persisted === null) {
        try {
            persisted = await fetchDefaultYamlText();
        } catch {
            persisted = "";
        }
    }
    yamlSnapshot = persisted;
    yamlInput = settingsDraft.yaml ?? persisted;
});

function markDraft() {
    settingsDraft.yaml = yamlInput;
}

/** 儲存並解析 — also the import path for a pasted share link. */
async function save() {
    try {
        const token = parseShareToken(yamlInput);
        const source = token ? await decodeShareToken(token) : yamlInput;
        const parsed = validateYaml(source);
        // Store what was parsed, not what was typed, so the editor shows the
        // canonical form from here on.
        const tidied = serializeToYaml(parsed);
        backupCurrentYaml();
        localStorage.setItem(USER_YAML_KEY, tidied);
        yamlInput = tidied;
        yamlSnapshot = tidied;
        settingsDraft.yaml = null;
        validationError = null;

        if (gdriveSync.autoSync && gdriveSync.isConnected) {
            const activeId = getActiveProfileId() ?? undefined;
            const tripName = parsed.trip?.name ?? "未命名行程";
            void gdriveSync.syncTrip(tripName, tidied, activeId, false);
        }

        showToast(token ? "已從分享連結載入行程！" : "自訂 YAML 行程儲存成功！");
        await onReload();
        onDone();
    } catch (err) {
        console.error("YAML Validation failed:", err);
        validationError = err instanceof Error ? err.message : "YAML 格式錯誤，請檢查縮排！";
    }
}

let confirmingCloudFileId = $state<string | null>(null);
let confirmingCloudDeleteFileId = $state<string | null>(null);

async function handleSyncToCloud() {
    const tripName = tripNameFromYaml(yamlInput);
    const activeId = getActiveProfileId() ?? undefined;
    await gdriveSync.syncTrip(tripName, yamlInput, activeId);
}

async function handleLoadFromCloud(fileId: string, cloudName: string) {
    confirmingCloudFileId = null;
    const yaml = await gdriveSync.loadTripYaml(fileId);
    if (!yaml) return;
    try {
        validateYaml(yaml);
    } catch (err) {
        console.error("Cloud YAML validation failed:", err);
        yamlInput = yaml;
        settingsDraft.yaml = yaml;
        validationError = err instanceof Error ? err.message : "雲端 YAML 格式錯誤，請檢查！";
        showToast("此雲端行程格式有誤，已載入編輯器，請修正後再儲存");
        return;
    }
    backupCurrentYaml();
    localStorage.setItem(USER_YAML_KEY, yaml);
    yamlInput = yaml;
    yamlSnapshot = yaml;
    settingsDraft.yaml = null;
    validationError = null;
    showToast(`已從 Google Drive 載入「${cloudName}」`);
    await onReload();
    onDone();
}

async function handleDeleteCloudTrip(fileId: string) {
    confirmingCloudDeleteFileId = null;
    await gdriveSync.deleteTrip(fileId);
}

/** "06/11(四) 14:30" */
function formatBackupTime(savedAt: string): string {
    const date = new Date(savedAt);
    if (isNaN(date.getTime())) return savedAt;
    const hh = String(date.getHours()).padStart(2, "0");
    const mm = String(date.getMinutes()).padStart(2, "0");
    return `${formatDayDate(toLocalIsoDate(date))} ${hh}:${mm}`;
}

let confirmingBackupSavedAt = $state<string | null>(null);

// Order matters twice here: the backup is read out before anything is written,
// or a full ring could evict the very entry being restored, and validation runs
// before the pre-restore snapshot, so a failed restore leaves the ring untouched.
async function executeRestore(savedAt: string) {
    confirmingBackupSavedAt = null;
    const yaml = getYamlBackup(savedAt);
    if (!yaml) {
        showToast("找不到此備份");
        yamlBackups = listYamlBackups();
        return;
    }
    try {
        validateYaml(yaml);
    } catch (err) {
        // A backup taken under looser validation rules can fail today. Put it in
        // the editor so the error message can guide a manual fix.
        console.error("Backup YAML validation failed:", err);
        yamlInput = yaml;
        settingsDraft.yaml = yaml;
        validationError = err instanceof Error ? err.message : "YAML 格式錯誤，請檢查縮排！";
        yamlBackups = listYamlBackups();
        showToast("此備份內容無效，已載入編輯器，請修正後再儲存");
        return;
    }
    backupCurrentYaml();
    localStorage.setItem(USER_YAML_KEY, yaml);
    settingsDraft.yaml = null;
    validationError = null;
    showToast("已還原備份的行程");
    await onReload();
    onDone();
}

let confirmingReset = $state(false);

async function handleReset() {
    confirmingReset = false;
    backupCurrentYaml();
    localStorage.removeItem(USER_YAML_KEY);
    settingsDraft.yaml = null;
    validationError = null;
    showToast("已恢復為預設行程…");
    await onReload();
    onDone();
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

function discardDraft() {
    yamlInput = yamlSnapshot;
    settingsDraft.yaml = null;
    validationError = null;
    showToast("已還原為目前儲存的行程內容");
}
</script>

<div class="mb-4">
    <h2 class="text-xl font-extrabold text-text-primary tracking-tight flex items-center gap-2">
        <Sliders size={22} class="text-accent" aria-hidden="true" />行程管理
    </h2>
    <p class="text-xs text-text-secondary mt-0.5">切換行程、直接編輯行程資料，儲存後立即套用</p>
</div>

<div class="mb-2.5">
    <ProfileManager
        activeTripName={activeTripName ?? "（尚未載入）"}
        {profiles}
        {onSwitchProfile}
        {onCreateProfile}
        {onDeleteProfile}
    />
</div>

<div class="flex flex-col gap-2.5 text-xs">
    <div class="flex flex-col gap-1.5">
        <div class="flex justify-between items-center">
            <label for="yaml-editor" class="font-bold text-text-primary">行程資料 (YAML)</label>
            <!-- 44px hot zones grown in-flow (no -mx), so adjacent ones cannot
                 overlap; the -mb is capped at the 6px gap so they stop short of
                 the textarea. -->
            <div class="flex items-center gap-2.5">
                <button
                    onclick={selectAll}
                    class="text-[11px] min-w-[44px] min-h-[44px] -mt-3 -mb-1.5 pt-1.5 px-1 text-text-secondary hover:text-accent flex items-center justify-center gap-0.5 cursor-pointer font-medium transition"
                >
                    全選
                </button>
                <span class="text-[9px] text-line-raised select-none">|</span>
                <button
                    onclick={clearEditor}
                    class="text-[11px] min-w-[44px] min-h-[44px] -mt-3 -mb-1.5 pt-1.5 px-1 text-text-secondary hover:text-danger flex items-center justify-center gap-0.5 cursor-pointer font-medium transition"
                >
                    清空
                </button>
                <span class="text-[9px] text-line-raised select-none">|</span>
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
            class="w-full h-[45dvh] min-h-[240px] bg-well-deep border border-card-border rounded-xl p-3 text-[11px] text-text-primary font-mono outline-none focus:border-accent resize-none overflow-y-auto overscroll-contain"
        ></textarea>
    </div>
    {#if validationError}
        <div class="flex items-start gap-1.5 text-[10px] text-danger bg-danger/10 border border-danger/20 p-2.5 rounded-lg font-mono">
            <TriangleAlert size={12} class="shrink-0 mt-px" aria-hidden="true" />
            <span>{validationError}</span>
        </div>
    {/if}

    <div class="grid grid-cols-2 gap-2 mt-0.5">
        <button
            onclick={discardDraft}
            disabled={yamlInput === yamlSnapshot}
            class="bg-tint-1 border border-card-border text-text-secondary font-bold py-3 px-4 rounded-xl text-xs hover:bg-tint-2 transition cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
        >
            放棄變更
        </button>
        <button
            onclick={save}
            class="bg-accent text-accent-contrast font-bold py-3 px-4 rounded-xl text-xs transition active:scale-[0.98] cursor-pointer"
        >
            儲存並解析
        </button>
    </div>

    <div class="text-[10px] text-text-muted leading-normal bg-well p-3 rounded-lg border border-line-faint space-y-1">
        <p class="flex items-center gap-1">
            <Lightbulb size={12} class="shrink-0 text-accent" aria-hidden="true" />行程僅存於本機、不會上傳。
        </p>
        <ul class="list-disc pl-4 mt-1 space-y-1.5">
            <li>貼上 YAML 行程內容，或他人的分享連結，按下方儲存即可。</li>
            <li>清空並儲存會還原為預設的 <a href="./itinerary.yaml" target="_blank" rel="noopener noreferrer" class="text-accent underline hover:text-text-primary transition">itinerary.yaml</a>。</li>
            <li>
                可用此指令安裝行程小幫手 Skill：
                <div class="bg-well-deep border border-line rounded px-2 py-1 mt-1 font-mono text-[10px] select-all break-all text-text-primary">
                    npx skills add https://github.com/hsin19/show-me-way --skill itinerary-yaml-builder
                </div>
            </li>
        </ul>
    </div>

    {#if gdriveSync.isConnected}
        <div class="text-[10px] text-text-muted leading-normal bg-well p-3 rounded-lg border border-line-faint">
            <div class="flex items-center justify-between">
                <p class="flex items-center gap-1 font-bold text-text-primary text-xs">
                    <Cloud size={12} class="shrink-0 text-accent" aria-hidden="true" />Google Drive 雲端同步
                </p>
                <div class="flex items-center gap-2">
                    <button
                        type="button"
                        disabled={gdriveSync.isSyncing}
                        onclick={() => void gdriveSync.refreshFiles()}
                        class="text-[10px] text-text-secondary hover:text-accent flex items-center gap-1 cursor-pointer font-medium disabled:opacity-40"
                    >
                        <RefreshCw size={10} class={gdriveSync.isSyncing ? "animate-spin" : ""} aria-hidden="true" />
                        重整
                    </button>
                </div>
            </div>

            <div class="mt-2 flex gap-2">
                <button
                    type="button"
                    disabled={gdriveSync.isSyncing}
                    onclick={handleSyncToCloud}
                    class="w-full min-h-[44px] flex items-center justify-center gap-1.5 px-3 rounded-lg bg-accent/10 text-[11px] font-bold text-accent hover:bg-accent/15 transition cursor-pointer text-center disabled:opacity-50"
                >
                    <CloudUpload size={13} aria-hidden="true" />
                    備份目前行程至 Google Drive
                </button>
            </div>

            {#if gdriveSync.cloudFiles.length > 0}
                <div class="mt-2.5 pt-2 border-t border-line-faint space-y-1.5">
                    <div class="text-[10px] font-semibold text-text-secondary">雲端資料夾行程清單：</div>
                    <ul class="space-y-1.5">
                        {#each gdriveSync.cloudFiles as file (file.id)}
                            <li>
                                {#if confirmingCloudFileId === file.id}
                                    <ConfirmBar
                                        message={yamlInput !== yamlSnapshot
                                        ? `尚有未儲存的變更，載入雲端行程將捨棄這些變更。確定載入「${file.name}」嗎？`
                                        : `確定從 Google Drive 載入「${file.name}」並覆蓋目前行程嗎？`}
                                        confirmLabel="確定載入"
                                        onconfirm={() => handleLoadFromCloud(file.id, file.name)}
                                        oncancel={() => (confirmingCloudFileId = null)}
                                    />
                                {:else if confirmingCloudDeleteFileId === file.id}
                                    <ConfirmBar
                                        message={`確定從 Google Drive 刪除「${file.name}」嗎？此動作無法復原。`}
                                        confirmLabel="確定刪除"
                                        onconfirm={() => handleDeleteCloudTrip(file.id)}
                                        oncancel={() => (confirmingCloudDeleteFileId = null)}
                                    />
                                {:else}
                                    <div class="flex items-center gap-1">
                                        <button
                                            type="button"
                                            onclick={() => (confirmingCloudFileId = file.id)}
                                            class="flex-1 min-w-0 min-h-[44px] flex items-center justify-between gap-2 px-3 rounded-lg bg-tint-1 border border-card-border text-[11px] text-text-secondary hover:text-accent hover:bg-tint-2 transition cursor-pointer"
                                        >
                                            <span class="flex items-center gap-2 min-w-0">
                                                <span class="font-mono text-text-muted shrink-0">{formatBackupTime(file.modifiedTime)}</span>
                                                <span class="font-semibold text-text-primary truncate">{file.name}</span>
                                            </span>
                                            <span class="text-[10px] font-bold shrink-0">載入</span>
                                        </button>
                                        <button
                                            type="button"
                                            onclick={() => (confirmingCloudDeleteFileId = file.id)}
                                            aria-label={`刪除雲端檔案 ${file.name}`}
                                            class="shrink-0 min-w-[44px] min-h-[44px] flex items-center justify-center text-text-muted hover:text-danger transition cursor-pointer"
                                        >
                                            <Trash2 size={14} aria-hidden="true" />
                                        </button>
                                    </div>
                                {/if}
                            </li>
                        {/each}
                    </ul>
                </div>
            {/if}
        </div>
    {/if}

    <div class="text-[10px] text-text-muted leading-normal bg-well p-3 rounded-lg border border-line-faint">
        <p class="flex items-center gap-1 font-bold text-text-primary text-xs">
            <History size={12} class="shrink-0 text-accent" aria-hidden="true" />還原備份
        </p>
        {#if yamlBackups.length === 0}
            <p class="mt-1.5">尚無自動備份。覆蓋行程前會自動保留最近 5 份。</p>
        {:else}
            <ul class="mt-1.5 space-y-1.5">
                {#each yamlBackups as backup (backup.savedAt)}
                    {@const tripName = tripNameFromYaml(backup.yaml)}
                    <li>
                        {#if confirmingBackupSavedAt === backup.savedAt}
                            <ConfirmBar
                                message={yamlInput !== yamlSnapshot
                                ? `尚有未儲存的變更，還原備份將捨棄這些變更。確定還原「${tripName}」的備份嗎？`
                                : `確定要還原「${tripName}」的備份嗎？`}
                                confirmLabel="確定還原"
                                onconfirm={() => executeRestore(backup.savedAt)}
                                oncancel={() => (confirmingBackupSavedAt = null)}
                            />
                        {:else}
                            <button
                                onclick={() => (confirmingBackupSavedAt = backup.savedAt)}
                                class="w-full min-h-[44px] flex items-center justify-between gap-2 px-3 rounded-lg bg-tint-1 border border-card-border text-[11px] text-text-secondary hover:text-accent hover:bg-tint-2 transition cursor-pointer"
                            >
                                <span class="flex items-center gap-2 min-w-0">
                                    <span class="font-mono text-text-muted shrink-0">{formatBackupTime(backup.savedAt)}</span>
                                    <span class="font-semibold text-text-primary truncate">{tripName}</span>
                                </span>
                                <span class="text-[10px] font-bold shrink-0">還原</span>
                            </button>
                        {/if}
                    </li>
                {/each}
            </ul>
        {/if}
    </div>

    <!-- Both of these carry expenses: they are for the trip's owner. Sharing with
         other people is the overview hero's 分享行程, which strips them. -->
    <div class="text-[10px] text-text-muted leading-normal bg-well p-3 rounded-lg border border-line-faint">
        <p class="flex items-center gap-1 font-bold text-text-primary text-xs">
            <Download size={12} class="shrink-0 text-accent" aria-hidden="true" />匯出資料
        </p>
        <p class="mt-1.5">複製成跨裝置連結快速搬移（含記帳），或下載成檔案保存，避免裝置遺失或清除瀏覽器資料時一併消失。</p>
        <div class="grid grid-cols-2 gap-2 mt-2">
            <button
                onclick={onExportUrl}
                class="w-full min-h-[44px] flex items-center justify-center gap-1 px-1.5 rounded-lg bg-accent/10 text-[11px] font-bold text-accent hover:bg-accent/15 transition cursor-pointer text-center"
            >
                <Link2 size={12} class="shrink-0" aria-hidden="true" /> 複製跨裝置連結
            </button>
            <button
                onclick={onExportYaml}
                class="w-full min-h-[44px] flex items-center justify-center gap-1.5 px-2 rounded-lg bg-tint-1 border border-card-border text-[11px] font-bold text-text-secondary hover:text-accent hover:bg-tint-2 transition cursor-pointer text-center"
            >
                <Download size={12} class="shrink-0" aria-hidden="true" /> 匯出行程 YAML
            </button>
        </div>
    </div>

    {#if confirmingReset}
        <ConfirmBar
            message={yamlInput !== yamlSnapshot
            ? "尚有未儲存的變更，回復預設將捨棄這些變更。確定清除自訂 YAML 並恢復為預設行程嗎？"
            : "將清除自訂 YAML，並恢復為專案預設的行程。確定回復？"}
            confirmLabel="確定回復"
            onconfirm={handleReset}
            oncancel={() => (confirmingReset = false)}
        />
    {:else}
        <button
            type="button"
            onclick={() => (confirmingReset = true)}
            class="w-full min-h-[44px] bg-tint-1 border border-card-border text-text-muted text-xs font-bold py-2.5 px-4 rounded-xl hover:text-danger hover:border-danger/40 hover:bg-danger/10 transition cursor-pointer"
        >
            回復預設行程
        </button>
    {/if}
</div>
