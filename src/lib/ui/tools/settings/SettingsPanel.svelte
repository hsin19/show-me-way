<script lang="ts">
import { parseShareLink } from "$lib/domain/share";
import {
    serializeToYaml,
    type TripData,
    validateYaml,
} from "$lib/domain/trip";
import { formatBackupTime } from "$lib/domain/utils";
import { fetchDefaultYamlText } from "$lib/infra/http/itinerary-loader";
import { resolveShareLink } from "$lib/infra/http/share-link";
import {
    ensureActiveProfileId,
    isActiveProfile,
    type ProfileInfo,
    tripNameFromYaml,
    tripStartDateFromYaml,
} from "$lib/infra/storage/profiles";
import { importSharedTrip } from "$lib/infra/storage/share-import";
import {
    backupCurrentYaml,
    getYamlBackup,
    listYamlBackups,
    USER_YAML_KEY,
    type YamlBackup,
} from "$lib/infra/storage/yaml-storage";
import { gdriveSync } from "$lib/stores/gdrive.svelte";
import { settingsDraft } from "$lib/stores/settings-draft.svelte";
import {
    copyToClipboard,
    showToast,
} from "$lib/stores/toast.svelte";
import ConfirmBar from "$lib/ui/shared/ConfirmBar.svelte";
import CloudAlert from "@lucide/svelte/icons/cloud-alert";
import CloudDownload from "@lucide/svelte/icons/cloud-download";
import CloudOff from "@lucide/svelte/icons/cloud-off";
import CloudSync from "@lucide/svelte/icons/cloud-sync";
import CloudUpload from "@lucide/svelte/icons/cloud-upload";
import Copy from "@lucide/svelte/icons/copy";
import Download from "@lucide/svelte/icons/download";
import History from "@lucide/svelte/icons/history";
import Lightbulb from "@lucide/svelte/icons/lightbulb";
import Link2 from "@lucide/svelte/icons/link-2";
import Sliders from "@lucide/svelte/icons/sliders";
import TriangleAlert from "@lucide/svelte/icons/triangle-alert";
import { onMount } from "svelte";
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
    /** 兩份都留: park `yaml` as a trip of its own. Called only once the cloud copy has landed. */
    onBranchLocalCopy: (yaml: string) => Promise<void>;
    onExportYaml: () => void;
    onExportUrl: () => void;
    /** True while `onExportUrl` is mid-flight — a hop round trip — so its button disables. */
    sharing?: boolean;
}

let {
    activeTripName,
    profiles,
    onReload,
    onDone,
    onSwitchProfile,
    onCreateProfile,
    onDeleteProfile,
    onBranchLocalCopy,
    onExportYaml,
    onExportUrl,
    sharing = false,
}: Props = $props();

let yamlInput = $state("");
let validationError = $state<string | null>(null);
// A pasted short link makes save() a network round trip; this keeps a second tap
// from running importSharedTrip twice and stacking two confirm dialogs.
let saving = $state(false);
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
    if (saving) return;
    saving = true;
    try {
        const link = parseShareLink(yamlInput);
        // A short link needs a network round trip, so stillActive() below now guards
        // a much longer await than it used to — leave it where it is. resolveShareLink
        // rejects with finished zh-TW copy, so the catch below can show it verbatim.
        const yaml = link === null ? yamlInput : await resolveShareLink(link);
        const parsed = validateYaml(yaml);
        if (!stillActive()) return;
        if (link) {
            await landSharedLink(parsed);
            return;
        }
        // Store what was parsed, not what was typed, so the editor shows the
        // canonical form from here on.
        const tidied = serializeToYaml(parsed);
        if (!safeSetUserYaml(tidied)) return;
        yamlInput = tidied;
        yamlSnapshot = tidied;
        settingsDraft.yaml = null;
        validationError = null;

        gdriveSync.scheduleSync(tidied, activeTripId);

        showToast("自訂 YAML 行程儲存成功！");
        await onReload();
        onDone();
    } catch (err) {
        console.error("YAML Validation failed:", err);
        validationError = err instanceof Error ? err.message : "YAML 格式錯誤，請檢查縮排！";
    } finally {
        saving = false;
    }
}

