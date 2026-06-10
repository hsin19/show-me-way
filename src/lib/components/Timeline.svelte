<script lang="ts">
import {
    BedDouble,
    CalendarCheck,
    ClipboardList,
    Flame,
    Link,
    Maximize2,
    Play,
    X,
    Zap,
} from "@lucide/svelte";
import type { DayItinerary } from "../api";
import type { HotelInfo } from "../api";
import {
    classifyTimelineEvents,
    formatDayDate,
    mapSearch,
} from "../utils";
import type { DailyWeather } from "../weather";
import GoogleMapsIcon from "./icons/GoogleMapsIcon.svelte";
import NaverIcon from "./icons/NaverIcon.svelte";
import WeatherBadge from "./WeatherBadge.svelte";

interface Props {
    dayData: DayItinerary;
    hotels?: HotelInfo[];
    /** Map service for this trip (e.g. 'naver'); defaults to Google Maps when unset. */
    mapProvider?: string;
    /** This day's forecast; null/undefined (no city set, or beyond the 16-day horizon) hides the badge. */
    weather?: DailyWeather | null;
    /** App's ticking clock; enables today's past/current/upcoming styling. Null disables. */
    now?: Date | null;
    onCopy: (text: string, msg: string) => void;
}

let { dayData, hotels = [], mapProvider, weather = null, now = null, onCopy }: Props = $props();

// Per-event time status for today's panel only — classifyTimelineEvents
// returns null for any other day, so non-today panels skip all styling.
const eventStatuses = $derived(now ? classifyTimelineEvents(dayData.timeline, dayData.date, now) : null);

// Local-language name (and, for hotels, address) to show enlarged for a taxi
// driver / local staff to read. `null` keeps the fullscreen overlay closed.
let enlarged = $state<{ title: string; localName: string; address?: string; } | null>(null);

// Hotel where this day is an actual overnight stay. The checkout day is
// excluded (date < checkOut), so no "回飯店" entry shows on the departure day.
// Rendered as a synthetic timeline entry — never persisted into the YAML.
const overnightHotel = $derived(
    hotels.find(h => dayData.date >= h.checkIn && dayData.date < h.checkOut),
);
</script>

