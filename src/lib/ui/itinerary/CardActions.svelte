<script lang="ts">
import { tripEdit } from "$lib/stores/trip-edit.svelte";
import Pencil from "@lucide/svelte/icons/pencil";
import Share2 from "@lucide/svelte/icons/share-2";

// The row a card's ⋯ (CardActionsToggle) unfolds.

interface Props {
    /** The share entry's name: 分享行程 on the overview, 分享今日行程 on a day. */
    shareLabel: string;
    onShare: () => void;
    /** A share link is being built; the entry waits for it. */
    sharing?: boolean;
    /** After either action, so the row folds back behind its ⋯. */
    onDone: () => void;
    class?: string;
}

let { shareLabel, onShare, sharing = false, onDone, class: className = "" }: Props = $props();

function choose(action: () => void) {
    onDone();
    action();
}
</script>

<!-- Right-aligned, under the ⋯ that unfolded it, with share — the one used more — nearest it. -->
<div class="flex flex-wrap justify-end gap-2 {className}">
    <button type="button" onclick={() => choose(() => tripEdit.start())} class="btn-secondary disabled:opacity-50 disabled:cursor-wait">
        <Pencil size={14} class="shrink-0 text-accent" aria-hidden="true" />編輯行程
    </button>
    <button type="button" onclick={() => choose(onShare)} disabled={sharing} class="btn-secondary disabled:opacity-50 disabled:cursor-wait">
        <Share2 size={14} class="shrink-0 text-accent" aria-hidden="true" />{shareLabel}
    </button>
</div>