/**
 * A share link pasted into the editor is a whole trip with its own identity, not new
 * contents for this slot — so it goes through the same branching as the `#s=` hash rather
 * than being written straight into `USER_YAML_KEY`, which would leave the incoming trip
 * wearing this one's Drive binding and PATCH a stranger's cloud file on the next sync.
 */
async function landSharedLink(parsed: TripData) {
    const outcome = importSharedTrip(parsed);
    if (outcome.kind === "declined") return;
    yamlInput = outcome.yaml;
    yamlSnapshot = outcome.yaml;
    settingsDraft.yaml = null;
    validationError = null;
    yamlBackups = listYamlBackups();
    // `outcome.profileId`, never `activeTripId`: an import moves the active slot, and
    // that const was captured before it did.
    gdriveSync.scheduleSync(outcome.yaml, outcome.profileId);
    showToast(
        outcome.kind === "overwritten"
            ? "已用分享連結更新行程，可在行程管理還原前一版"
            : "已從分享連結匯入為新行程",
    );
    await onReload();
    onDone();
}

// ensureActiveProfileId, matching persistTripData: this id keys the trip's Drive binding
// and merge base, so a `?? "default"` fallback here would bind a second trip to the
// first one's cloud file. A plain const, not `$derived`: it mints the id on first call,
// and a reactive computation has no business writing storage. Switching profiles
// navigates back to 行程, which destroys this panel, so it cannot go stale.
const activeTripId = ensureActiveProfileId();
// From the persisted copy, not the live editor value: this is a full js-yaml parse, and
// binding it to the textarea ran one per keystroke to move a year-month label.
let activeTripStartDate = $derived(tripStartDateFromYaml(yamlSnapshot) ?? undefined);

/** Login is this tap's whole job — whatever the button turns into next (上傳/同步/下載) is a separate, explicit tap once connected. */
async function loginToCloud() {
    await gdriveSync.connect();
}

/** Only asks Drive and updates the button (or the conflict strip below) — never transfers anything itself. */
async function checkCloudStatus() {
    await gdriveSync.sync(yamlInput, activeTripId, { checkOnly: true });
}

/**
 * What "上傳" and "下載" both actually do: the same plain `sync()`. It re-decides from
 * scratch and acts, so a still-safe push/pull goes through, and anything that moved out
 * from under it (e.g. an edit typed while "下載" was on offer) turns into a `conflict`
 * instead of blindly transferring — one reconcile covers both directions.
 */
async function reconcileCloudTrip() {
    const res = await gdriveSync.sync(yamlInput, activeTripId);
    if (res?.action === "pulled" && res.yaml && await landPulled(res.yaml)) res.commit?.();
}

/**
 * The UI half of the header's cloud button: `cloudActionFor` decides what the next tap
 * means, this maps that decision onto icon, label, and handler — computed once so the
 * template and `handleCloudAction` both read the same answer. `run` is `null` exactly
 * when `disabled` is true: those states have nothing a tap could do.
 */
let cloudButton = $derived.by(() => {
    const action = gdriveSync.cloudActionFor(activeTripId, yamlInput);
    switch (action.kind) {
        case "connecting":
            return { icon: CloudSync, iconClass: "animate-spin text-accent", disabled: true, label: "連線 Google 雲端硬碟中…", run: null };
        case "busy": {
            const icon = action.phase === "pushing" ? CloudUpload : action.phase === "pulling" ? CloudDownload : CloudSync;
            const label = action.phase === "pushing"
                ? "正在上傳到 Google Drive…"
                : action.phase === "pulling"
                ? "正在從 Google Drive 下載…"
                : "正在比對雲端版本…";
            return { icon, iconClass: "animate-spin text-accent", disabled: true, label, run: null };
        }
        case "conflict":
            return { icon: CloudAlert, iconClass: "text-danger", disabled: true, label: "請先在下方解決雲端衝突", run: null };
        case "login":
            return { icon: CloudOff, iconClass: "", disabled: false, label: "登入 Google 雲端硬碟", run: loginToCloud };
        case "upload":
            return {
                icon: CloudUpload,
                iconClass: action.overwrite ? "text-accent" : "",
                disabled: false,
                label: action.overwrite ? "上傳本機異動到 Google Drive (覆蓋雲端版本)" : "上傳此行程至 Google Drive (建立新檔案)",
                run: reconcileCloudTrip,
            };
        case "download":
            return { icon: CloudDownload, iconClass: "text-accent", disabled: false, label: "下載雲端最新版本 (覆蓋本機)", run: reconcileCloudTrip };
        case "check":
            return { icon: CloudSync, iconClass: "text-accent", disabled: false, label: "同步行程 (比對本地與雲端內容差異)", run: checkCloudStatus };
    }
});

