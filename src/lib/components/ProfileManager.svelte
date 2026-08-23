<script lang="ts">
import ChevronDown from "@lucide/svelte/icons/chevron-down";
import Cloud from "@lucide/svelte/icons/cloud";
import Layers from "@lucide/svelte/icons/layers";
import Plus from "@lucide/svelte/icons/plus";
import Trash2 from "@lucide/svelte/icons/trash-2";
import { gdriveSync } from "../gdrive.svelte";
import type { ProfileInfo } from "../profiles";
import ConfirmBar from "./ConfirmBar.svelte";

// Rendered by two hosts, so an edit here changes both: collapsed at the top of
// 行程管理, where it owns `expanded`, and forced open in TripOverview's drawer,
// where the host owns it via `onToggleExpand`.
interface Props {
    activeTripName: string;
    profiles: ProfileInfo[];
    /** Bindable, or driven by the host together with `onToggleExpand`. */
    expanded?: boolean;
    onSwitchProfile: (id: string) => void;
    onCreateProfile: () => void;
    /** Called only after the inline confirm — this is the app's only guard on a profile delete. */
    onDeleteProfile: (id: string, name: string) => void;
    onToggleExpand?: () => void;
    onLoadCloudTrip?: (fileId: string, fileName: string) => void | Promise<void>;
    onDeleteCloudTrip?: (fileId: string) => void | Promise<void>;
}

let {
    activeTripName,
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
    if (onLoadCloudTrip) {
        await onLoadCloudTrip(fileId, fileName);
    } else {
        await gdriveSync.loadTripYaml(fileId);
    }
}

async function handleDeleteCloud(fileId: string) {
    confirmingCloudDeleteFileId = null;
    if (onDeleteCloudTrip) {
        await onDeleteCloudTrip(fileId);
    } else {
        await gdriveSync.deleteTrip(fileId);
    }
}
</script>

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
            <span class="block text-sm font-bold text-text-primary truncate">{activeTripName || "（尚未載入）"}</span>
        </span>
        <ChevronDown
            size={16}
            class="shrink-0 text-text-muted transition-transform duration-200 {expanded ? 'rotate-180 text-accent' : ''}"
            aria-hidden="true"
        />
    </button>
    {#if expanded}
        <div class="mt-2 space-y-1.5 animate-fade-in">
            <!-- 1. 本機其他行程 -->
            {#each profiles as profile (profile.id)}
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
                            <span class="truncate text-sm font-semibold">{profile.name}</span>
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

            <!-- 2. 雲端行程 (Google Drive) 直接排在後面 -->
            {#if gdriveSync.isConnected && gdriveSync.cloudFiles.length > 0}
                {#each gdriveSync.cloudFiles as file (file.id)}
                    {@const cleanName = file.name.replace(/\.ya?ml$/i, "")}
                    {#if confirmingCloudFileId === file.id}
                        <ConfirmBar
                            message={`確定從 Google Drive 載入「${cleanName}」嗎？`}
                            confirmLabel="確定載入"
                            variant="accent"
                            onconfirm={() => handleLoadCloud(file.id, file.name)}
                            oncancel={() => (confirmingCloudFileId = null)}
                        />
                    {:else if confirmingCloudDeleteFileId === file.id}
                        <ConfirmBar
                            message={`確定從 Google Drive 刪除「${cleanName}」嗎？此動作無法復原。`}
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
                                <span class="flex items-center gap-2 min-w-0 truncate">
                                    <Cloud size={15} class="text-accent shrink-0" aria-hidden="true" />
                                    <span class="truncate text-sm font-semibold">{cleanName}</span>
                                </span>
                                <span class="shrink-0 text-[11px] font-bold text-accent">載入</span>
                            </button>
                            <button
                                type="button"
                                onclick={() => (confirmingCloudDeleteFileId = file.id)}
                                aria-label={`刪除雲端檔案 ${cleanName}`}
                                class="shrink-0 min-w-[44px] min-h-[44px] flex items-center justify-center text-text-muted hover:text-danger transition cursor-pointer"
                            >
                                <Trash2 size={16} aria-hidden="true" />
                            </button>
                        </div>
                    {/if}
                {/each}
            {/if}

            <!-- 3. 新增行程 -->
            <button
                type="button"
                onclick={handleCreate}
                class="w-full min-h-[44px] flex items-center justify-center gap-1.5 px-3.5 rounded-xl bg-tint-1 border border-dashed border-card-border text-text-secondary hover:text-accent hover:bg-tint-2 transition cursor-pointer text-xs font-bold"
            >
                <Plus size={14} aria-hidden="true" /> 新增行程
            </button>
        </div>
    {/if}
</div>
