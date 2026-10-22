<script lang="ts">
import { eventEdit } from "$lib/stores/event-edit.svelte";
import Ellipsis from "@lucide/svelte/icons/ellipsis";
import Loader2 from "@lucide/svelte/icons/loader-2";

// The ⋯ on a card's header. It unfolds the card's rarely used actions as a row of their own
// (CardActions), so the header stays something to read. Not ≡: that is the drag handle
// reordering is meant to use, and a gear already means the app's own settings. Gone while
// editing: ✕ and ✓ in the day row are the way out.

interface Props {
    /** Bindable: whether the card shows its CardActions row. */
    open: boolean;
    /** A share link is being built, a hop round trip: ⋯ gives way to a spinner. */
    sharing?: boolean;
}

let { open = $bindable(), sharing = false }: Props = $props();
</script>

{#if !eventEdit.active}
    <button
        type="button"
        onclick={() => (open = !open)}
        aria-expanded={open}
        aria-busy={sharing}
        aria-label="更多"
        title="更多"
        class="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-xl transition active:scale-95 cursor-pointer {open ? 'text-accent bg-accent/10' : 'text-text-muted hover:text-text-primary hover:bg-tint-2'}"
    >
        {#if sharing}
            <Loader2 size={18} class="animate-spin text-accent" aria-hidden="true" />
        {:else}
            <Ellipsis size={20} aria-hidden="true" />
        {/if}
    </button>
{/if}