/**
 * Whether it is still safe for this panel's pending async work to write the active trip:
 * every function below runs across at least one `await`, and `activeTripId` — fixed at
 * mount — cannot itself notice a profile switch that happened during that gap (switching
 * normally unmounts this panel, but an already-in-flight closure keeps running regardless).
 * Call this again right before every `USER_YAML_KEY` write, not just once up front.
 */
function stillActive(): boolean {
    if (isActiveProfile(activeTripId)) return true;
    showToast("行程已切換，此操作已取消");
    return false;
}

/** The one place that writes USER_YAML_KEY, so a quota/storage failure is always reported instead of left as an unhandled rejection. */
function safeSetUserYaml(yaml: string): boolean {
    try {
        backupCurrentYaml();
        localStorage.setItem(USER_YAML_KEY, yaml);
        return true;
    } catch (err) {
        console.error("Failed to persist YAML:", err);
        showToast("儲存失敗，請稍後再試");
        return false;
    }
}

/**
 * Persists an unsaved editor draft before anything uploads it. Returns false when the
 * draft does not parse, in which case nothing was written.
 *
 * Same backup and reload as `save()`: without them the app keeps serving the pre-draft
 * trip from memory and the next `persistTripData` writes that stale copy back over
 * whatever was just synced.
 */
async function landDraft(): Promise<boolean> {
    if (yamlInput === yamlSnapshot) return true;
    let tidied: string;
    try {
        // Serialized, not stored as typed, for the same reason `save()` does it — and
        // here it is load-bearing rather than cosmetic: a hand-written trip has no
        // `trip.id` until `normalizeTripData` mints one, and uploading those raw bytes
        // puts a file on Drive with no identity for `reconcileBindings` to ever match.
        tidied = serializeToYaml(validateYaml(yamlInput));
    } catch (err) {
        console.error("Draft YAML Validation failed:", err);
        validationError = err instanceof Error ? err.message : "YAML 格式錯誤，請修正後再同步！";
        showToast("請先修正編輯器中的 YAML 格式錯誤");
        return false;
    }
    if (!stillActive() || !safeSetUserYaml(tidied)) return false;
    yamlInput = tidied;
    yamlSnapshot = tidied;
    settingsDraft.yaml = null;
    validationError = null;
    yamlBackups = listYamlBackups();
    await onReload();
    return true;
}

async function handleCloudAction() {
    // An unsaved draft is what the user means by "this trip".
    if (!await landDraft()) return;
    await cloudButton.run?.();
}

/** Persists a copy `sync` pulled from Drive, backing up what it replaces. False when nothing was written. */
async function landPulled(yaml: string): Promise<boolean> {
    try {
        validateYaml(yaml);
    } catch (e) {
        console.error("Downloaded cloud YAML validation failed:", e);
        // Into the draft, not just the textarea: the draft is what survives a sub-tab
        // switch, and without it the content the toast asks the user to fix is gone.
        yamlInput = yaml;
        settingsDraft.yaml = yaml;
        validationError = e instanceof Error ? e.message : "雲端 YAML 格式錯誤，請檢查！";
        showToast("下載的雲端行程格式有誤，已載入編輯器，請修正後再儲存");
        return false;
    }
    // The realistic case for this guard: sync() ran across a real network round trip,
    // during which the user switched to a different trip via the still-mounted
    // ProfileManager above — landing the pulled bytes now would overwrite that trip.
    if (!stillActive() || !safeSetUserYaml(yaml)) return false;
    yamlInput = yaml;
    yamlSnapshot = yaml;
    settingsDraft.yaml = null;
    validationError = null;
    yamlBackups = listYamlBackups();
    await onReload();
    return true;
}

