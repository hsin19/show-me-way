<script lang="ts">
import CloudSync from "@lucide/svelte/icons/cloud-sync";
import CloudUpload from "@lucide/svelte/icons/cloud-upload";
import Download from "@lucide/svelte/icons/download";
import History from "@lucide/svelte/icons/history";
import Lightbulb from "@lucide/svelte/icons/lightbulb";
import Link2 from "@lucide/svelte/icons/link-2";
import Sliders from "@lucide/svelte/icons/sliders";
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
import {
    getCloudFileIdForTrip,
    setTripLocalModifiedTime,
} from "../gdrive";
import { gdriveSync } from "../gdrive.svelte";
import {
    createProfile,
    getActiveProfileId,
    type ProfileInfo,
    tripNameFromYaml,
} from "../profiles";
import { settingsDraft } from "../settings-draft.svelte";
import {
    decodeShareToken,
    parseShareToken,
} from "../share";
import { showToast } from "../toast.svelte";
import { formatBackupTime } from "../utils";
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
        setTripLocalModifiedTime(activeTripId, Date.now());
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

let activeTripId = $derived(getActiveProfileId() ?? "default");
let boundCloudFileId = $derived(
    gdriveSync.isConnected ? getCloudFileIdForTrip(activeTripId) : null,
);
let isBoundToCloud = $derived(
    gdriveSync.isConnected && !!boundCloudFileId && gdriveSync.cloudFiles.some(f => f.id === boundCloudFileId),
);

async function handleCloudAction() {
    const tripName = tripNameFromYaml(yamlInput);
    if (!gdriveSync.isConnected) {
        const connected = await gdriveSync.connect();
        if (!connected) return;
        await gdriveSync.smartSyncTrip(tripName, yamlInput, activeTripId);
        return;
    }

    const res = await gdriveSync.smartSyncTrip(tripName, yamlInput, activeTripId);
    if (res?.action === "downloaded" && res.downloadedYaml) {
        try {
            validateYaml(res.downloadedYaml);
            backupCurrentYaml();
            localStorage.setItem(USER_YAML_KEY, res.downloadedYaml);
            yamlInput = res.downloadedYaml;
            yamlSnapshot = res.downloadedYaml;
            settingsDraft.yaml = null;
            validationError = null;
            await onReload();
        } catch (e) {
            console.error("Downloaded cloud YAML validation failed:", e);
            showToast("下載的雲端行程格式有誤，已載入編輯器");
            yamlInput = res.downloadedYaml;
        }
    }
}

async function handleLoadFromCloud(fileId: string, cloudName: string) {
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
    const newActiveId = createProfile(yaml);
    gdriveSync.bindTripToFile(newActiveId, fileId);
    const cloudFile = gdriveSync.cloudFiles.find(f => f.id === fileId);
    if (cloudFile) {
        setTripLocalModifiedTime(newActiveId, new Date(cloudFile.modifiedTime).getTime());
    }
    yamlInput = yaml;
    yamlSnapshot = yaml;
    settingsDraft.yaml = null;
    validationError = null;
    showToast(`已從 Google Drive 載入「${cloudName}」為新行程`);
    await onReload();
    onDone();
}

