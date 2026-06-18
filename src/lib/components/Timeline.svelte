<script lang="ts">
import BedDouble from "@lucide/svelte/icons/bed-double";
import CalendarCheck from "@lucide/svelte/icons/calendar-check";
import Check from "@lucide/svelte/icons/check";
import ChevronDown from "@lucide/svelte/icons/chevron-down";
import ClipboardList from "@lucide/svelte/icons/clipboard-list";
import Flame from "@lucide/svelte/icons/flame";
import Link from "@lucide/svelte/icons/link";
import LogOut from "@lucide/svelte/icons/log-out";
import Maximize2 from "@lucide/svelte/icons/maximize-2";
import Navigation from "@lucide/svelte/icons/navigation";
import Play from "@lucide/svelte/icons/play";
import Share2 from "@lucide/svelte/icons/share-2";
import SkipForward from "@lucide/svelte/icons/skip-forward";
import Ticket from "@lucide/svelte/icons/ticket";
import Zap from "@lucide/svelte/icons/zap";
import type {
    ConfirmationInfo,
    DayItinerary,
} from "../api";
import type { HotelInfo } from "../api";
import type { EnlargedCard } from "../enlarge";
import {
    classifyTimelineEvents,
    formatDayDate,
    isCheckoutDay,
    isOvernightStay,
    mapDirections,
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
    /** Show a place's local-language name/address, or a confirmation code, enlarged; the overlay is a single app-level instance. */
    onEnlarge: (card: EnlargedCard) => void;
    /** Set an event's manual check-in state; `undefined` clears it (tapping the active state again). */
    onSetEventStatus: (id: string, status: "done" | "skipped" | undefined) => void;
    /** Share this day's plain-text 報平安 report (app-level handler: share sheet or clipboard fallback). */
    onShareDay: () => void;
    /** Copy to the clipboard with toast feedback (app-level handler). */
    onCopy: (text: string, msg: string) => void;
}

let { dayData, hotels = [], mapProvider, weather = null, now = null, onEnlarge, onSetEventStatus, onShareDay, onCopy }: Props = $props();

// Per-event time status for today's panel only — classifyTimelineEvents
// returns null for any other day, so non-today panels skip all styling.
const eventStatuses = $derived(now ? classifyTimelineEvents(dayData.timeline, dayData.date, now) : null);

// Hotel where this day is an actual overnight stay (checkout day excluded, see
// isOvernightStay), so no "回飯店" entry shows on the departure day. Rendered as
// a synthetic timeline entry — never persisted into the YAML.
const overnightHotel = $derived(
    hotels.find(h => isOvernightStay(h, dayData.date)),
);

// Hotel being checked out of today — a synthetic 退房 node at the top of the
// day. On a changeover day this is the previous hotel, while overnightHotel is
// the next one, so both nodes show. Also never persisted.
const checkoutHotel = $derived(
    hotels.find(h => isCheckoutDay(h, dayData.date)),
);

// Per-event expanded state of the alternatives list, keyed by `_id`.
// Default collapsed; resets naturally on reload (UI-only, never persisted).
let expandedAlts = $state<Record<string, boolean>>({});
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
    <button
        type="button"
        onclick={onShareDay}
        class="mt-4 w-full min-h-[44px] bg-white/3 border border-neon-blue/30 text-neon-blue font-bold rounded-xl text-xs flex items-center justify-center gap-1.5 hover:bg-neon-blue/10 transition active:scale-[0.98] cursor-pointer"
    >
        <Share2 size={14} aria-hidden="true" /> 分享今日行程
    </button>
</div>

<!-- Map link + directions + "show enlarged" button for a place. A direct
     `mapLink` (e.g. a naver.me short link) wins over a search built from
     `localName`; directions need a text query, so that chip requires
     `localName`. Emits bare chips so the caller can group them in one row
     with any extra `links`. -->
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
        <a
            href={mapDirections(localName, mapProvider)}
            target="_blank"
            rel="noopener noreferrer"
            class="inline-flex items-center gap-1.5 min-h-[44px] bg-neon-blue/10 border border-neon-blue/20 text-neon-blue text-[11px] font-bold px-3 py-1.5 rounded-lg transition duration-300 hover:bg-neon-blue hover:text-black hover:shadow-[0_0_15px_rgba(0,240,255,0.25)]"
            title="從目前位置出發的大眾運輸路線"
        >
            <Navigation size={13} class="shrink-0" aria-hidden="true" />
            導航
        </a>
        <button
            onclick={() => onEnlarge({ kind: "place", title, localName, address })}
            class="min-w-[44px] min-h-[44px] flex items-center justify-center bg-neon-blue/5 border border-neon-blue/15 text-neon-blue/70 rounded-lg transition duration-300 hover:bg-neon-blue hover:text-black hover:shadow-[0_0_15px_rgba(0,240,255,0.25)] cursor-pointer"
            aria-label="放大顯示當地名稱"
            title="放大給司機/店員看"
        >
            <Maximize2 size={14} aria-hidden="true" />
        </button>
    {/if}
{/snippet}

