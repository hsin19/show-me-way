<script lang="ts">
import type { Attachment } from "$lib/domain/trip";
import { gdriveSync } from "$lib/stores/gdrive.svelte";
import { tripEdit } from "$lib/stores/trip-edit.svelte";
import Loader2 from "@lucide/svelte/icons/loader-2";
import Upload from "@lucide/svelte/icons/upload";
import X from "@lucide/svelte/icons/x";

// Edit mode's way to put a ticket or a booking on an entry: the file goes to the trip's Drive
// folder as `YYMMDD 名稱`, the name asked for before it leaves — the label renamed later
// changes only the chip — and the entry gains the link when ✓ saves.

interface Props {
    /** The day the file belongs to, which its name starts with; the trip's first day when empty. */
    date: string;
    onUploaded: (attachment: Attachment) => void;
    class?: string;
}

let { date, onUploaded, class: className = "" }: Props = $props();

let picker: HTMLInputElement | undefined = $state();
let pending = $state<File | null>(null);
let name = $state("");
let uploading = $state(false);

const day = $derived(date || tripEdit.draft?.trip.start || "");

function start() {
    // Choosing a file spends the tap, so a sign-in needed after it could not open its popup.
    if (!gdriveSync.isConnected || gdriveSync.needsReconnect()) {
        void gdriveSync.connect();
        return;
    }
    picker?.click();
}

function picked(input: HTMLInputElement) {
    const file = input.files?.[0];
    // Cleared, so choosing the same file again still fires a change.
    input.value = "";
    if (!file) return;
    pending = file;
    name = file.name.replace(/\.[^.]+$/, "");
}

async function upload() {
    const trip = tripEdit.draft?.trip;
    if (!pending || !trip) return;
    uploading = true;
    try {
        const attachment = await gdriveSync.attachFile({ id: trip.id, name: trip.name, start: trip.start }, day, pending, name);
        if (!attachment) return;
        tripEdit.noteUpload(attachment.fileId);
        onUploaded(attachment);
        pending = null;
    } finally {
        uploading = false;
    }
}
</script>

{#if pending}
    <form
        onsubmit={e => {
            e.preventDefault();
            void upload();
        }}
        class="basis-full flex items-center gap-1.5 text-xs"
    >
        <!-- The date the name will start with, so what lands in Drive reads off the row. -->
        <span class="shrink-0 font-bold text-text-muted tabular-nums">{day.slice(2).replaceAll("-", "")}</span>
        <input
            aria-label="上傳檔名"
            bind:value={name}
            autocomplete="off"
            placeholder="例如 機票 去程"
            class="flex-1 min-w-0 min-h-[44px] bg-transparent border-b border-dashed border-line-emphasis outline-none focus:border-solid focus:border-accent text-text-primary"
        />
        <button type="submit" disabled={uploading} class="btn-primary shrink-0 px-3 disabled:opacity-60 disabled:cursor-wait">
            {#if uploading}
                <Loader2 size={12} class="animate-spin" aria-hidden="true" />上傳中…
            {:else}
                <Upload size={12} aria-hidden="true" />上傳
            {/if}
        </button>
        <button
            type="button"
            onclick={() => (pending = null)}
            disabled={uploading}
            aria-label="不上傳"
            title="不上傳"
            class="min-w-[44px] min-h-[44px] -mr-2 flex items-center justify-center rounded-xl text-text-muted hover:text-text-primary hover:bg-tint-2 transition cursor-pointer disabled:opacity-40"
        >
            <X size={16} aria-hidden="true" />
        </button>
    </form>
{:else}
    <button type="button" onclick={start} class={className}>
        <Upload size={12} aria-hidden="true" />{gdriveSync.isConnected ? "上傳附件" : "連線 Google 後上傳"}
    </button>
{/if}
<input bind:this={picker} type="file" aria-label="選擇附件檔案" class="hidden" onchange={e => picked(e.currentTarget)} />
