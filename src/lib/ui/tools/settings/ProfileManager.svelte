<script lang="ts">
import {
    compareTripDates,
    formatYearMonth,
    isTripLongPast,
} from "$lib/domain/utils";
import {
    getActiveProfileId,
    type ProfileInfo,
} from "$lib/infra/storage/profiles";
import { gdriveSync } from "$lib/stores/gdrive.svelte";
import { shareLinks } from "$lib/stores/share-link.svelte";
import { tripOrigins } from "$lib/stores/trip-origin.svelte";
import ConfirmBar from "$lib/ui/shared/ConfirmBar.svelte";
import ChevronDown from "@lucide/svelte/icons/chevron-down";
import Cloud from "@lucide/svelte/icons/cloud";
import CloudOff from "@lucide/svelte/icons/cloud-off";
import History from "@lucide/svelte/icons/history";
import Layers from "@lucide/svelte/icons/layers";
import LogIn from "@lucide/svelte/icons/log-in";
import Plus from "@lucide/svelte/icons/plus";
import RefreshCw from "@lucide/svelte/icons/refresh-cw";
import Share2 from "@lucide/svelte/icons/share-2";
import Trash2 from "@lucide/svelte/icons/trash-2";
import UsersRound from "@lucide/svelte/icons/users-round";

// Rendered by two hosts, so an edit here changes both: collapsed at the top of
// 行程管理, where it owns `expanded`, and forced open in TripOverview's drawer,
// where the host owns it via `onToggleExpand`.
interface Props {
    activeTripName: string;
    activeTripStartDate?: string;
    profiles: ProfileInfo[];
    /** Bindable, or driven by the host together with `onToggleExpand`. */
    expanded?: boolean;
    onSwitchProfile: (id: string) => void;
    onCreateProfile: () => void;
    /** Called only after the inline confirm — this is the app's only guard on a profile delete. */
    onDeleteProfile: (id: string, name: string) => void;
    onToggleExpand?: () => void;
    /** Required: the fallback used to download a trip and discard it. */
    onLoadCloudTrip: (fileId: string, fileName: string) => void | Promise<void>;
    onDeleteCloudTrip: (fileId: string) => void | Promise<void>;
}

let {
    activeTripName,
    activeTripStartDate,
    profiles,
    expanded = $bindable(false),
    onSwitchProfile,
    onCreateProfile,
    onDeleteProfile,
    onToggleExpand,
    onLoadCloudTrip,
    onDeleteCloudTrip,
}: Props = $props();

let confirmingDeleteProfileId = $state<string | null>(null);
let confirmingCloudFileId = $state<string | null>(null);
let confirmingCloudDeleteFileId = $state<string | null>(null);

// Reads `profiles` for the dependency alone: TripStore.load replaces that array on every
// landing, and the slot id has no rune of its own. Without it a host that stays mounted
// through an import — pasting a share link into the editor below never remounts this —
// would go on marking the header against the trip that just moved out of the active slot.
let activeProfileId = $derived.by(() => {
    void profiles;
    return getActiveProfileId() ?? "default";
});
let activeTripYearMonth = $derived(formatYearMonth(activeTripStartDate));

let boundFileIds = $derived(
    gdriveSync.isConnected
        ? gdriveSync.boundFileIdsFor([activeProfileId, ...profiles.map(p => p.id)])
        : new Set<string>(),
);

// Which marks are actually in play, so the legend explains the icons on screen and not a
// vocabulary the user has never seen. Read off the same slots the rows render.
let legend = $derived.by(() => {
    const ids = [activeProfileId, ...profiles.map(p => p.id)];
    return {
        synced: ids.some(id => gdriveSync.cloudFileId(id) !== null),
        shared: ids.some(id => shareLinks.forTrip(id) !== null),
        received: ids.some(id => tripOrigins.isShared(id)),
    };
});

let sortedProfiles = $derived(
    [...profiles].sort((a, b) => compareTripDates(a.startDate, b.startDate)),
);

let unimportedCloudFiles = $derived(
    gdriveSync.isConnected
        ? gdriveSync.cloudFiles.filter(file => !boundFileIds.has(file.id))
        : [],
);

let sortedCloudFiles = $derived(
    [...unimportedCloudFiles].sort((a, b) => compareTripDates(a.startDate, b.startDate)),
);

