<script lang="ts">
import Copy from "@lucide/svelte/icons/copy";
import { edgeFade } from "../../domain/edge-fade";
import type {
    PhraseCategory,
    PhraseInfo,
} from "../../domain/phrases";
import { copyToClipboard } from "../../stores/toast.svelte";

interface Props {
    phrases: PhraseInfo[];
}

let { phrases }: Props = $props();

const CATEGORY_LABELS: Record<PhraseCategory, string> = {
    basic: "基本",
    transport: "交通",
    dining: "點餐",
    shopping: "購物",
    help: "求助",
};
const CATEGORY_ORDER = Object.keys(CATEGORY_LABELS) as PhraseCategory[];

let phraseFilter = $state<PhraseCategory | "all">("all");
// A category the current deck has nothing in would filter to an empty list, so
// it is neither offered nor kept selected.
let availableCats = $derived(CATEGORY_ORDER.filter(cat => phrases.some(p => p.cat === cat)));
let filterChips = $derived<(PhraseCategory | "all")[]>(["all", ...availableCats]);
let activeFilter = $derived(
    phraseFilter !== "all" && !availableCats.includes(phraseFilter) ? "all" : phraseFilter,
);
let filteredPhrases = $derived(
    activeFilter === "all" ? phrases : phrases.filter(p => p.cat === activeFilter),
);
</script>

{#if availableCats.length > 0}
    <!-- The padding is room for the focus ring inside the scrollport, not spacing
         — see TabPager for why a horizontal scrollport clips vertically. The
         margins keep it from moving anything, and `data-swipe-ignore` hands
         horizontal drags to this row instead of the pager. -->
    <div
        class="-mt-1.5 py-1.5 mb-1.5 overflow-x-auto no-scrollbar edge-fade"
        data-swipe-ignore
        {@attach edgeFade}
    >
        <div class="flex gap-2">
            {#each filterChips as cat (cat)}
                <button
                    type="button"
                    aria-pressed={activeFilter === cat}
                    onclick={() => (phraseFilter = cat)}
                    class="
                        flex-none min-h-[44px] px-4 rounded-xl border text-xs font-bold transition duration-200 cursor-pointer
                        {activeFilter === cat
                        ? 'bg-accent/15 border-transparent text-accent'
                        : 'bg-tint-1 border-card-border text-text-secondary hover:bg-tint-2'}
                    "
                >
                    {cat === "all" ? "全部" : CATEGORY_LABELS[cat]}
                </button>
            {/each}
        </div>
    </div>
{/if}

<div class="grid grid-cols-1 gap-3">
    {#each filteredPhrases as p (p.zh + p.text)}
        <button
            type="button"
            onclick={() => copyToClipboard(p.text, `已複製：${p.text} (${p.zh})`)}
            class="panel rounded-xl p-3.5 flex justify-between items-center w-full text-left cursor-pointer transition duration-200 active:scale-[0.98] hover:bg-tint-2 group"
        >
            <div class="flex flex-col gap-1">
                <span class="text-xs font-semibold text-text-secondary group-hover:text-accent transition-colors">{p.zh}</span>
                <span class="text-base font-bold text-text-primary">{p.text}</span>
                <span class="text-[11px] text-text-muted italic">{p.rom}</span>
            </div>
            <div class="text-text-muted group-hover:text-text-primary transition-colors">
                <Copy size={14} aria-hidden="true" />
            </div>
        </button>
    {/each}
</div>
