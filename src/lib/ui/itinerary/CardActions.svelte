<script lang="ts">
import { eventEdit } from "$lib/stores/event-edit.svelte";
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

// The trip switcher's buttons (ProfileManager), so the card's secondary actions share one look.
const button = "min-h-[44px] flex items-center justify-center gap-1.5 px-3.5 rounded-xl bg-tint-1 border border-card-border text-text-secondary hover:text-accent hover:bg-tint-2 transition cursor-pointer text-xs font-bold disabled:opacity-50 disabled:cursor-wait";
</script>

<!-- Right-aligned, under the ⋯ that unfolded it, with share — the one used more — nearest it. -->
<div class="flex flex-wrap justify-end gap-2 {className}">
    <button type="button" onclick={() => choose(() => eventEdit.start())} class={button}>
        <Pencil size={14} class="shrink-0 text-accent" aria-hidden="true" />編輯行程
    </button>
    <button type="button" onclick={() => choose(onShare)} disabled={sharing} class={button}>
        <Share2 size={14} class="shrink-0 text-accent" aria-hidden="true" />{shareLabel}
    </button>
</div>