// Deliberately one-way, and reset on close below: the switcher is a place you pass
// through, so a fold the user has to undo every time is worse than one that quietly
// re-folds itself.
let showEarlierCloudTrips = $state(false);

// compareTripDates groups by this same predicate, so the fold falls exactly on a group
// boundary: filtering keeps each side's order, and appending the long-past ones behind
// the button reads as one continuous list rather than a reshuffle.
let earlierCloudFiles = $derived(sortedCloudFiles.filter(file => isTripLongPast(file.startDate)));
let currentCloudFiles = $derived(sortedCloudFiles.filter(file => !isTripLongPast(file.startDate)));
let shownCloudFiles = $derived(showEarlierCloudTrips ? [...currentCloudFiles, ...earlierCloudFiles] : currentCloudFiles);

/**
 * Whichever single thing the cloud slot shows. Collapsing it to one value here is what
 * keeps the markup from rendering, say, a stale list next to a reconnect prompt.
 */
let cloudSlot = $derived.by((): "signin" | "loading" | "list" | "reconnect" => {
    if (!gdriveSync.isConnected) return "signin";
    if (gdriveSync.cloudListState === "failed") return "reconnect";
    if (gdriveSync.cloudListState === "loading" && gdriveSync.cloudFiles.length === 0) return "loading";
    return "list";
});

// The switcher is where the cloud rows are read, so this is where the list is worth
// re-fetching. The TTL and the in-flight guard both live in refreshFiles, and reading
// neither cloudFiles nor cloudListState here is what keeps the effect from re-triggering
// itself.
$effect(() => {
    if (expanded && gdriveSync.isConnected) void gdriveSync.refreshFiles();
});

// Only 行程管理 needs this — TripOverview's drawer unmounts the whole component — but
// the reset has to hold in both hosts.
$effect(() => {
    if (!expanded) showEarlierCloudTrips = false;
});

function handleToggle() {
    if (onToggleExpand) {
        onToggleExpand();
    } else {
        expanded = !expanded;
    }
}

function handleSwitch(id: string) {
    expanded = false;
    onSwitchProfile(id);
}

function handleCreate() {
    expanded = false;
    onCreateProfile();
}

async function handleLoadCloud(fileId: string, fileName: string) {
    confirmingCloudFileId = null;
    expanded = false;
    await onLoadCloudTrip(fileId, fileName);
}

async function handleDeleteCloud(fileId: string) {
    confirmingCloudDeleteFileId = null;
    await onDeleteCloudTrip(fileId);
}
</script>

<!--
  Where a trip stands outside this device: a Drive copy, a share link others hold, or an
  arrival from someone else's link. The Drive mark reads the binding rather than the live
  cloud listing, so it still answers the question offline; the binding is a rebuildable
  cache, so a fresh install shows nothing here until the first sync restores it.