<!-- Confirmation-code chip (tap to copy) + enlarge button for counter check-in. -->
{#snippet confirmationActions(confirmation: ConfirmationInfo, title: string)}
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
        onclick={() => onEnlarge({ kind: "confirmation", title, code: confirmation.code, name: confirmation.name, note: confirmation.note })}
        class="min-w-[44px] min-h-[44px] flex items-center justify-center bg-neon-orange/5 border border-neon-orange/15 text-neon-orange/70 rounded-lg transition duration-300 hover:bg-neon-orange hover:text-black hover:shadow-[0_0_15px_rgba(255,123,0,0.25)] cursor-pointer"
        aria-label="放大顯示確認碼"
        title="放大出示給櫃台看"
    >
        <Maximize2 size={14} aria-hidden="true" />
    </button>
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
    {#if checkoutHotel}
        <!-- Auto-generated checkout entry at the top of the day (not persisted to
             YAML). No `data-timeline-event` index, so it never affects the
             time-based auto-scroll target. -->
        <div class="relative mb-6">
            <div class="absolute -left-[23px] top-1 w-3.5 h-3.5 rounded-full bg-bg-main border-2 border-neon-orange z-10"></div>
            <div class="glass-panel rounded-2xl p-4 ml-2.5">
                <div class="flex items-center gap-1.5 mb-1.5">
                    <LogOut size={15} class="text-neon-orange shrink-0" aria-hidden="true" />
                    <span class="text-[15px] font-bold text-text-primary">退房</span>
                </div>
                <p class="text-xs text-text-secondary leading-relaxed">{checkoutHotel.name}</p>

                {#if checkoutHotel.localName || checkoutHotel.mapLink}
                    <div class="flex flex-wrap gap-2 mt-3 pt-3 border-t border-white/5">
                        {@render placeActions(checkoutHotel.localName, checkoutHotel.name, checkoutHotel.address, checkoutHotel.mapLink)}
                    </div>
                {/if}
            </div>
        </div>
    {/if}

    {#each dayData.timeline as event, i (event._id ?? event.time + event.title)}
        {@const timeStatus = eventStatuses?.[i] ?? null}
        <!-- A manual check-in (done/skipped) takes visual precedence over the
             time-based styling: it reuses the same opacity-60 fade as "past"
             and suppresses the "current" ring/badge, so the two never clash. -->
        <div class="relative mb-6 {event.status || timeStatus === 'past' ? 'opacity-60' : ''}" data-timeline-event={i}>
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
            <div class="glass-panel rounded-2xl p-4 ml-2.5 transition-transform duration-200 active:scale-[0.98] {!event.status && timeStatus === 'current' ? 'ring-2 ring-neon-blue/60 shadow-[0_0_18px_rgba(0,240,255,0.25)]' : ''}">
                <div class="flex flex-wrap justify-between items-center gap-y-1 mb-2">
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
                    <div class="flex items-center gap-1.5 -mr-2">
                        {#if !event.status && timeStatus === "current"}
                            <span class="inline-flex items-center gap-1 text-[10px] font-extrabold px-2 py-1 rounded-md bg-neon-blue/15 text-neon-blue border border-neon-blue/30"><Play size={11} aria-hidden="true" />進行中</span>
                        {/if}
                        {#if event.type === "booked"}
                            <span class="inline-flex items-center gap-1 text-[10px] font-extrabold px-2 py-1 rounded-md bg-neon-orange/15 text-neon-orange border border-neon-orange/30"><CalendarCheck size={11} aria-hidden="true" />預訂</span>
                        {:else if event.type === "must-go"}
                            <span class="inline-flex items-center gap-1 text-[10px] font-extrabold px-2 py-1 rounded-md bg-neon-pink/15 text-neon-pink border border-neon-pink/30"><Flame size={11} aria-hidden="true" />必訪</span>
                        {:else if event.type === "option"}
                            <span class="inline-flex items-center gap-1 text-[10px] font-extrabold px-2 py-1 rounded-md bg-neon-purple/15 text-neon-purple border border-neon-purple/30"><ClipboardList size={11} aria-hidden="true" />備選</span>
                        {/if}
                        <!-- Check-in buttons: 44px hot zones with a compact visible box;
                             -my keeps the header row height unchanged, and -ml-1.5 on
                             the second button cancels the container gap so the pair sits
                             tight (44px targets keep a 16px min gap from the inner padding).
                             Tapping the active state again clears it (status → undefined). -->
                        <button
                            type="button"
                            onclick={() => onSetEventStatus(event._id!, event.status === "done" ? undefined : "done")}
                            aria-label={event.status === "done" ? "取消已完成標記" : "標記為已完成"}
                            aria-pressed={event.status === "done"}
                            title={event.status === "done" ? "取消已完成" : "標記為已完成"}
                            class="min-w-[44px] min-h-[44px] -my-2.5 flex items-center justify-center cursor-pointer"
                        >
                            <span
                                aria-hidden="true"
                                class="
                                    w-7 h-7 rounded-lg border flex items-center justify-center transition duration-300 {event.status === 'done'
                                    ? 'border-accent-green bg-accent-green/15 text-accent-green'
                                    : 'border-white/10 bg-white/3 text-text-muted hover:border-accent-green/50 hover:text-accent-green'}
                                "
                            >
                                <Check size={14} class={event.status === "done" ? "stroke-[3]" : ""} />
                            </span>
                        </button>
                        <button
                            type="button"
                            onclick={() => onSetEventStatus(event._id!, event.status === "skipped" ? undefined : "skipped")}
                            aria-label={event.status === "skipped" ? "取消略過標記" : "標記為略過"}
                            aria-pressed={event.status === "skipped"}
                            title={event.status === "skipped" ? "取消略過" : "標記為略過"}
                            class="min-w-[44px] min-h-[44px] -my-2.5 -ml-1.5 flex items-center justify-center cursor-pointer"
                        >
                            <span
                                aria-hidden="true"
                                class="
                                    w-7 h-7 rounded-lg border flex items-center justify-center transition duration-300 {event.status === 'skipped'
                                    ? 'border-white/30 bg-white/10 text-text-primary'
                                    : 'border-white/10 bg-white/3 text-text-muted hover:border-white/30 hover:text-text-primary'}
                                "
                            >
                                <SkipForward size={14} class={event.status === "skipped" ? "stroke-[3]" : ""} />
                            </span>
                        </button>
                    </div>
                </div>

                <div class="mb-1.5">
                    <span class="text-[15px] font-bold {event.status ? 'text-text-muted line-through' : 'text-text-primary'}">{event.title}</span>
                </div>

                <p class="text-xs text-text-secondary leading-relaxed">{event.desc}</p>

                {#if event.bullets && event.bullets.length > 0}
                    <ul class="list-disc list-inside mt-2.5 pl-2 text-xs text-text-secondary space-y-1">
                        {#each event.bullets as bullet (bullet)}
                            <li>{bullet}</li>
                        {/each}
                    </ul>
                {/if}

                {#if event.confirmation || event.localName || event.mapLink || (event.links && event.links.length > 0)}
                    <div class="flex flex-wrap gap-2 mt-3 pt-3 border-t border-white/5">
                        {#if event.confirmation}
                            {@render confirmationActions(event.confirmation, event.title)}
                        {/if}
                        {@render placeActions(event.localName, event.title, undefined, event.mapLink)}
                        {#each event.links ?? [] as link (link.url)}
                            {@render linkChip(link.label, link.url)}
                        {/each}
                    </div>
                {/if}

                {#if event.alternatives && event.alternatives.length > 0}
                    {@const altKey = event._id ?? event.time + event.title}
                    <div class="mt-3 border-t border-white/5">
                        <button
                            type="button"
                            onclick={() => expandedAlts[altKey] = !expandedAlts[altKey]}
                            aria-expanded={!!expandedAlts[altKey]}
                            class="w-full min-h-[44px] flex items-center justify-between gap-2 text-xs font-bold text-text-secondary transition duration-300 hover:text-neon-purple cursor-pointer"
                        >
                            <span class="inline-flex items-center gap-1.5">
                                <ClipboardList size={13} class="text-neon-purple shrink-0" aria-hidden="true" />
                                備案地點（{event.alternatives.length}）
                            </span>
                            <ChevronDown size={16} class="shrink-0 transition-transform duration-200 {expandedAlts[altKey] ? 'rotate-180' : ''}" aria-hidden="true" />
                        </button>
                        {#if expandedAlts[altKey]}
                            <ul class="space-y-2 pb-1">
                                {#each event.alternatives as alt, k (`${k}-${alt.title}`)}
                                    <li class="flex flex-wrap items-center gap-x-2 gap-y-1 bg-white/3 border border-white/5 rounded-xl px-3 py-2">
                                        <div class="min-w-0 flex-1">
                                            <span class="text-xs font-bold text-text-primary">{alt.title}</span>
                                            {#if alt.note}
                                                <p class="text-[11px] text-text-muted leading-relaxed">{alt.note}</p>
                                            {/if}
                                        </div>
                                        {#if alt.localName || alt.mapLink}
                                            <div class="flex items-center gap-2 shrink-0">
                                                {@render placeActions(alt.localName, alt.title, undefined, alt.mapLink)}
                                            </div>
                                        {/if}
                                    </li>
                                {/each}
                            </ul>
                        {/if}
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
