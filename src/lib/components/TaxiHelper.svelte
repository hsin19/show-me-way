<script lang="ts">
import BedDouble from "@lucide/svelte/icons/bed-double";
import Calendar from "@lucide/svelte/icons/calendar";
import Copy from "@lucide/svelte/icons/copy";
import Maximize2 from "@lucide/svelte/icons/maximize-2";
import MessageSquareText from "@lucide/svelte/icons/message-square-text";
import type { HotelInfo } from "../api";
import type { EnlargedCard } from "../enlarge";
import type {
    PhraseCategory,
    PhraseInfo,
} from "../phrases";
import { copyToClipboard } from "../toast.svelte";
import {
    isOvernightStay,
    toLocalIsoDate,
} from "../utils";
import ConfirmationChips from "./ConfirmationChips.svelte";

interface Props {
    hotels: HotelInfo[];
    phrases: PhraseInfo[];
    driverPrompt: string;
    /** App's ticking clock; drives the "current stay" highlight so it rolls over midnight on a long-open tab. */
    clockNow: Date;
    /** Enlarge a hotel's confirmation code or address; the overlay is a single app-level instance. */
    onEnlarge: (card: EnlargedCard) => void;
}

let { hotels, phrases, driverPrompt, clockNow, onEnlarge }: Props = $props();

let todayStr = $derived(toLocalIsoDate(clockNow));

// Highlight tonight's hotel. Same overnight semantics as Timeline / the 報平安
// report (checkout day belongs to the next hotel), so a changeover day never
// marks both hotels as current.
function isCurrentStay(hotel: HotelInfo): boolean {
    return isOvernightStay(hotel, todayStr);
}

// Show the address (and local-language name) full-screen for a driver. Reuses
// the app-level enlarged-card overlay — same wake lock / focus / Escape — via a
// place card carrying the trip language's localized driver prompt.
function showAddressForDriver(hotel: HotelInfo) {
    onEnlarge({
        kind: "place",
        title: hotel.name,
        localName: hotel.localName ?? hotel.name,
        address: hotel.address,
        prompt: driverPrompt,
    });
}

// Format YYYY-MM-DD to display MM/DD
function formatShortDate(dateStr: string): string {
    const parts = dateStr.split("-");
    if (parts.length === 3) {
        return `${parts[1]}/${parts[2]}`;
    }
    return dateStr;
}

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

<!-- Hotels List -->
<div class="space-y-4">
    {#each hotels as hotel (hotel.name)}
        <div
            class="
                glass-panel rounded-2xl p-5 relative overflow-hidden
                {isCurrentStay(hotel) ? 'border-neon-blue shadow-[0_0_15px_rgba(0,240,255,0.15)] before:content-[\'\'] before:absolute before:top-0 before:left-0 before:w-1 before:h-full before:bg-neon-blue' : ''}
            "
        >
            <div class="flex justify-between items-start mb-3">
                <div class="space-y-1">
                    <div class="flex items-center gap-2 flex-wrap">
                        <span class="text-sm font-bold text-text-primary block">{hotel.name}</span>
                        {#if isCurrentStay(hotel)}
                            <span class="inline-flex items-center gap-1 text-[10px] bg-neon-blue/15 text-neon-blue font-extrabold px-1.5 py-0.5 rounded border border-neon-blue/30 animate-pulse">
                                <BedDouble size={11} aria-hidden="true" /> 當前入住
                            </span>
                        {/if}
                    </div>

                    <!-- Date duration display -->
                    <div class="flex items-center gap-1 text-[10px] text-text-secondary">
                        <Calendar size={10} aria-hidden="true" />
                        <span>{formatShortDate(hotel.checkIn)} 入房 – {formatShortDate(hotel.checkOut)} 退房</span>
                    </div>
                </div>

                <button
                    onclick={() => copyToClipboard(`${hotel.name}\n${hotel.address}`, "已複製飯店地址資訊")}
                    class="min-w-[44px] min-h-[44px] flex items-center justify-center text-text-secondary border border-card-border rounded-lg transition hover:bg-white/5 hover:text-text-primary cursor-pointer flex-shrink-0"
                    aria-label="複製地址"
                    title="複製地址"
                >
                    <Copy size={14} aria-hidden="true" />
                </button>
            </div>

            <div class="bg-black/25 border border-card-border p-3.5 rounded-xl text-center font-bold text-base text-neon-blue tracking-wide my-3">
                {hotel.address}
            </div>

            {#if hotel.confirmation}
                <div class="flex flex-wrap gap-2 my-3">
                    <ConfirmationChips confirmation={hotel.confirmation} title={hotel.name} {onEnlarge} />
                </div>
            {/if}

            <button
                onclick={() => showAddressForDriver(hotel)}
                class="w-full bg-gradient-to-r from-neon-blue to-neon-purple text-black font-bold py-2.5 px-4 rounded-xl text-xs flex items-center justify-center gap-1.5 transition active:scale-[0.98] cursor-pointer shadow-[0_0_10px_rgba(0,240,255,0.15)]"
            >
                <Maximize2 size={12} aria-hidden="true" />
                全螢幕放大給司機看
            </button>
        </div>
    {/each}
</div>

<!-- Survival phrase deck (hidden when the trip language has no built-in set) -->
{#if phrases.length > 0}
    <div class="mt-6">
        <h3 class="text-base font-bold text-text-primary mb-4 flex items-center gap-2">
            <MessageSquareText size={18} class="text-neon-blue" aria-hidden="true" />實用常用語
        </h3>

        {#if availableCats.length > 0}
            <div class="overflow-x-auto no-scrollbar mb-3">
                <div class="flex gap-2">
                    {#each filterChips as cat (cat)}
                        <button
                            type="button"
                            aria-pressed={activeFilter === cat}
                            onclick={() => (phraseFilter = cat)}
                            class="
                                flex-none min-h-[44px] px-4 rounded-xl border text-xs font-bold transition duration-300 cursor-pointer
                                {activeFilter === cat
                                ? 'bg-gradient-to-br from-neon-blue/15 to-neon-pink/10 border-neon-blue text-neon-blue shadow-[0_0_15px_rgba(0,240,255,0.25)]'
                                : 'bg-white/3 border-card-border text-text-secondary hover:bg-white/5'}
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
                    class="bg-card-bg border border-card-border rounded-xl p-3.5 flex justify-between items-center w-full text-left cursor-pointer transition duration-200 active:scale-[0.98] hover:bg-white/5 group"
                >
                    <div class="flex flex-col gap-1">
                        <span class="text-sm font-bold text-text-primary group-hover:text-neon-blue transition-colors">{p.zh}</span>
                        <span class="text-base font-extrabold text-neon-pink">{p.text}</span>
                        <span class="text-[10px] text-text-secondary italic">{p.rom}</span>
                    </div>
                    <div class="text-text-muted group-hover:text-text-primary transition-colors">
                        <Copy size={14} aria-hidden="true" />
                    </div>
                </button>
            {/each}
        </div>
    </div>
{/if}
