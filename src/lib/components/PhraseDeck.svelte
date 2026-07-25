<script lang="ts">
import Copy from "@lucide/svelte/icons/copy";
import { edgeFade } from "../edge-fade";
import type {
    PhraseCategory,
    PhraseInfo,
} from "../phrases";
import { copyToClipboard } from "../toast.svelte";

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
// Chips only list categories present in the deck; if the deck changes and the
// selected category disappears, fall back to 全部 instead of an empty list.
let availableCats = $derived(CATEGORY_ORDER.filter(cat => phrases.some(p => p.cat === cat)));
let filterChips = $derived<(PhraseCategory | "all")[]>(["all", ...availableCats]);
let activeFilter = $derived(
    phraseFilter !== "all" && !availableCats.includes(phraseFilter) ? "all" : phraseFilter,
);
let filteredPhrases = $derived(
    activeFilter === "all" ? phrases : phrases.filter(p => p.cat === activeFilter),
);
</script>

<!-- Survival phrase deck (tap a card to copy); hosted in the 常用語 ToolSheet. -->
{#if availableCats.length > 0}
    <!-- Same treatment as TabPager's chip header, so the two rows behave alike:
         the shared edgeFade attachment, and py-1.5 inside the scrollport for the
         focus ring (a horizontal scrollport clips vertically too — see
         TabPager.svelte). The negative top margin plus the halved bottom one keep
         that padding from moving anything. Opt out of the TabPager swipe gesture. -->
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
