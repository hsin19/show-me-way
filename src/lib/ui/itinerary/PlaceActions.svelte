<script lang="ts">
import { sanitizeLinkHref } from "$lib/domain/markdown";
import { mapSearch } from "$lib/domain/timeline";
import type { EnlargedCard } from "$lib/ui/shared/enlarge";
import Maximize2 from "@lucide/svelte/icons/maximize-2";
import LinkChip from "./LinkChip.svelte";

interface Props {
    title: string;
    localName?: string;
    /** Turns the enlarged card into one for a driver, offered even without a `localName`. */
    address?: string;
    mapLink?: string;
    /** The trip language's "please take me here" line, heading the card only when it shows an address. */
    driverPrompt?: string;
    mapProvider?: string;
    onEnlarge: (card: EnlargedCard) => void;
}

let { title, localName, address, mapLink, driverPrompt, mapProvider, onEnlarge }: Props = $props();

// A rejected `mapLink` falls back to the `localName` search rather than losing the chip.
let mapUrl = $derived(sanitizeLinkHref(mapLink) ?? (localName ? mapSearch(localName, mapProvider) : undefined));
</script>

<!-- Bare chips, so the caller can group them in one row with any extra `links`.
     No directions chip on purpose: the map app's own 前往 button is one tap away
     and always knows the travel mode. -->
{#if mapUrl}
    <LinkChip label="Map" url={mapUrl} />
{/if}
{#if localName || address}
    <button
        onclick={() => onEnlarge({ title, localName: localName ?? title, address, prompt: address ? driverPrompt : undefined })}
        class="min-w-[44px] min-h-[44px] flex items-center justify-center bg-accent/10 text-accent/80 rounded-lg transition duration-200 hover:bg-accent/20 cursor-pointer"
        aria-label={address ? "放大顯示地址給司機看" : "放大顯示當地名稱"}
        title="放大給司機/店員看"
    >
        <Maximize2 size={14} aria-hidden="true" />
    </button>
{/if}