async function keepLocalVersion() {
    confirmingConflictSide = null;
    // Through landDraft, so what overwrites the cloud copy is the trip the app is
    // actually running rather than an unvalidated editor buffer.
    if (!await landDraft()) return;
    await gdriveSync.sync(yamlInput, activeTripId, { force: "local" });
}

async function takeCloudVersion() {
    confirmingConflictSide = null;
    const res = await gdriveSync.sync(yamlInput, activeTripId, { force: "remote" });
    if (res?.action === "pulled" && res.yaml && await landPulled(res.yaml)) res.commit?.();
}

/**
 * 兩份都留 — the resolution that discards neither side. The cloud copy takes this trip's
 * slot, keeping its id and Drive binding, and what was here is parked as a trip of its own.
 *
 * Order is the whole trick: the local YAML is read out of storage before the pull
 * overwrites it, and the branch only happens once those cloud bytes have actually landed —
 * a pull that failed validation, or a trip switched out from under the round trip, must
 * leave one copy rather than fork off a second.
 */
async function keepBothVersions() {
    confirmingConflictSide = null;
    // Through landDraft, so the copy being preserved is the trip the app is running.
    if (!await landDraft()) return;
    const localYaml = localStorage.getItem(USER_YAML_KEY);
    if (localYaml === null) return;
    const res = await gdriveSync.sync(yamlInput, activeTripId, { force: "remote" });
    if (res?.action !== "pulled" || !res.yaml) return;
    if (!await landPulled(res.yaml)) return;
    res.commit?.();
    await onBranchLocalCopy(localYaml);
    // The editor still shows the copy that just became the parked one.
    onDone();
}

async function handleLoadFromCloud(fileId: string, cloudName: string) {
    const result = await gdriveSync.importCloudTripAsProfile(fileId);
    if (!result) return;
    if (!result.ok) {
        console.error("Cloud YAML validation failed:", result.error);
        yamlInput = result.yaml;
        settingsDraft.yaml = result.yaml;
        validationError = result.error;
        showToast("此雲端行程格式有誤，已載入編輯器，請修正後再儲存");
        return;
    }
    yamlInput = result.yaml;
    yamlSnapshot = result.yaml;
    settingsDraft.yaml = null;
    validationError = null;
    showToast(`已從 Google Drive 載入「${cloudName}」為新行程`);
    await onReload();
    onDone();
}

async function handleDeleteCloudTrip(fileId: string) {
    await gdriveSync.deleteTrip(fileId);
}

let confirmingConflictSide = $state<"local" | "remote" | "both" | null>(null);
let activeConflict = $derived(gdriveSync.conflictFor(activeTripId));

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
    if (!stillActive() || !safeSetUserYaml(yaml)) return;
    settingsDraft.yaml = null;
    validationError = null;
    showToast("已還原備份的行程");
    await onReload();
    onDone();
}

let confirmingReset = $state(false);