<!-- Day Overview Card -->
<div class="glass-panel rounded-2xl p-5 mb-6 relative overflow-hidden before:content-[''] before:absolute before:top-0 before:left-0 before:w-1 before:h-full before:bg-gradient-to-b before:from-neon-blue before:to-neon-pink">
    <div class="flex justify-between items-center mb-3">
        <h3 class="text-xl font-extrabold tracking-tight">Day {dayData.day}｜{formatDayDate(dayData.date)}</h3>
        <span class="text-xs bg-neon-blue/10 text-neon-blue px-2.5 py-1 rounded-xl font-semibold border border-neon-blue/20">
            {dayData.region}
        </span>
    </div>
    <p class="text-sm text-text-secondary leading-relaxed flex items-start gap-1.5">
        <Zap size={15} class="text-neon-orange shrink-0 mt-0.5" aria-hidden="true" />
        <span><strong class="text-text-primary">今日節奏：</strong>{dayData.pace}</span>
    </p>
    {#if weather}
        <div class="flex flex-wrap gap-4 mt-4 pt-4 border-t border-white/5">
            <WeatherBadge {weather} />
        </div>
    {/if}
</div>

<!-- Map link + "show enlarged" button for a place. A direct `mapLink` (e.g. a
     naver.me short link) wins over a search built from `localName`. Emits bare
     chips so the caller can group them in one row with any extra `links`. -->
{#snippet placeActions(localName: string | undefined, title: string, address?: string, mapLink?: string)}
    {@const href = mapLink ?? (localName ? mapSearch(localName, mapProvider) : undefined)}
    {@const isNaver = mapLink ? mapLink.includes("naver") : mapProvider === "naver"}
    {#if href}
        <a
            {href}
            target="_blank"
            rel="noopener noreferrer"
            class="inline-flex items-center gap-1.5 min-h-[44px] bg-neon-blue/10 border border-neon-blue/20 text-neon-blue text-[11px] font-bold px-3 py-1.5 rounded-lg transition duration-300 hover:bg-neon-blue hover:text-black hover:shadow-[0_0_15px_rgba(0,240,255,0.25)]"
        >
            {#if isNaver}
                <NaverIcon size={13} class="shrink-0" aria-hidden="true" />
            {:else}
                <GoogleMapsIcon size={13} class="shrink-0" aria-hidden="true" />
            {/if}
            Map
        </a>
    {/if}
    {#if localName}
        <button
            onclick={() => (enlarged = { title, localName, address })}
            class="min-w-[44px] min-h-[44px] flex items-center justify-center bg-neon-blue/5 border border-neon-blue/15 text-neon-blue/70 rounded-lg transition duration-300 hover:bg-neon-blue hover:text-black hover:shadow-[0_0_15px_rgba(0,240,255,0.25)] cursor-pointer"
            aria-label="放大顯示當地名稱"
            title="放大給司機/店員看"
        >
            <Maximize2 size={14} aria-hidden="true" />
        </button>
    {/if}
{/snippet}

<!-- A single labeled link chip; map URLs get a matching brand icon. -->
{#snippet linkChip(label: string, url: string)}
    <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        class="inline-flex items-center gap-1.5 min-h-[44px] bg-neon-blue/10 border border-neon-blue/20 text-neon-blue text-[11px] font-bold px-3 py-1.5 rounded-lg transition duration-300 hover:bg-neon-blue hover:text-black hover:shadow-[0_0_15px_rgba(0,240,255,0.25)]"
    >
        {#if url.includes("naver")}
            <NaverIcon size={13} class="shrink-0" aria-hidden="true" />
        {:else if /maps\.app\.goo\.gl|google\.[^/]+\/maps|goo\.gl\/maps/.test(url)}
            <GoogleMapsIcon size={13} class="shrink-0" aria-hidden="true" />
        {:else}
            <Link size={12} class="shrink-0" aria-hidden="true" />
        {/if}
        {label}
    </a>
{/snippet}

<!-- Timeline List -->
<div class="relative pl-6 before:content-[''] before:absolute before:top-2 before:left-[7px] before:w-[2px] before:h-[calc(100%-16px)] before:bg-gradient-to-b before:from-neon-blue/40 before:to-neon-pink/40">
    {#each dayData.timeline as event, i (event._id ?? event.time + event.title)}
        {@const status = eventStatuses?.[i] ?? null}
        <div class="relative mb-6 {status === 'past' ? 'opacity-60' : ''}" data-timeline-event={i}>
            <!-- Timeline Node Badge -->
            <div
                class="
                    absolute -left-[23px] top-1 w-3.5 h-3.5 rounded-full bg-bg-main border-2 z-10 transition duration-300
                    {event.type === 'booked' ? 'border-neon-orange shadow-[0_0_7px_rgba(255,123,0,0.6)]' : ''}
                    {event.type === 'must-go' ? 'border-neon-pink shadow-[0_0_7px_rgba(255,42,116,0.6)]' : ''}
                    {event.type === 'option' ? 'border-neon-purple' : ''}
                    {event.type === 'standard' ? 'border-neon-blue/70' : ''}
                "
            >
            </div>

            <!-- Event Card (Glassmorphic) -->
            <div class="glass-panel rounded-2xl p-4 ml-2.5 transition-transform duration-200 active:scale-[0.98] {status === 'current' ? 'ring-2 ring-neon-blue/60 shadow-[0_0_18px_rgba(0,240,255,0.25)]' : ''}">
                <div class="flex justify-between items-center mb-2">
                    <span
                        class="
                            text-xs font-bold px-2 py-0.5 rounded-lg border
                            {event.type === 'booked' ? 'text-neon-orange bg-neon-orange/8 border-neon-orange/15' : ''}
                            {event.type === 'must-go' ? 'text-neon-pink bg-neon-pink/8 border-neon-pink/15' : ''}
                            {event.type === 'option' ? 'text-neon-purple bg-neon-purple/8 border-neon-purple/15' : ''}
                            {event.type === 'standard' ? 'text-neon-blue bg-neon-blue/8 border-neon-blue/15' : ''}
                        "
                    >
                        {event.time}
                    </span>
                    <div class="flex items-center gap-1.5">
                        {#if status === "current"}
                            <span class="inline-flex items-center gap-1 text-[10px] font-extrabold px-2 py-1 rounded-md bg-neon-blue/15 text-neon-blue border border-neon-blue/30"><Play size={11} aria-hidden="true" />進行中</span>
                        {/if}
                        {#if event.type === "booked"}
                            <span class="inline-flex items-center gap-1 text-[10px] font-extrabold px-2 py-1 rounded-md bg-neon-orange/15 text-neon-orange border border-neon-orange/30"><CalendarCheck size={11} aria-hidden="true" />預訂</span>
                        {:else if event.type === "must-go"}
                            <span class="inline-flex items-center gap-1 text-[10px] font-extrabold px-2 py-1 rounded-md bg-neon-pink/15 text-neon-pink border border-neon-pink/30"><Flame size={11} aria-hidden="true" />必訪</span>
                        {:else if event.type === "option"}
                            <span class="inline-flex items-center gap-1 text-[10px] font-extrabold px-2 py-1 rounded-md bg-neon-purple/15 text-neon-purple border border-neon-purple/30"><ClipboardList size={11} aria-hidden="true" />備選</span>
                        {/if}
                    </div>
                </div>

                <div class="mb-1.5">
                    <span class="text-[15px] font-bold text-text-primary">{event.title}</span>
                </div>

                <p class="text-xs text-text-secondary leading-relaxed">{event.desc}</p>

                {#if event.bullets && event.bullets.length > 0}
                    <ul class="list-disc list-inside mt-2.5 pl-2 text-xs text-text-secondary space-y-1">
                        {#each event.bullets as bullet (bullet)}
                            <li>{bullet}</li>
                        {/each}
                    </ul>
                {/if}

                {#if event.localName || event.mapLink || (event.links && event.links.length > 0)}
                    <div class="flex flex-wrap gap-2 mt-3 pt-3 border-t border-white/5">
                        {@render placeActions(event.localName, event.title, undefined, event.mapLink)}
                        {#each event.links ?? [] as link (link.url)}
                            {@render linkChip(link.label, link.url)}
                        {/each}
                    </div>
                {/if}
            </div>
        </div>
    {/each}

    {#if overnightHotel}
        <!-- Auto-generated overnight stay entry (not persisted to YAML) -->
        <div class="relative mb-6">
            <div class="absolute -left-[23px] top-1 w-3.5 h-3.5 rounded-full bg-bg-main border-2 border-neon-purple z-10"></div>
            <div class="glass-panel rounded-2xl p-4 ml-2.5">
                <div class="flex items-center gap-1.5 mb-1.5">
                    <BedDouble size={15} class="text-neon-purple shrink-0" aria-hidden="true" />
                    <span class="text-[15px] font-bold text-text-primary">回飯店休息</span>
                </div>
                <p class="text-xs text-text-secondary leading-relaxed">{overnightHotel.name}</p>

                {#if overnightHotel.localName || overnightHotel.mapLink}
                    <div class="flex flex-wrap gap-2 mt-3 pt-3 border-t border-white/5">
                        {@render placeActions(overnightHotel.localName, overnightHotel.name, overnightHotel.address, overnightHotel.mapLink)}
                    </div>
                {/if}
            </div>
        </div>
    {/if}
</div>

<svelte:window onkeydown={(e => e.key === "Escape" && (enlarged = null))} />

<!-- Fullscreen overlay: shows the local-language name large for a driver / local staff to read. -->
<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
    onclick={() => (enlarged = null)}
    class="
        fixed inset-0 bg-black/95 z-[1000] flex items-center justify-center p-5 transition-opacity duration-300
        {enlarged ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}
    "
>
    {#if enlarged}
        {@const data = enlarged}
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <div
            role="dialog"
            aria-modal="true"
            aria-label={data.title}
            tabindex="-1"
            onclick={(e => e.stopPropagation())}
            class="bg-[#121422] border border-white/8 rounded-3xl w-full max-w-[400px] p-6 shadow-2xl overscroll-contain"
        >
            <div class="flex justify-between items-center mb-6">
                <h3 class="text-sm text-text-secondary">出示給司機 / 店員看（點字可複製）</h3>
                <button
                    onclick={() => (enlarged = null)}
                    aria-label="關閉"
                    class="text-text-secondary hover:text-text-primary cursor-pointer"
                >
                    <X size={24} aria-hidden="true" />
                </button>
            </div>

            <div class="text-center break-words px-2">
                <p class="text-sm text-text-secondary mb-3">{data.title}</p>
                <button
                    type="button"
                    onclick={() => onCopy(data.localName, "已複製名稱")}
                    class="text-white text-2xl font-black leading-normal block w-full break-words cursor-pointer transition active:scale-[0.98]"
                    title="點一下複製"
                >
                    {data.localName}
                </button>
                {#if data.address}
                    <button
                        type="button"
                        onclick={() => onCopy(data.address ?? "", "已複製地址")}
                        class="text-neon-blue text-3xl font-black leading-normal block w-full break-words mt-3 cursor-pointer transition active:scale-[0.98] drop-shadow-[0_0_8px_rgba(0,240,255,0.3)]"
                        title="點一下複製"
                    >
                        {data.address}
                    </button>
                {/if}
            </div>
        </div>
    {/if}
</div>
