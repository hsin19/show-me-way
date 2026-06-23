<script lang="ts">
import Maximize2 from "@lucide/svelte/icons/maximize-2";
import Ticket from "@lucide/svelte/icons/ticket";
import type { ConfirmationInfo } from "../api";
import type { ConfirmationCard } from "../enlarge";
import { copyToClipboard } from "../toast.svelte";

interface Props {
    confirmation: ConfirmationInfo;
    /** Heading shown on the enlarged card (event title or hotel name). */
    title: string;
    onEnlarge: (card: ConfirmationCard) => void;
}

let { confirmation, title, onEnlarge }: Props = $props();
</script>

<!-- Confirmation-code chip (tap to copy) + enlarge button for counter check-in.
     Emits two buttons; the caller wraps them in its own flex container. -->
<button
    type="button"
    onclick={() => copyToClipboard(confirmation.code, "已複製確認碼")}
    class="inline-flex items-center gap-1.5 min-h-[44px] bg-neon-orange/10 border border-neon-orange/20 text-neon-orange text-[11px] font-bold px-3 py-1.5 rounded-lg transition duration-300 hover:bg-neon-orange hover:text-black hover:shadow-[0_0_15px_rgba(255,123,0,0.25)] cursor-pointer"
    title="點一下複製確認碼"
>
    <Ticket size={13} class="shrink-0" aria-hidden="true" />
    {confirmation.code}
</button>
<button
    type="button"
    onclick={() => onEnlarge({ kind: "confirmation", title, code: confirmation.code, name: confirmation.name, note: confirmation.note })}
    class="min-w-[44px] min-h-[44px] flex items-center justify-center bg-neon-orange/5 border border-neon-orange/15 text-neon-orange/70 rounded-lg transition duration-300 hover:bg-neon-orange hover:text-black hover:shadow-[0_0_15px_rgba(255,123,0,0.25)] cursor-pointer"
    aria-label="放大顯示確認碼"
    title="放大出示給櫃台看"
>
    <Maximize2 size={14} aria-hidden="true" />
</button>
