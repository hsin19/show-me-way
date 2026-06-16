<script lang="ts">
import BedDouble from "@lucide/svelte/icons/bed-double";
import Calendar from "@lucide/svelte/icons/calendar";
import Copy from "@lucide/svelte/icons/copy";
import Maximize2 from "@lucide/svelte/icons/maximize-2";
import MessageSquareText from "@lucide/svelte/icons/message-square-text";
import Ticket from "@lucide/svelte/icons/ticket";
import X from "@lucide/svelte/icons/x";
import { onMount } from "svelte";
import type { HotelInfo } from "../api";
import type {
    PhraseCategory,
    PhraseInfo,
} from "../api";
import {
    getTodayIsoString,
    isOvernightStay,
} from "../utils";
import { acquireScreenWakeLock } from "../wakelock";

interface Props {
    hotels: HotelInfo[];
    phrases: PhraseInfo[];
    driverPrompt: string;
    copyAddressLabel: string;
    onCopy: (text: string, msg: string) => void;
    /** Show a hotel's confirmation code enlarged; the overlay is a single app-level instance. */
    onEnlarge: (card: { kind: "confirmation"; title: string; code: string; name?: string; note?: string; }) => void;
}

let { hotels, phrases, driverPrompt, copyAddressLabel, onCopy, onEnlarge }: Props = $props();

let showFullscreen = $state(false);
let selectedHotel = $state<HotelInfo | null>(null);
let todayStr = $state("");

onMount(() => {
    todayStr = getTodayIsoString();
});

// Highlight tonight's hotel. Same overnight semantics as Timeline / the 報平安
// report (checkout day belongs to the next hotel), so a changeover day never
// marks both hotels as current.
function isCurrentStay(hotel: HotelInfo): boolean {
    if (!todayStr) return false;
    return isOvernightStay(hotel, todayStr);
}

function openFullscreen(hotel: HotelInfo) {
    selectedHotel = hotel;
    showFullscreen = true;
}

function closeFullscreen() {
    showFullscreen = false;
    selectedHotel = null;
}

// Keep the screen on while the address is being shown to a driver. The overlay
// is persistent DOM toggled by opacity, so watch the open state, not mounting.
// Unsupported browsers (iOS standalone < 18.4) no-op — see lib/wakelock.ts.
$effect(() => {
    if (!showFullscreen) return;
    return acquireScreenWakeLock();
});

// Move focus into the dialog on open and hand it back to the trigger on
// close. The dialog itself is inside {#if selectedHotel}, so the closed
// state never sits in the Tab order.
let dialogEl = $state<HTMLDivElement>();
let returnFocus: HTMLElement | null = null;
$effect(() => {
    if (showFullscreen) {
        returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        dialogEl?.focus();
    } else {
        returnFocus?.focus();
        returnFocus = null;
    }
});

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
                    onclick={() => onCopy(`${hotel.name}\n${hotel.address}`, "已複製飯店地址資訊")}
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
                {@const confirmation = hotel.confirmation}
                <div class="flex flex-wrap gap-2 my-3">
                    <button
                        type="button"
                        onclick={() => onCopy(confirmation.code, "已複製確認碼")}
                        class="inline-flex items-center gap-1.5 min-h-[44px] bg-neon-orange/10 border border-neon-orange/20 text-neon-orange text-[11px] font-bold px-3 py-1.5 rounded-lg transition duration-300 hover:bg-neon-orange hover:text-black hover:shadow-[0_0_15px_rgba(255,123,0,0.25)] cursor-pointer"
                        title="點一下複製確認碼"
                    >
                        <Ticket size={13} class="shrink-0" aria-hidden="true" />
                        {confirmation.code}
                    </button>
                    <button
                        type="button"
                        onclick={() => onEnlarge({ kind: "confirmation", title: hotel.name, code: confirmation.code, name: confirmation.name, note: confirmation.note })}
                        class="min-w-[44px] min-h-[44px] flex items-center justify-center bg-neon-orange/5 border border-neon-orange/15 text-neon-orange/70 rounded-lg transition duration-300 hover:bg-neon-orange hover:text-black hover:shadow-[0_0_15px_rgba(255,123,0,0.25)] cursor-pointer"
                        aria-label="放大顯示確認碼"
                        title="放大出示給櫃台看"
                    >
                        <Maximize2 size={14} aria-hidden="true" />
                    </button>
                </div>
            {/if}

            <button
                onclick={() => openFullscreen(hotel)}
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
                    onclick={() => onCopy(p.text, `已複製：${p.text} (${p.zh})`)}
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

<svelte:window onkeydown={(e => e.key === "Escape" && closeFullscreen())} />

<!-- Fullscreen Overlay Modal -->
<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
    onclick={closeFullscreen}
    class="
        fixed inset-0 bg-black/95 z-[1000] flex items-center justify-center p-5 transition-opacity duration-300
        {showFullscreen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}
    "
>
    {#if selectedHotel}
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <div
            bind:this={dialogEl}
            role="dialog"
            aria-modal="true"
            aria-label="全螢幕顯示飯店地址"
            tabindex="-1"
            onclick={(e => e.stopPropagation())}
            class="
                bg-[#121422] border border-white/8 rounded-3xl w-full max-w-[400px] p-6 shadow-2xl transition-transform duration-300 overscroll-contain
                {showFullscreen ? 'translate-y-0' : 'translate-y-5'}
            "
        >
            <div class="flex justify-between items-center mb-6">
                <h3 class="text-sm text-text-secondary">{driverPrompt}</h3>
                <button
                    onclick={closeFullscreen}
                    aria-label="關閉"
                    class="text-text-secondary hover:text-text-primary text-2xl cursor-pointer"
                >
                    <X size={24} aria-hidden="true" />
                </button>
            </div>

            <div class="text-2xl font-black leading-normal text-white text-center break-words mb-5 px-2">
                {selectedHotel.name}<br>
                <strong class="text-neon-blue text-3xl block mt-2 drop-shadow-[0_0_8px_rgba(0,240,255,0.3)]">
                    {selectedHotel.address}
                </strong>
            </div>

            <button
                onclick={() => {
                    onCopy(selectedHotel?.address || "", "已複製地址");
                    closeFullscreen();
                }}
                class="w-full bg-gradient-to-r from-neon-blue to-neon-purple text-black font-bold py-3.5 px-4 rounded-xl text-sm transition active:scale-[0.98] cursor-pointer"
            >
                {copyAddressLabel}
            </button>
        </div>
    {/if}
</div>
