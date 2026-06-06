<script lang="ts">
import {
    Calendar,
    Copy,
    Maximize2,
    X,
} from "@lucide/svelte";
import { onMount } from "svelte";
import type { HotelInfo } from "../api";
import type { PhraseInfo } from "../api";
import { getTodayIsoString } from "../utils";

let { hotels, phrases, onCopy } = $props<{
    hotels: HotelInfo[];
    phrases: PhraseInfo[];
    onCopy: (text: string, msg: string) => void;
}>();

let showFullscreen = $state(false);
let selectedHotel = $state<HotelInfo | null>(null);
let todayStr = $state("");

onMount(() => {
    todayStr = getTodayIsoString();
});

// Check if a hotel is currently active today
function isCurrentStay(hotel: HotelInfo): boolean {
    if (!todayStr) return false;
    return todayStr >= hotel.checkIn && todayStr <= hotel.checkOut;
}

function openFullscreen(hotel: HotelInfo) {
    selectedHotel = hotel;
    showFullscreen = true;
}

function closeFullscreen() {
    showFullscreen = false;
    selectedHotel = null;
}

// Format YYYY-MM-DD to display MM/DD
function formatShortDate(dateStr: string): string {
    const parts = dateStr.split("-");
    if (parts.length === 3) {
        return `${parts[1]}/${parts[2]}`;
    }
    return dateStr;
}
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
                            <span class="text-[9px] bg-neon-blue/15 text-neon-blue font-extrabold px-1.5 py-0.5 rounded border border-neon-blue/30 animate-pulse">
                                🏨 當前入住
                            </span>
                        {/if}
                    </div>

                    <!-- Date duration display -->
                    <div class="flex items-center gap-1 text-[10px] text-text-secondary">
                        <Calendar size={10} />
                        <span>{formatShortDate(hotel.checkIn)} 入房 – {formatShortDate(hotel.checkOut)} 退房</span>
                    </div>
                    <span class="text-xs text-text-secondary block pt-1">{hotel.station}</span>
                </div>

                <button
                    onclick={() => onCopy(`${hotel.name}\n${hotel.address}`, "已複製飯店地址資訊")}
                    class="p-2 text-text-secondary border border-card-border rounded-lg transition hover:bg-white/5 hover:text-text-primary cursor-pointer flex-shrink-0"
                    title="複製地址"
                >
                    <Copy size={14} />
                </button>
            </div>

            <div class="bg-black/25 border border-card-border p-3.5 rounded-xl text-center font-bold text-base text-neon-blue tracking-wide my-3">
                {hotel.address}
            </div>

            <button
                onclick={() => openFullscreen(hotel)}
                class="w-full bg-gradient-to-r from-neon-blue to-neon-purple text-black font-bold py-2.5 px-4 rounded-xl text-xs flex items-center justify-center gap-1.5 transition active:scale-[0.98] cursor-pointer shadow-[0_0_10px_rgba(0,240,255,0.15)]"
            >
                <Maximize2 size={12} />
                全螢幕放大給司機看
            </button>
        </div>
    {/each}
</div>

<!-- Survival Korean Deck -->
<div class="mt-6">
    <h3 class="text-base font-bold text-text-primary mb-4">💬 實用常用語</h3>
    <div class="grid grid-cols-1 gap-3">
        {#each phrases as p (p.zh)}
            <div
                onclick={() => onCopy(p.text, `已複製：${p.text} (${p.zh})`)}
                class="bg-card-bg border border-card-border rounded-xl p-3.5 flex justify-between items-center cursor-pointer transition-all duration-200 active:scale-[0.98] hover:bg-white/5 group"
            >
                <div class="flex flex-col gap-1">
                    <span class="text-sm font-bold text-text-primary group-hover:text-neon-blue transition-colors">{p.zh}</span>
                    <span class="text-base font-extrabold text-neon-pink">{p.text}</span>
                    <span class="text-[10px] text-text-secondary italic">{p.rom}</span>
                </div>
                <div class="text-text-muted group-hover:text-text-primary transition-colors">
                    <Copy size={14} />
                </div>
            </div>
        {/each}
    </div>
</div>

<!-- Fullscreen Overlay Modal -->
<div
    onclick={closeFullscreen}
    class="
        fixed inset-0 bg-black/95 z-[1000] flex items-center justify-center p-5 transition-opacity duration-300
        {showFullscreen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}
    "
>
    {#if selectedHotel}
        <div
            onclick={(e => e.stopPropagation())}
            class="
                bg-[#121422] border border-white/8 rounded-3xl w-full max-w-[400px] p-6 shadow-2xl transition-transform duration-300
                {showFullscreen ? 'translate-y-0' : 'translate-y-5'}
            "
        >
            <div class="flex justify-between items-center mb-6">
                <h3 class="text-sm text-text-secondary">기사님, 여기로 가주세요 (司機先生，請載我去這)：</h3>
                <button
                    onclick={closeFullscreen}
                    class="text-text-secondary hover:text-text-primary text-2xl cursor-pointer"
                >
                    <X size={24} />
                </button>
            </div>

            <div class="text-2xl font-black leading-normal text-white text-center break-words mb-5 px-2">
                {selectedHotel.name}<br>
                <strong class="text-neon-blue text-3xl block mt-2 drop-shadow-[0_0_8px_rgba(0,240,255,0.3)]">
                    {selectedHotel.address}
                </strong>
            </div>

            <div class="text-sm text-text-secondary text-center mb-8">
                * {selectedHotel.station}
            </div>

            <button
                onclick={() => {
                    onCopy(selectedHotel?.address || "", "已複製地址");
                    closeFullscreen();
                }}
                class="w-full bg-gradient-to-r from-neon-blue to-neon-purple text-black font-bold py-3.5 px-4 rounded-xl text-sm transition active:scale-[0.98] cursor-pointer"
            >
                複製韓文地址
            </button>
        </div>
    {/if}
</div>
