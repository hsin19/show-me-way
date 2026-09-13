<script lang="ts">
/**
 * The decision strip for "two versions of this trip exist and only the user can choose".
 * Drive raises it when a sync finds both sides moved; a received share link raises it when
 * the sender published while this device was editing. One component because the choice is
 * the same choice — take theirs, keep ours, or keep both — and only the wording and what
 * each branch does differ.
 *
 * Every choice goes through a ConfirmBar first: each one overwrites something, and two of
 * them overwrite a version the user has not seen. The confirm label says what is about to
 * happen rather than repeating the button, which is why each choice carries both.
 *
 * `keepBoth` absent means there is no second version worth keeping — a cloud copy merely
 * newer than an untouched local one — and that button is left out rather than disabled.
 */
import ConfirmBar from "$lib/ui/shared/ConfirmBar.svelte";
import TriangleAlert from "@lucide/svelte/icons/triangle-alert";

/** One way out of the conflict: what the button says, what the confirm asks, what it does. */
interface Choice {
    label: string;
    confirmLabel: string;
    confirmMessage: string;
    run: () => void;
}

interface Props {
    /** Finished zh-TW, shown as the strip's own text and as its accessible name. */
    message: string;
    takeRemote: Choice;
    keepLocal: Choice;
    keepBoth?: Choice;
    disabled?: boolean;
}

let { message, takeRemote, keepLocal, keepBoth, disabled = false }: Props = $props();

let confirming = $state<Choice | null>(null);

function commit(choice: Choice) {
    confirming = null;
    choice.run();
}
</script>

{#if confirming}
    <ConfirmBar
        message={confirming.confirmMessage}
        confirmLabel={confirming.confirmLabel}
        onconfirm={() => commit(confirming!)}
        oncancel={() => (confirming = null)}
    />
{:else}
    <div role="alertdialog" aria-label={message} class="rounded-xl border border-danger/40 bg-danger/10 p-2.5">
        <p class="flex items-start gap-1.5 text-[11px] font-medium text-danger leading-normal">
            <TriangleAlert size={14} class="shrink-0 mt-px" aria-hidden="true" />
            {message}
        </p>
        <div class="mt-2 flex gap-2">
            <button
                type="button"
                {disabled}
                onclick={() => (confirming = takeRemote)}
                class="flex-1 min-h-[44px] rounded-lg bg-accent text-accent-contrast text-xs font-bold cursor-pointer hover:opacity-90 transition duration-200 disabled:opacity-40"
            >
                {takeRemote.label}
            </button>
            <button
                type="button"
                {disabled}
                onclick={() => (confirming = keepLocal)}
                class="flex-1 min-h-[44px] rounded-lg bg-tint-2 text-text-secondary text-xs font-bold border border-card-border hover:bg-tint-3 transition duration-200 cursor-pointer disabled:opacity-40"
            >
                {keepLocal.label}
            </button>
        </div>
        {#if keepBoth}
            <!-- Full width below the pair rather than a third column, which would not fit a phone. -->
            <button
                type="button"
                {disabled}
                onclick={() => (confirming = keepBoth)}
                class="mt-2 w-full min-h-[44px] rounded-lg bg-tint-1 text-text-secondary text-xs font-bold border border-card-border hover:bg-tint-2 transition duration-200 cursor-pointer disabled:opacity-40"
            >
                {keepBoth.label}
            </button>
        {/if}
    </div>
{/if}
