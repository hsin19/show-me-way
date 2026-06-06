<script lang="ts">
import {
    Copy,
    MapPin,
} from "@lucide/svelte";
import type { DayItinerary } from "../api";
import type { HotelInfo } from "../api";
import { formatDayDate } from "../utils";

interface Props {
    dayData: DayItinerary;
    hotels?: HotelInfo[];
    onCopy: (text: string, msg: string) => void;
}

let { dayData, hotels = [], onCopy }: Props = $props();

// Dynamically get transport method, fallback to "步行 & 捷運"
const transportText = $derived(dayData.transport || "步行 & 捷運");

// Dynamically calculate accommodation info
const hotelText = $derived.by(() => {
    // Find matching hotel based on day's date
    const date = dayData.date;
    const activeHotel = hotels.find(h => date >= h.checkIn && date <= h.checkOut);
    return activeHotel ? activeHotel.name : "未安排住宿";
});
</script>

<!-- Day Overview Card -->
<div class="glass-panel rounded-2xl p-5 mb-6 relative overflow-hidden before:content-[''] before:absolute before:top-0 before:left-0 before:w-1 before:h-full before:bg-gradient-to-b before:from-neon-blue before:to-neon-pink">
    <div class="flex justify-between items-center mb-3">
        <h3 class="text-xl font-extrabold tracking-tight">Day {dayData.day}｜{formatDayDate(dayData.date)}</h3>
        <span class="text-xs bg-neon-blue/10 text-neon-blue px-2.5 py-1 rounded-xl font-semibold border border-neon-blue/20">
            {dayData.region}
        </span>
    </div>
    <p class="text-sm text-text-secondary leading-relaxed">
        ⚡️ <strong class="text-text-primary">今日節奏：</strong>{dayData.pace}
    </p>
    <div class="flex gap-4 mt-4 pt-4 border-t border-white/5">
        <div class="flex items-center gap-1.5 text-xs text-text-secondary">
            <span>🏃‍♂️</span> {transportText}
        </div>
        <div class="flex items-center gap-1.5 text-xs text-text-secondary">
            <span>🏨</span> {hotelText}
        </div>
    </div>
</div>

<!-- Timeline List -->
<div class="relative pl-5 before:content-[''] before:absolute before:top-2 before:left-1.5 before:w-[2px] before:h-[calc(100%-16px)] before:bg-gradient-to-b before:from-neon-blue/40 before:to-neon-pink/40">
    {#each dayData.timeline as event (event.time + event.title)}
        <div class="relative mb-6">
            <!-- Timeline Node Badge -->
            <div
                class="
                    absolute -left-5 top-1 w-3.5 h-3.5 rounded-full bg-bg-main border-2 z-10 transition-all duration-300 -translate-x-[5px]
                    {event.type === 'booked' ? 'border-neon-orange shadow-[0_0_8px_var(--color-neon-orange)]' : ''}
                    {event.type === 'must-go' ? 'border-neon-pink shadow-[0_0_8px_var(--color-neon-pink)]' : ''}
                    {event.type === 'option' ? 'border-neon-purple shadow-[0_0_8px_var(--color-neon-purple)]' : ''}
                    {event.type === 'standard' ? 'border-neon-blue shadow-[0_0_8px_var(--color-neon-blue)]' : ''}
                "
            >
            </div>

            <!-- Event Card (Glassmorphic) -->
            <div class="glass-panel rounded-2xl p-4 ml-2.5 transition-transform duration-200 active:scale-[0.98]">
                <span
                    class="
                        text-xs font-bold px-2 py-0.5 rounded-lg border inline-block mb-2
                        {event.type === 'booked' ? 'text-neon-orange bg-neon-orange/8 border-neon-orange/15' : ''}
                        {event.type === 'must-go' ? 'text-neon-pink bg-neon-pink/8 border-neon-pink/15' : ''}
                        {event.type === 'option' ? 'text-neon-purple bg-neon-purple/8 border-neon-purple/15' : ''}
                        {event.type === 'standard' ? 'text-neon-blue bg-neon-blue/8 border-neon-blue/15' : ''}
                    "
                >
                    {event.time}
                </span>

                <div class="flex justify-between items-center mb-1.5">
                    <span class="text-[15px] font-bold text-text-primary">{event.title}</span>
                    {#if event.type === "booked"}
                        <span class="text-[9px] font-extrabold px-1.5 py-0.5 rounded bg-neon-orange/15 text-neon-orange border border-neon-orange/30">📅 預訂</span>
                    {:else if event.type === "must-go"}
                        <span class="text-[9px] font-extrabold px-1.5 py-0.5 rounded bg-neon-pink/15 text-neon-pink border border-neon-pink/30">🔥 必訪</span>
                    {:else if event.type === "option"}
                        <span class="text-[9px] font-extrabold px-1.5 py-0.5 rounded bg-neon-purple/15 text-neon-purple border border-neon-purple/30">📝 備選</span>
                    {/if}
                </div>

                <p class="text-xs text-text-secondary leading-relaxed">{event.desc}</p>

                {#if event.bullets && event.bullets.length > 0}
                    <ul class="list-disc list-inside mt-2.5 pl-2 text-xs text-text-secondary space-y-1">
                        {#each event.bullets as bullet (bullet)}
                            <!-- eslint-disable-next-line svelte/no-at-html-tags -->
                            <li>{@html bullet}</li>
                        {/each}
                    </ul>
                {/if}

                {#if event.naverSearch}
                    <div class="flex gap-2 mt-3 pt-3 border-t border-white/5">
                        <a
                            href="https://map.naver.com/p/search/{encodeURIComponent(event.naverSearch)}"
                            target="_blank"
                            rel="noopener noreferrer"
                            class="flex items-center gap-1.5 bg-neon-blue/10 border border-neon-blue/20 text-neon-blue text-[11px] font-bold px-3 py-1.5 rounded-lg transition-all duration-300 hover:bg-neon-blue hover:text-black hover:shadow-[0_0_15px_rgba(0,240,255,0.25)]"
                        >
                            <MapPin size={12} />
                            NAVER 地圖搜尋
                        </a>
                        <button
                            onclick={() => onCopy(event.naverSearch || "", "已複製韓文名稱，可貼到 Naver Map")}
                            class="p-2 border border-card-border text-text-secondary rounded-lg transition-all hover:bg-white/5 hover:text-text-primary cursor-pointer"
                            title="複製韓文名稱"
                        >
                            <Copy size={12} />
                        </button>
                    </div>
                {/if}
            </div>
        </div>
    {/each}
</div>
