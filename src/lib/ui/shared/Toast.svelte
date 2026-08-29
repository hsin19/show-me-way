<script lang="ts">
import { prefersReducedMotion } from "$lib/domain/utils";
import {
    dismissToast,
    runToastAction,
    toast,
} from "$lib/stores/toast.svelte";
import CheckCircle from "@lucide/svelte/icons/check-circle";
import Download from "@lucide/svelte/icons/download";
import RefreshCw from "@lucide/svelte/icons/refresh-cw";
import X from "@lucide/svelte/icons/x";
import { flip } from "svelte/animate";
import { fly } from "svelte/transition";

const ICONS = { success: CheckCircle, update: RefreshCw, download: Download };

// `fly` and `flip` are JS transitions, so app.css's prefers-reduced-motion rule
// does not reach them. Asked per transition, not once at init, so flipping the OS
// setting takes effect on the next toast.
const MOVE_MS = 220;
const moveMs = () => (prefersReducedMotion() ? 0 : MOVE_MS);
</script>

<!-- Newest at the bottom, older ones pushed up, which is how the never-expiring
     PWA update notice ends up at the top without any special casing.

     The CONTAINER is the live region, not each pill: a live region has to exist
     before content is inserted into it, so it stays mounted while empty.
     aria-atomic="false" is what makes that safe — role="status" implies atomic,
     which would re-read every pill in the stack on each addition.

     pointer-events-none so a passing notice never intercepts a tap; the action and
     dismiss buttons re-enable them.

     Full width with centred pills rather than left-1/2: shrink-to-fit against a
     50% offset caps a pill at half the screen, which wrapped
     "已有新版本 立即更新 ✕" onto two lines. -->
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