async function handleDeleteCloudTrip(fileId: string) {
    await gdriveSync.deleteTrip(fileId);
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

<div class="mb-4 flex items-center justify-between gap-2">
    <div>
        <h2 class="text-xl font-extrabold text-text-primary tracking-tight flex items-center gap-2">
            <Sliders size={22} class="text-accent" aria-hidden="true" />行程管理
        </h2>
        <p class="text-xs text-text-secondary mt-0.5">切換行程、直接編輯行程資料，儲存後立即套用</p>
    </div>
    <div class="flex items-center gap-1.5 shrink-0">
        <button
            type="button"
            disabled={gdriveSync.isSyncing || gdriveSync.isConnecting}
            onclick={handleCloudAction}
            aria-label={!gdriveSync.isConnected
            ? "登入 Google 雲端硬碟並上傳"
            : isBoundToCloud
            ? "同步行程 (比較本地與雲端更新時間)"
            : "上傳此行程至 Google Drive (建立新檔案)"}
            title={!gdriveSync.isConnected
            ? "登入 Google 雲端硬碟並上傳"
            : isBoundToCloud
            ? "同步行程 (比較本地與雲端更新時間)"
            : "上傳此行程至 Google Drive (建立新檔案)"}
            class="min-w-[40px] min-h-[40px] flex items-center justify-center rounded-xl bg-tint-1 border border-card-border text-text-secondary hover:text-accent hover:bg-tint-2 transition cursor-pointer disabled:opacity-40"
        >
            {#if gdriveSync.isSyncing || gdriveSync.isConnecting}
                <CloudSync size={18} class="animate-spin text-accent" aria-hidden="true" />
            {:else if isBoundToCloud}
                <CloudSync size={18} class="text-accent" aria-hidden="true" />
            {:else}
                <CloudUpload size={18} aria-hidden="true" />
            {/if}
        </button>
    </div>
</div>

<div class="mb-2.5">
    <ProfileManager
        activeTripName={activeTripName ?? "（尚未載入）"}
        {profiles}
        {onSwitchProfile}
        {onCreateProfile}
        {onDeleteProfile}
        onLoadCloudTrip={handleLoadFromCloud}
        onDeleteCloudTrip={handleDeleteCloudTrip}
    />
</div>

<div class="flex flex-col gap-2.5 text-xs">
    <div class="flex flex-col gap-1.5">
        <div class="flex justify-between items-center">
            <label for="yaml-editor" class="font-bold text-text-primary">行程資料 (YAML)</label>
            <!-- 44px hot zones grown in-flow (no -mx), so adjacent ones cannot
                 overlap; the -mb is capped at the 6px gap so they stop short of
                 the textarea. -->
            <div class="flex gap-2 -mb-1.5">
                <button
                    onclick={selectAll}
                    class="text-[11px] font-bold text-accent min-h-[44px] flex items-center hover:underline cursor-pointer"
                >
                    全選
                </button>
                <button
                    onclick={clearEditor}
                    class="text-[11px] font-bold text-text-muted min-h-[44px] flex items-center hover:text-danger cursor-pointer"
                >
                    清空
                </button>
            </div>
        </div>

        <textarea
            id="yaml-editor"
            bind:value={yamlInput}
            oninput={markDraft}
            class="w-full h-80 bg-well-deep border border-card-border rounded-xl p-3 font-mono text-xs text-text-primary outline-none focus:border-accent transition resize-y leading-relaxed shadow-inner"
            placeholder="請貼上您的行程 YAML 內容…"
        ></textarea>

        {#if validationError}
            <div role="alert" class="p-3 bg-danger/10 border border-danger/30 rounded-xl text-danger text-xs flex items-start gap-2">
                <TriangleAlert size={14} class="shrink-0 mt-0.5" aria-hidden="true" />
                <div class="flex-1 whitespace-pre-wrap">{validationError}</div>
            </div>
        {/if}

        <div class="flex items-center gap-2 mt-1">
            <button
                onclick={() => void save()}
                class="flex-1 min-h-[44px] bg-accent text-accent-contrast font-bold py-2.5 px-4 rounded-xl hover:opacity-90 transition active:scale-[0.98] cursor-pointer shadow-sm text-center"
            >
                儲存並解析
            </button>
            {#if yamlInput !== yamlSnapshot}
                <button
                    onclick={discardDraft}
                    class="min-h-[44px] bg-tint-1 border border-card-border text-text-secondary hover:text-text-primary font-bold py-2.5 px-4 rounded-xl hover:bg-tint-2 transition active:scale-[0.98] cursor-pointer text-center"
                >
                    放棄變更
                </button>
            {/if}
        </div>
    </div>

    <!-- Quick instructions on the editor's share-link sniffing behavior. -->
    <div class="text-[10px] text-text-muted leading-normal bg-well p-3 rounded-lg border border-line-faint">
        <p class="flex items-center gap-1 font-bold text-text-primary text-xs">
            <Lightbulb size={12} class="shrink-0 text-accent" aria-hidden="true" />分享連結匯入說明
        </p>
        <ul class="list-disc list-inside mt-1.5 space-y-1">
            <li>若收到他人分享的行程網址，直接將整串網址貼在上方編輯器，點擊「儲存並解析」即可匯入。</li>
            <li>匯入成功後會自動套用該行程，同時保留原本的備份紀錄。</li>
        </ul>
    </div>

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
                                variant="accent"
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