async function handleReset() {
    confirmingReset = false;
    if (!stillActive()) return;
    try {
        backupCurrentYaml();
        localStorage.removeItem(USER_YAML_KEY);
    } catch (err) {
        console.error("Failed to reset trip data:", err);
        showToast("重設失敗，請稍後再試");
        return;
    }
    // Unbind rather than mark dirty: this discards the trip, and marking it dirty would
    // arm an auto-sync that pushes the bundled default template over the user's cloud
    // itinerary. The Drive copy survives and reappears in the 雲端行程 list.
    gdriveSync.unbindTrip(activeTripId);
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
            disabled={cloudButton.disabled}
            onclick={handleCloudAction}
            aria-label={cloudButton.label}
            title={cloudButton.label}
            class="min-w-[40px] min-h-[40px] flex items-center justify-center rounded-xl bg-tint-1 border border-card-border text-text-secondary hover:text-accent hover:bg-tint-2 transition cursor-pointer disabled:opacity-40"
        >
            <cloudButton.icon size={18} class={cloudButton.iconClass} aria-hidden="true" />
        </button>
    </div>
</div>

{#if activeConflict}
    <div class="mb-2.5">
        {#if confirmingConflictSide === "local"}
            <ConfirmBar
                message={`確定以本機版本覆蓋雲端的「${activeConflict.fileName}」嗎？其他裝置寫入雲端的修改會被取代。`}
                confirmLabel="覆蓋雲端"
                onconfirm={() => void keepLocalVersion()}
                oncancel={() => (confirmingConflictSide = null)}
            />
        {:else if confirmingConflictSide === "both"}
            <ConfirmBar
                message={`確定兩份都留嗎？這台裝置的版本會另存成一個新行程，雲端的「${activeConflict.fileName}」則成為這趟行程的內容。`}
                confirmLabel="兩份都留"
                onconfirm={() => void keepBothVersions()}
                oncancel={() => (confirmingConflictSide = null)}
            />
        {:else if confirmingConflictSide === "remote"}
            <ConfirmBar
                message={activeConflict.kind === "both-changed"
                ? `確定改用雲端的「${activeConflict.fileName}」嗎？本機尚未同步的修改會被取代，還原前會先存一份備份。`
                : `確定載入雲端的「${activeConflict.fileName}」嗎？載入前會先存一份備份。`}
                confirmLabel="採用雲端"
                onconfirm={() => void takeCloudVersion()}
                oncancel={() => (confirmingConflictSide = null)}
            />
        {:else}
            <!-- Both sides diverged from the last synced copy. Nothing was changed on
                 either side; automatic sync stays paused for this trip until the user
                 picks, so a background save cannot decide it for them. -->
            {@const conflictMessage = activeConflict.kind === "both-changed"
            ? `「${activeConflict.fileName}」在雲端和這台裝置上都改過，自動同步已暫停。請選擇要保留哪一份。`
            : `「${activeConflict.fileName}」的雲端版本比這台裝置新，自動同步已暫停。請選擇要載入雲端版本，或保留這台裝置的內容。`}
            <div role="alertdialog" aria-label={conflictMessage} class="rounded-xl border border-danger/40 bg-danger/10 p-2.5">
                <p class="flex items-start gap-1.5 text-[11px] font-medium text-danger leading-normal">
                    <TriangleAlert size={14} class="shrink-0 mt-px" aria-hidden="true" />
                    {conflictMessage}
                </p>
                <div class="mt-2 flex gap-2">
                    <button
                        type="button"
                        disabled={gdriveSync.isSyncing}
                        onclick={() => (confirmingConflictSide = "remote")}
                        class="flex-1 min-h-[44px] rounded-lg bg-accent text-accent-contrast text-xs font-bold cursor-pointer hover:opacity-90 transition duration-200 disabled:opacity-40"
                    >
                        採用雲端版本
                    </button>
                    <button
                        type="button"
                        disabled={gdriveSync.isSyncing}
                        onclick={() => (confirmingConflictSide = "local")}
                        class="flex-1 min-h-[44px] rounded-lg bg-tint-2 text-text-secondary text-xs font-bold border border-card-border hover:bg-tint-3 transition duration-200 cursor-pointer disabled:opacity-40"
                    >
                        保留本機版本
                    </button>
                </div>
                {#if activeConflict.kind === "both-changed"}
                    <!-- Only for a real divergence: `remote-newer` means this device changed
                         nothing, so there is no second version to keep. Full width below the
                         pair rather than a third column, which would not fit a phone. -->
                    <button
                        type="button"
                        disabled={gdriveSync.isSyncing}
                        onclick={() => (confirmingConflictSide = "both")}
                        class="mt-2 w-full min-h-[44px] rounded-lg bg-tint-1 text-text-secondary text-xs font-bold border border-card-border hover:bg-tint-2 transition duration-200 cursor-pointer disabled:opacity-40"
                    >
                        兩份都留（本機版另存為新行程）
                    </button>
                {/if}
            </div>
        {/if}
    </div>
{/if}

<div class="mb-2.5">
    <ProfileManager
        activeTripName={activeTripName ?? "（尚未載入）"}
        activeTripStartDate={activeTripStartDate}
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
                <button
                    onclick={() => copyToClipboard(yamlInput, "已複製編輯器中的 YAML")}
                    class="text-[11px] font-bold text-text-muted min-h-[44px] flex items-center gap-1 hover:text-accent cursor-pointer"
                >
                    <Copy size={12} aria-hidden="true" /> 複製
                </button>
            </div>
        </div>

        <!-- spellcheck/autocapitalize off because every YAML key is lower case: a phone
             keyboard would otherwise capitalise each line and red-underline every
             identifier. overscroll-contain stops a scroll that reaches the end of the
             textarea from chaining to the page and triggering pull-to-refresh. Height is
             viewport-relative so a small phone still gets a usable editor. -->
        <textarea
            id="yaml-editor"
            bind:value={yamlInput}
            oninput={markDraft}
            spellcheck="false"
            autocapitalize="off"
            class="w-full h-[45dvh] min-h-[240px] bg-well-deep border border-card-border rounded-xl p-3 font-mono text-xs text-text-primary outline-none focus:border-accent transition resize-none overflow-y-auto overscroll-contain leading-relaxed shadow-inner"
            placeholder="貼上你的 YAML 行程，或直接貼上分享連結…"
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
                disabled={saving}
                aria-busy={saving}
                class="flex-1 min-h-[44px] bg-accent text-accent-contrast font-bold py-2.5 px-4 rounded-xl hover:opacity-90 transition active:scale-[0.98] cursor-pointer shadow-sm text-center disabled:opacity-40 disabled:cursor-wait"
            >
                {saving ? "解析中…" : "儲存並解析"}
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

    <!-- The editor's share-link sniffing, the clear-to-default behaviour, and where the
         data goes. That last line, the share toasts and public/privacy.html are the
         places that say the itinerary leaves the device — keep them agreeing with what
         sync and the short link actually upload. -->
    <div class="text-[10px] text-text-muted leading-normal bg-well p-3 rounded-lg border border-line-faint">
        <p class="flex items-center gap-1 font-bold text-text-primary text-xs">
            <Lightbulb size={12} class="shrink-0 text-accent" aria-hidden="true" />編輯器與匯入說明
        </p>
        <ul class="list-disc pl-4 mt-1.5 space-y-1.5">
            <li>貼上 YAML 行程內容，或他人的分享連結，按「儲存並解析」即可匯入；原本的行程會留在下方的備份紀錄。</li>
            <li>清空並儲存會還原為預設的 <a href="./itinerary.yaml" target="_blank" rel="noopener noreferrer" class="text-accent underline hover:text-text-primary transition">itinerary.yaml</a>。</li>
            <li>行程存在這台裝置上。產生分享連結時，行程會先在瀏覽器加密，只有密文上傳到短連結服務；連線 Google 雲端硬碟後，同步會把整份行程（含記帳明細）複製到你自己的 Drive。</li>
            <li>
                可用此指令安裝行程小幫手 Skill：
                <div class="bg-well-deep border border-line rounded px-2 py-1 mt-1 font-mono text-[10px] select-all break-all text-text-primary">
                    npx skills add https://github.com/hsin19/show-me-way --skill itinerary-yaml-builder
                </div>
            </li>
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
                disabled={sharing}
                aria-busy={sharing}
                class="w-full min-h-[44px] flex items-center justify-center gap-1 px-1.5 rounded-lg bg-accent/10 text-[11px] font-bold text-accent hover:bg-accent/15 transition cursor-pointer text-center disabled:opacity-40 disabled:cursor-wait"
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
