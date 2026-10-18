<script lang="ts">
import { sanitizeLinkHref } from "$lib/domain/markdown";
import GoogleMapsIcon from "$lib/ui/shared/icons/GoogleMapsIcon.svelte";
import NaverIcon from "$lib/ui/shared/icons/NaverIcon.svelte";
import Link from "@lucide/svelte/icons/link";

interface Props {
    label: string;
    /** Untrusted YAML like everything else: an unusable target drops the chip rather than rendering a live `javascript:` href. */
    url: string;
}

let { label, url }: Props = $props();

let href = $derived(sanitizeLinkHref(url));
// One rule for every chip, `mapLink` and `links[]` alike, so the same href always gets the same icon.
let mapKind = $derived.by(() => {
    if (!href) return "other";
    if (href.includes("naver")) return "naver";
    if (/maps\.app\.goo\.gl|google\.[^/]+\/maps|goo\.gl\/maps/.test(href)) return "google";
    return "other";
});
</script>

{#if href}
    <a
        {href}
        target="_blank"
        rel="noopener noreferrer"
        class="inline-flex items-center gap-1.5 min-h-[44px] bg-accent/10 text-accent text-xs font-bold px-3 py-1.5 rounded-lg transition duration-200 hover:bg-accent/20"
    >
        {#if mapKind === "naver"}
            <NaverIcon size={13} class="shrink-0" aria-hidden="true" />
        {:else if mapKind === "google"}
            <GoogleMapsIcon size={13} class="shrink-0" aria-hidden="true" />
        {:else}
            <Link size={12} class="shrink-0" aria-hidden="true" />
        {/if}
        {label}
    </a>
{/if}
