<script lang="ts">
import { buildShortShareUrl } from "$lib/domain/share";
import { formatBackupTime } from "$lib/domain/utils";
import { fetchDefaultYamlText } from "$lib/infra/http/itinerary-loader";
import {
    ensureActiveProfileId,
    type ProfileInfo,
    tripNameFromYaml,
    tripStartDateFromYaml,
} from "$lib/infra/storage/profiles";
import {
    listYamlBackups,
    USER_YAML_KEY,
    type YamlBackup,
} from "$lib/infra/storage/yaml-storage";
import { gdriveSync } from "$lib/stores/gdrive.svelte";
import { settingsDraft } from "$lib/stores/settings-draft.svelte";
import { shareLinks } from "$lib/stores/share-link.svelte";
import {
    copyToClipboard,
    showToast,
} from "$lib/stores/toast.svelte";
import {
    type LandOutcome,
    tripStore,
} from "$lib/stores/trip.svelte";
import ConfirmBar from "$lib/ui/shared/ConfirmBar.svelte";
import Ban from "@lucide/svelte/icons/ban";
import CloudAlert from "@lucide/svelte/icons/cloud-alert";
import CloudDownload from "@lucide/svelte/icons/cloud-download";
import CloudOff from "@lucide/svelte/icons/cloud-off";
import CloudSync from "@lucide/svelte/icons/cloud-sync";
import CloudUpload from "@lucide/svelte/icons/cloud-upload";
import Copy from "@lucide/svelte/icons/copy";
import History from "@lucide/svelte/icons/history";
import Lightbulb from "@lucide/svelte/icons/lightbulb";
import RefreshCw from "@lucide/svelte/icons/refresh-cw";
import Share2 from "@lucide/svelte/icons/share-2";
import Sliders from "@lucide/svelte/icons/sliders";
import TriangleAlert from "@lucide/svelte/icons/triangle-alert";
import { onMount } from "svelte";
import ProfileManager from "./ProfileManager.svelte";

// Data flows go straight to `tripStore`; only navigation comes in as props, because the
// host owns the active tab.
interface Props {
    /** Null while the YAML fails to load — this page has to work in exactly that case. */
    activeTripName: string | null;
    /** The parked trips only; the active one is not in this list. */
    profiles: ProfileInfo[];
    /** Leave this page for the itinerary. Every action that lands a trip ends here. */
    onDone: () => void;
    onSwitchProfile: (id: string) => void;
    onCreateProfile: () => void;
    onDeleteProfile: (id: string, name: string) => void;
}