-->
{#snippet statusBadges(profileId: string)}
    {@const synced = gdriveSync.cloudFileId(profileId) !== null}
    {@const shared = shareLinks.forTrip(profileId) !== null}
    {@const received = tripOrigins.isShared(profileId)}
    {#if synced || shared || received}
        <span class="shrink-0 flex items-center gap-1 text-text-muted">
            {#if synced}
                <span role="img" aria-label="已同步雲端" title="已同步雲端" class="flex"><Cloud size={13} aria-hidden="true" /></span>
            {/if}
            {#if shared}
                <span role="img" aria-label="已分享連結" title="已分享連結" class="flex"><Share2 size={13} aria-hidden="true" /></span>
            {/if}
            {#if received}
                <span role="img" aria-label="來自分享" title="來自分享" class="flex"><UsersRound size={13} aria-hidden="true" /></span>
            {/if}
        </span>
    {/if}
{/snippet}

<div class="w-full">
    <button
        type="button"
        onclick={handleToggle}
        aria-expanded={expanded}
        class="w-full panel rounded-xl p-3.5 flex items-center gap-2.5 text-left hover:bg-tint-2 transition cursor-pointer"
    >
        <Layers size={16} class="shrink-0 text-accent" aria-hidden="true" />
        <span class="flex-1 min-w-0">
            <span class="block text-[11px] font-bold text-text-muted">目前行程</span>
            <span class="flex items-center gap-1.5 min-w-0">
                <span class="text-sm font-bold text-text-primary truncate">{activeTripName || "（尚未載入）"}</span>
                {#if activeTripYearMonth}
                    <span class="text-[11px] text-accent font-semibold shrink-0">({activeTripYearMonth})</span>
                {/if}
                {@render statusBadges(activeProfileId)}
            </span>
        </span>
        <ChevronDown
            size={16}
            class="shrink-0 text-text-muted transition-transform duration-200 {expanded ? 'rotate-180 text-accent' : ''}"
            aria-hidden="true"
        />
    </button>
    {#if expanded}
        <div class="mt-2 space-y-1.5 animate-fade-in">
            <!-- 1. 本機其他行程 (日期近者優先) -->
            {#each sortedProfiles as profile (profile.id)}
                {#if confirmingDeleteProfileId === profile.id}
                    <ConfirmBar
                        message="要刪除行程「{profile.name}」嗎？此動作無法復原。"
                        confirmLabel="確定刪除"
                        onconfirm={() => {
                            confirmingDeleteProfileId = null;
                            onDeleteProfile(profile.id, profile.name);
                        }}
                        oncancel={() => (confirmingDeleteProfileId = null)}
                    />
                {:else}
                    <div class="flex items-center gap-1">
                        <button
                            type="button"
                            onclick={() => handleSwitch(profile.id)}
                            class="flex-1 min-w-0 min-h-[44px] flex items-center justify-between gap-2 px-3.5 rounded-xl bg-tint-1 border border-card-border text-text-secondary hover:text-accent hover:bg-tint-2 transition cursor-pointer"
                        >
                            <span class="flex items-center gap-1.5 min-w-0 truncate">
                                <span class="truncate text-sm font-semibold">{profile.name}</span>
                                {#if profile.startDate}
                                    <span class="text-[11px] text-text-muted font-normal shrink-0">({formatYearMonth(profile.startDate)})</span>
                                {/if}
                                {@render statusBadges(profile.id)}
                            </span>
                            <span class="shrink-0 text-[11px] font-bold">切換</span>
                        </button>
                        <button
                            type="button"
                            onclick={() => (confirmingDeleteProfileId = profile.id)}
                            aria-label="刪除行程 {profile.name}"
                            class="shrink-0 min-w-[44px] min-h-[44px] flex items-center justify-center text-text-muted hover:text-danger transition cursor-pointer"
                        >
                            <Trash2 size={16} aria-hidden="true" />
                        </button>
                    </div>
                {/if}
            {/each}

            <!-- 2. 雲端：清單／讀取中／重新連線／登入，恆為四者之一 -->
            {#if cloudSlot === "list"}
                {#each shownCloudFiles as file (file.id)}
                    {#if confirmingCloudFileId === file.id}
                        <ConfirmBar
                            message={`確定從 Google Drive 載入「${file.name}」嗎？`}
                            confirmLabel="確定載入"
                            variant="accent"
                            onconfirm={() => handleLoadCloud(file.id, file.name)}
                            oncancel={() => (confirmingCloudFileId = null)}
                        />
                    {:else if confirmingCloudDeleteFileId === file.id}
                        <ConfirmBar
                            message={`確定從 Google Drive 刪除「${file.name}」嗎？此動作無法復原。`}
                            confirmLabel="確定刪除"
                            onconfirm={() => handleDeleteCloud(file.id)}
                            oncancel={() => (confirmingCloudDeleteFileId = null)}
                        />
                    {:else}
                        <div class="flex items-center gap-1">
                            <button
                                type="button"
                                onclick={() => (confirmingCloudFileId = file.id)}
                                class="flex-1 min-w-0 min-h-[44px] flex items-center justify-between gap-2 px-3.5 rounded-xl bg-tint-1 border border-card-border text-text-secondary hover:text-accent hover:bg-tint-2 transition cursor-pointer"
                            >
                                <span class="flex items-center gap-1.5 min-w-0 truncate">
                                    <Cloud size={15} class="text-accent shrink-0" aria-hidden="true" />
                                    <span class="truncate text-sm font-semibold">{file.name}</span>
                                    {#if file.startDate}
                                        <span class="text-[11px] text-text-muted font-normal shrink-0">({formatYearMonth(file.startDate)})</span>
                                    {/if}
                                </span>
                                <span class="shrink-0 text-[11px] font-bold text-accent">載入</span>
                            </button>
                            <button
                                type="button"
                                onclick={() => (confirmingCloudDeleteFileId = file.id)}
                                aria-label={`刪除雲端檔案 ${file.name}`}
                                class="shrink-0 min-w-[44px] min-h-[44px] flex items-center justify-center text-text-muted hover:text-danger transition cursor-pointer"
                            >
                                <Trash2 size={16} aria-hidden="true" />
                            </button>
                        </div>
                    {/if}
                {/each}
                {#if !showEarlierCloudTrips && earlierCloudFiles.length > 0}
                    <button
                        type="button"
                        onclick={() => (showEarlierCloudTrips = true)}
                        class="w-full min-h-[44px] flex items-center justify-center gap-1.5 px-3.5 rounded-xl bg-tint-1 border border-card-border text-text-muted hover:text-accent hover:bg-tint-2 transition cursor-pointer text-xs font-bold"
                    >
                        <History size={14} class="shrink-0" aria-hidden="true" /> 載入更早的 {earlierCloudFiles.length} 筆行程
                    </button>
                {/if}
            {:else if cloudSlot === "loading"}
                <div class="w-full min-h-[44px] flex items-center justify-center gap-1.5 px-3.5 rounded-xl bg-tint-1 border border-card-border text-text-muted text-xs font-semibold">
                    <RefreshCw size={14} class="animate-spin" aria-hidden="true" /> 讀取雲端行程…
                </div>
            {:else if cloudSlot === "reconnect"}
                <button
                    type="button"
                    disabled={gdriveSync.isConnecting}
                    onclick={() => void gdriveSync.connect()}
                    class="w-full min-h-[44px] flex items-center justify-center gap-1.5 px-3.5 rounded-xl bg-tint-1 border border-card-border text-text-secondary hover:text-accent hover:bg-tint-2 transition cursor-pointer text-xs font-bold disabled:opacity-50"
                >
                    <CloudOff size={14} class="shrink-0 text-text-muted" aria-hidden="true" />
                    {gdriveSync.isConnecting ? "連線中…" : "雲端連線中斷，點此重新連線"}
                </button>
            {:else}
                <button
                    type="button"
                    disabled={gdriveSync.isConnecting}
                    onclick={() => void gdriveSync.connect()}
                    class="w-full min-h-[44px] flex items-center justify-center gap-1.5 px-3.5 rounded-xl bg-tint-1 border border-card-border text-text-secondary hover:text-accent hover:bg-tint-2 transition cursor-pointer text-xs font-bold disabled:opacity-50"
                >
                    <LogIn size={14} class="shrink-0 text-accent" aria-hidden="true" />
                    {gdriveSync.isConnecting ? "連線中…" : "登入 Google 取得雲端行程"}
                </button>
            {/if}

            <!-- 3. 新增行程 -->
            <button
                type="button"
                onclick={handleCreate}
                class="w-full min-h-[44px] flex items-center justify-center gap-1.5 px-3.5 rounded-xl bg-tint-1 border border-dashed border-card-border text-text-secondary hover:text-accent hover:bg-tint-2 transition cursor-pointer text-xs font-bold"
            >
                <Plus size={14} aria-hidden="true" /> 新增行程
            </button>

            <!-- 4. 圖示說明 -->
            {#if legend.synced || legend.shared || legend.received}
                <p class="flex flex-wrap items-center gap-x-3 gap-y-1 px-1 pt-0.5 text-[10px] text-text-muted">
                    {#if legend.synced}
                        <span class="flex items-center gap-1"><Cloud size={11} aria-hidden="true" /> 已同步雲端</span>
                    {/if}
                    {#if legend.shared}
                        <span class="flex items-center gap-1"><Share2 size={11} aria-hidden="true" /> 已分享連結</span>
                    {/if}
                    {#if legend.received}
                        <span class="flex items-center gap-1"><UsersRound size={11} aria-hidden="true" /> 來自分享</span>
                    {/if}
                </p>
            {/if}
        </div>
    {/if}
</div>
