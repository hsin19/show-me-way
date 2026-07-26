<script lang="ts">
import CheckCircle from "@lucide/svelte/icons/check-circle";
import Download from "@lucide/svelte/icons/download";
import RefreshCw from "@lucide/svelte/icons/refresh-cw";
import X from "@lucide/svelte/icons/x";
import { flip } from "svelte/animate";
import { fly } from "svelte/transition";
import {
    dismissToast,
    runToastAction,
    toast,
} from "../toast.svelte";
import { prefersReducedMotion } from "../utils";

const ICONS = { success: CheckCircle, update: RefreshCw, download: Download };

// Enter / reorder / leave duration. Svelte's fly and flip are JS transitions, so
// app.css's prefers-reduced-motion rule (which only reaches CSS
// animations/transitions) does not cover them — asked per transition rather than
// once at init, so switching the OS setting takes effect on the next toast.
const MOVE_MS = 220;
const moveMs = () => (prefersReducedMotion() ? 0 : MOVE_MS);
</script>

<!-- Toast stack, one step above the nav (64px+safe). Newest at the bottom, older
     ones pushed up (animate:flip slides them rather than jumping) — so the PWA
     update notice, which arrives before any user action and never expires, ends
     up at the top without needing any special casing.
     The CONTAINER is the aria-live region, not each pill, because a live region
     has to exist before content is inserted into it — so it stays mounted while
     empty. aria-atomic="false" is what makes that safe: role="status" implies
     atomic, which would re-read every pill in the stack (button labels included)
     on each addition; false announces only the pill that was just added.
     pointer-events-none so a passing notice never intercepts taps; only the
     action / dismiss buttons re-enable them.
     Spans the full width (inset-x-0) and centres each pill, rather than sitting
     at left-1/2: shrink-to-fit against a 50% offset caps a pill at half the
     screen, which wrapped "已有新版本 立即更新 ✕" onto two lines. Pills still wrap
     when they genuinely need to, so no `whitespace-nowrap` here. -->
<div
    role="status"
    aria-live="polite"
    aria-atomic="false"
    class="pointer-events-none fixed bottom-[calc(96px+var(--safe-bottom))] inset-x-0 px-4 z-[2000] flex flex-col items-center gap-2"
>
    {#each toast.items as item (item.id)}
        {@const Icon = ICONS[item.kind]}
        <div
            animate:flip={{ duration: moveMs() }}
            in:fly={{ y: 12, duration: moveMs() }}
            out:fly={{ y: 12, duration: moveMs() }}
            class="max-w-full bg-accent text-accent-contrast font-bold text-xs py-2.5 px-5 rounded-full shadow-lg shadow-lift flex items-center gap-1.5"
        >
            <Icon size={14} class="stroke-[3] shrink-0" aria-hidden="true" />
            {item.message}
            {#if item.action}
                <button
                    onclick={() => runToastAction(item.id)}
                    class="
                        pointer-events-auto min-w-[44px] min-h-[44px] -my-3.5 {item.persist || item.showDismiss
                        ? ''
                        : '-mr-4'} pl-2 pr-3.5 flex items-center justify-center font-black underline underline-offset-2 cursor-pointer
                    "
                >
                    {item.action.label}
                </button>
            {/if}
            {#if item.persist || item.showDismiss}
                <!-- A toast that never expires or explicitly requests a close button needs a way out. -->
                <button
                    onclick={() => dismissToast(item.id)}
                    aria-label="關閉通知"
                    class="pointer-events-auto min-w-[44px] min-h-[44px] -my-3.5 -mr-5 flex items-center justify-center cursor-pointer"
                >
                    <X size={15} aria-hidden="true" />
                </button>
            {/if}
        </div>
    {/each}
</div>