let {
    activeTripName,
    profiles,
    onDone,
    onSwitchProfile,
    onCreateProfile,
    onDeleteProfile,
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

// ensureActiveProfileId, matching persistTripData: this id keys the trip's Drive binding
// and merge base, so a `?? "default"` fallback here would bind a second trip to the
// first one's cloud file. A plain const, not `$derived`: it mints the id on first call,
// and a reactive computation has no business writing storage. Switching profiles
// navigates back to 行程, which destroys this panel, so it cannot go stale.
const activeTripId = ensureActiveProfileId();
// From the persisted copy, not the live editor value: this is a full js-yaml parse, and
// binding it to the textarea ran one per keystroke to move a year-month label.
let activeTripStartDate = $derived(tripStartDateFromYaml(yamlSnapshot) ?? undefined);

let shareLink = $derived(shareLinks.forTrip(activeTripId));
let shareLinkUrl = $derived(shareLink ? buildShortShareUrl(shareLink.id, shareLink.key) : null);
let confirmingRevoke = $state(false);

function revokeShareLink() {
    confirmingRevoke = false;
    void tripStore.revokeShareLink();
}

/** The editor after a successful write: showing exactly what storage holds, with no draft, no error, and the backup list the write just grew. */
function adoptSaved(yaml: string) {
    yamlInput = yaml;
    yamlSnapshot = yaml;
    settingsDraft.yaml = null;
    validationError = null;
    yamlBackups = listYamlBackups();
}

/** YAML the store refused, put where the user can fix it. The store has already seeded the draft; this is the mounted editor catching up. */
function showInvalid(yaml: string, error: string) {
    yamlInput = yaml;
    validationError = error;
}

/** Mirrors a store outcome into the editor. True exactly when a trip landed. */
function applyLanding(outcome: LandOutcome | null): boolean {
    if (outcome?.kind === "landed") adoptSaved(outcome.yaml);
    else if (outcome?.kind === "invalid") showInvalid(outcome.yaml, outcome.error);
    return outcome?.kind === "landed";
}

/** 儲存並解析 — also the import path for a pasted share link. */
async function save() {
    if (saving) return;
    saving = true;
    try {
        const outcome = await tripStore.saveFromEditor(activeTripId, yamlInput);
        switch (outcome.kind) {
            case "landed":
            case "imported":
                adoptSaved(outcome.yaml);
                onDone();
                break;
            case "unchanged":
                onDone();
                break;
            case "invalid":
                // What was typed stays put; only the message changes.
                validationError = outcome.error;
                break;
            case "aborted":
                break;
        }
    } finally {
        saving = false;
    }
}

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
    applyLanding(await tripStore.syncWithCloud(activeTripId, yamlInput));
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
 * Persists an unsaved editor draft before anything uploads it — canonical form, so what
 * goes to Drive carries a `trip.id`. False when the draft does not parse, in which case
 * nothing was written and the error is in the editor.
 */
async function landDraft(): Promise<boolean> {
    if (yamlInput === yamlSnapshot) return true;
    const outcome = await tripStore.landYaml(activeTripId, yamlInput, { canonical: true });
    if (outcome.kind === "invalid") {
        validationError = outcome.error;
        showToast("請先修正編輯器中的 YAML 格式錯誤");
    }
    return applyLanding(outcome);
}

async function handleCloudAction() {
    // An unsaved draft is what the user means by "this trip".
    if (!await landDraft()) return;
    await cloudButton.run?.();
}

async function keepLocalVersion() {
    confirmingConflictSide = null;
    // Through landDraft, so what overwrites the cloud copy is the trip the app is
    // actually running rather than an unvalidated editor buffer.
    if (!await landDraft()) return;
    await tripStore.syncWithCloud(activeTripId, yamlInput, { force: "local" });
}

async function takeCloudVersion() {
    confirmingConflictSide = null;
    applyLanding(await tripStore.syncWithCloud(activeTripId, yamlInput, { force: "remote" }));
}

async function keepBothVersions() {
    confirmingConflictSide = null;
    // Through landDraft, so the copy being preserved is the trip the app is running.
    if (!await landDraft()) return;
    // The editor would otherwise keep showing the copy that just became the parked one.
    if (applyLanding(await tripStore.keepBothVersions(activeTripId, yamlInput))) onDone();
}

async function handleLoadFromCloud(fileId: string, cloudName: string) {
    if (applyLanding(await tripStore.loadCloudTrip(fileId, cloudName))) onDone();
}

let confirmingConflictSide = $state<"local" | "remote" | "both" | null>(null);
let activeConflict = $derived(gdriveSync.conflictFor(activeTripId));

let confirmingBackupSavedAt = $state<string | null>(null);

async function executeRestore(savedAt: string) {
    confirmingBackupSavedAt = null;
    const outcome = await tripStore.restoreBackup(activeTripId, savedAt);
    // A missing entry means the ring moved on; the list is stale either way.
    yamlBackups = listYamlBackups();
    if (applyLanding(outcome)) onDone();
}

let confirmingReset = $state(false);

async function handleReset() {
    confirmingReset = false;
    if (!await tripStore.resetToDefault(activeTripId)) return;
    validationError = null;
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
        onDeleteCloudTrip={fileId => tripStore.deleteCloudTrip(fileId)}
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
            <li>要回到預設的 <a href="./itinerary.yaml" target="_blank" rel="noopener noreferrer" class="text-accent underline hover:text-text-primary transition">itinerary.yaml</a>，用最下方的「回復預設行程」。</li>
            <li>行程存在這台裝置上。產生分享連結時，行程會先在瀏覽器加密，只有密文上傳到短連結服務；連線 Google 雲端硬碟後，同步會把整份行程複製到你自己的 Drive。</li>
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

    <!-- The same link the overview hero's 分享行程 button produces — one per trip, updated in
         place, so a QR code printed from it keeps showing the newest version. -->
    <div class="text-[10px] text-text-muted leading-normal bg-well p-3 rounded-lg border border-line-faint">
        <p class="flex items-center gap-1 font-bold text-text-primary text-xs">
            <Share2 size={12} class="shrink-0 text-accent" aria-hidden="true" />分享連結
        </p>
        {#if shareLink && shareLinkUrl}
            <p class="mt-1.5">
                建立於 {formatBackupTime(shareLink.createdAt)}，最後更新 {formatBackupTime(shareLink.updatedAt)}{shareLink.expiresAt ? `，有效至 ${shareLink.expiresAt.slice(0, 10)}` : ""}。再按一次「更新」會把目前的行程加密上傳到同一條連結，已分享出去的連結與 QR code 不用換。
            </p>
            <div class="grid grid-cols-2 gap-2 mt-2">
                <button
                    onclick={() => void tripStore.shareCurrentTrip()}
                    disabled={tripStore.isSharing}
                    aria-busy={tripStore.isSharing}
                    class="w-full min-h-[44px] flex items-center justify-center gap-1 px-1.5 rounded-lg bg-accent/10 text-[11px] font-bold text-accent hover:bg-accent/15 transition cursor-pointer text-center disabled:opacity-40 disabled:cursor-wait"
                >
                    <RefreshCw size={12} class="shrink-0" aria-hidden="true" /> 更新分享連結
                </button>
                <button
                    onclick={() => copyToClipboard(shareLinkUrl, "已複製分享連結")}
                    class="w-full min-h-[44px] flex items-center justify-center gap-1.5 px-2 rounded-lg bg-tint-1 border border-card-border text-[11px] font-bold text-text-secondary hover:text-accent hover:bg-tint-2 transition cursor-pointer text-center"
                >
                    <Copy size={12} class="shrink-0" aria-hidden="true" /> 複製分享連結
                </button>
            </div>
            {#if confirmingRevoke}
                <div class="mt-2">
                    <ConfirmBar
                        message="撤銷後會刪除短連結服務上的加密內容，所有拿到這條連結或 QR code 的人都無法再開啟。確定撤銷？"
                        confirmLabel="確定撤銷"
                        onconfirm={revokeShareLink}
                        oncancel={() => (confirmingRevoke = false)}
                    />
                </div>
            {:else}
                <button
                    type="button"
                    onclick={() => (confirmingRevoke = true)}
                    disabled={tripStore.isSharing}
                    class="w-full min-h-[44px] mt-2 flex items-center justify-center gap-1 rounded-lg text-[11px] font-bold text-text-muted hover:text-danger hover:bg-danger/10 transition cursor-pointer disabled:opacity-40"
                >
                    <Ban size={12} class="shrink-0" aria-hidden="true" /> 撤銷分享連結
                </button>
            {/if}
        {:else}
            <p class="mt-1.5">這趟行程還沒有分享連結。建立後會得到一條加密短連結，之後每次再分享都會更新同一條連結，做成 QR code 也不會過時。</p>
            <button
                onclick={() => void tripStore.shareCurrentTrip()}
                disabled={tripStore.isSharing}
                aria-busy={tripStore.isSharing}
                class="w-full min-h-[44px] mt-2 flex items-center justify-center gap-1 px-1.5 rounded-lg bg-accent/10 text-[11px] font-bold text-accent hover:bg-accent/15 transition cursor-pointer text-center disabled:opacity-40 disabled:cursor-wait"
            >
                <Share2 size={12} class="shrink-0" aria-hidden="true" /> 建立分享連結
            </button>
        {/if}
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
