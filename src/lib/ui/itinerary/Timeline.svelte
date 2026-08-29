<script lang="ts">
import BedDouble from "@lucide/svelte/icons/bed-double";
import CalendarCheck from "@lucide/svelte/icons/calendar-check";
import Check from "@lucide/svelte/icons/check";
import ChevronDown from "@lucide/svelte/icons/chevron-down";
import ClipboardList from "@lucide/svelte/icons/clipboard-list";
import Flame from "@lucide/svelte/icons/flame";
import Link from "@lucide/svelte/icons/link";
import LogOut from "@lucide/svelte/icons/log-out";
import MapPin from "@lucide/svelte/icons/map-pin";
import Maximize2 from "@lucide/svelte/icons/maximize-2";
import Play from "@lucide/svelte/icons/play";
import Share2 from "@lucide/svelte/icons/share-2";
import SkipForward from "@lucide/svelte/icons/skip-forward";
import Zap from "@lucide/svelte/icons/zap";
import { sanitizeLinkHref } from "../../domain/markdown";
import {
    classifyTimelineEvents,
    isCheckoutDay,
    isOvernightStay,
    mapSearch,
} from "../../domain/timeline";
import type {
    DayItinerary,
    HotelInfo,
} from "../../domain/trip";
import type { DailyWeather } from "../../infra/http/weather";
import type { EnlargedCard } from "../shared/enlarge";
import GoogleMapsIcon from "../shared/icons/GoogleMapsIcon.svelte";
import NaverIcon from "../shared/icons/NaverIcon.svelte";
import RichText from "../shared/RichText.svelte";
import ConfirmationChips from "./ConfirmationChips.svelte";
import WeatherBadge from "./WeatherBadge.svelte";

interface Props {
    dayData: DayItinerary;
    hotels?: HotelInfo[];
    mapProvider?: string;
    /** Absent hides the badge, which is normal: no city set, or a day past the forecast horizon. */
    weather?: DailyWeather | null;
    /** Null disables the past/current/upcoming styling entirely. */
    now?: Date | null;
    /** Ask App to open the fullscreen card; this component never renders a layer of its own. */
    onEnlarge: (card: EnlargedCard) => void;
    /** `undefined` clears the mark, which is what re-tapping the active state does. */
    onSetEventStatus: (id: string, status: "done" | "skipped" | undefined) => void;
    onShareDay: () => void;
}

let { dayData, hotels = [], mapProvider, weather = null, now = null, onEnlarge, onSetEventStatus, onShareDay }: Props = $props();

const eventStatuses = $derived(now ? classifyTimelineEvents(dayData.timeline, dayData.date, now) : null);

// Both hotel nodes below are synthesized per render and NEVER persisted into the
// YAML — nothing dedupes, so an authored copy would show twice and the user could
// not delete either. On a changeover day both appear: this day is the checkout of
// one hotel and the first night of the next.
const overnightHotel = $derived(
    hotels.find(h => isOvernightStay(h, dayData.date)),
);

const checkoutHotel = $derived(
    hotels.find(h => isCheckoutDay(h, dayData.date)),
);

// UI-only, keyed by `_id`: which alternatives lists the user has opened.
let expandedAlts = $state<Record<string, boolean>>({});

/** Shared by every map-link chip so the same href always gets the same icon. */
function classifyMapHref(href: string): "naver" | "google" | "other" {
    if (href.includes("naver")) return "naver";
    if (/maps\.app\.goo\.gl|google\.[^/]+\/maps|goo\.gl\/maps/.test(href)) return "google";
    return "other";
}
</script>

<div class="panel rounded-2xl p-5 mb-6">
    <div class="flex justify-between items-center mb-3">
        <!-- min-w-0 + break-words: a title with no break opportunity (a URL, a
             long latin run) would refuse to shrink and make the day panel scroll
             sideways, which also fights TabPager's swipe paging. -->
        <h3 class="text-xl font-extrabold tracking-tight min-w-0 break-words">{dayData.title}</h3>
        <button
            type="button"
            onclick={onShareDay}
            class="min-w-[44px] min-h-[44px] -mr-2 flex items-center justify-center rounded-xl text-accent hover:bg-accent/10 active:scale-95 transition cursor-pointer"
            aria-label="分享今日行程"
            title="分享今日行程"
        >
            <Share2 size={18} aria-hidden="true" />
        </button>
    </div>
    <p class="text-sm text-text-secondary leading-relaxed flex items-start gap-1.5">
        <Zap size={15} class="text-accent shrink-0 mt-0.5" aria-hidden="true" />
        <span><strong class="text-text-primary">今日節奏：</strong>{dayData.pace}</span>
    </p>
    {#if weather}
        <div class="flex flex-wrap gap-4 mt-4 pt-4 border-t border-line">
            <WeatherBadge {weather} />
        </div>
    {/if}
</div>

<!-- Bare chips, so the caller can group them in one row with any extra `links`.
     No directions chip on purpose: the map app's own 前往 button is one tap away
     and always knows the travel mode.

     `mapLink` is sanitized for the same reason a Markdown link is — a share link
     imports someone else's YAML — and a rejected one falls back to the
     `localName` search rather than losing the chip. -->
{#snippet placeActions(localName: string | undefined, title: string, address?: string, mapLink?: string)}
    {@const safeMapLink = sanitizeLinkHref(mapLink)}
    {@const href = safeMapLink ?? (localName ? mapSearch(localName, mapProvider) : undefined)}
    {#if href}
        {@const mapKind = classifyMapHref(href)}
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
            Map
        </a>
    {/if}
    {#if localName}
        <button
            onclick={() => onEnlarge({ kind: "place", title, localName, address })}
            class="min-w-[44px] min-h-[44px] flex items-center justify-center bg-accent/10 text-accent/80 rounded-lg transition duration-200 hover:bg-accent/20 cursor-pointer"
            aria-label="放大顯示當地名稱"
            title="放大給司機/店員看"
        >
            <Maximize2 size={14} aria-hidden="true" />
        </button>
    {/if}
{/snippet}

<!-- `links[].url` is untrusted YAML like everything else, so an unusable target
     drops the chip rather than rendering a live `javascript:` href. -->
{#snippet linkChip(label: string, url: string)}
    {@const href = sanitizeLinkHref(url)}
    {#if href}
        {@const mapKind = classifyMapHref(href)}
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
{/snippet}

<div class="relative pl-6 before:content-[''] before:absolute before:top-2 before:left-[7px] before:w-[2px] before:h-[calc(100%-16px)] before:bg-tint-3">
    {#if checkoutHotel}
        <div class="relative mb-6">
            <div class="absolute -left-[23px] top-1 w-3.5 h-3.5 rounded-full bg-bg-main border-2 border-booked z-10"></div>
            <div class="panel rounded-2xl p-4 ml-2.5">
                <div class="flex items-center gap-1.5 mb-1.5">
                    <LogOut size={15} class="text-booked shrink-0" aria-hidden="true" />
                    <span class="text-[15px] font-bold text-text-primary">退房</span>
                </div>
                <p class="text-xs text-text-secondary leading-relaxed">{checkoutHotel.name}</p>

                {#if checkoutHotel.localName || checkoutHotel.mapLink}
                    <div class="flex flex-wrap gap-2 mt-3 pt-3 border-t border-line">
                        {@render placeActions(checkoutHotel.localName, checkoutHotel.name, checkoutHotel.address, checkoutHotel.mapLink)}
                    </div>
                {/if}
            </div>
        </div>
    {/if}

    {#each dayData.timeline as event, i (event._id ?? event.time + event.title)}
        {@const timeStatus = eventStatuses?.[i] ?? null}
        <!-- A manual check-in outranks the time-based styling: it reuses the same
             fade as "past" and suppresses the "current" ring, so the two cannot
             contradict each other on one card. -->
        <div class="relative mb-6 {event.status || timeStatus === 'past' ? 'opacity-60' : ''}" data-event-id={event._id}>
            <div
                class="
                    absolute -left-[23px] top-1 w-3.5 h-3.5 rounded-full bg-bg-main border-2 z-10 transition duration-200
                    {event.type === 'booked' ? 'border-booked' : ''}
                    {event.type === 'must-go' ? 'border-must' : ''}
                    {event.type === 'option' ? 'border-option' : ''}
                    {event.type === 'standard' ? 'border-line-emphasis' : ''}
                "
            >
            </div>

            <div class="panel rounded-2xl p-4 ml-2.5 transition-transform duration-200 active:scale-[0.98] {!event.status && timeStatus === 'current' ? 'ring-2 ring-accent/50' : ''}">
                <div class="flex flex-wrap justify-between items-center gap-y-1 mb-2">
                    <span class="text-xs font-semibold px-2 py-0.5 rounded-lg bg-tint-2 text-text-secondary tabular-nums">
                        {event.time}
                    </span>
                    <div class="flex items-center gap-1.5 -mr-2">
                        {#if !event.status && timeStatus === "current"}
                            <span class="inline-flex items-center gap-1 text-[11px] font-bold text-accent"><Play size={11} aria-hidden="true" />進行中</span>
                        {/if}
                        {#if event.type === "booked"}
                            <span class="inline-flex items-center gap-1 text-[11px] font-bold text-booked"><CalendarCheck size={11} aria-hidden="true" />預訂</span>
                        {:else if event.type === "must-go"}
                            <span class="inline-flex items-center gap-1 text-[11px] font-bold text-must"><Flame size={11} aria-hidden="true" />必訪</span>
                        {:else if event.type === "option"}
                            <span class="inline-flex items-center gap-1 text-[11px] font-bold text-option"><ClipboardList size={11} aria-hidden="true" />備選</span>
                        {/if}
                        <!-- 44px hot zones behind a compact visible box: the negative
                             margins claw back the space that would otherwise grow the
                             header row and split the pair apart. Tapping the active
                             state again clears the mark. -->
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
                                    w-7 h-7 rounded-lg border flex items-center justify-center transition duration-200 {event.status === 'done'
                                    ? 'border-positive bg-positive/15 text-positive'
                                    : 'border-line-raised bg-tint-1 text-text-muted hover:border-positive/50 hover:text-positive'}
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
                                    w-7 h-7 rounded-lg border flex items-center justify-center transition duration-200 {event.status === 'skipped'
                                    ? 'border-line-emphasis bg-tint-3 text-text-primary'
                                    : 'border-line-raised bg-tint-1 text-text-muted hover:border-line-emphasis hover:text-text-primary'}
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

                <p class="text-xs text-text-secondary leading-relaxed"><RichText text={event.desc} /></p>

                {#if event.bullets && event.bullets.length > 0}
                    <ul class="list-disc list-inside mt-2.5 pl-2 text-xs text-text-secondary space-y-1">
                        {#each event.bullets as bullet (bullet)}
                            <li><RichText text={bullet} /></li>
                        {/each}
                    </ul>
                {/if}

                {#if event.confirmation || event.localName || event.mapLink || (event.links && event.links.length > 0)}
                    <div class="flex flex-wrap gap-2 mt-3 pt-3 border-t border-line">
                        {#if event.confirmation}
                            <ConfirmationChips confirmation={event.confirmation} title={event.title} {onEnlarge} />
                        {/if}
                        {@render placeActions(event.localName, event.title, undefined, event.mapLink)}
                        {#each event.links ?? [] as link (link.url)}
                            {@render linkChip(link.label, link.url)}
                        {/each}
                    </div>
                {/if}

                <!-- Always expanded, unlike `alternatives`: these are what the event
                     IS, and hiding them behind a tap would bury the map action you
                     want while standing at stop 1. -->
                {#if event.stops && event.stops.length > 0}
                    <div class="mt-3 pt-3 border-t border-line">
                        <p class="flex items-center gap-1.5 text-xs font-bold text-text-secondary mb-1">
                            <MapPin size={13} class="text-accent shrink-0" aria-hidden="true" />
                            地點（{event.stops.length}）
                        </p>
                        <ul class="space-y-1.5">
                            {#each event.stops as stop, k (`${k}-${stop.name}`)}
                                <li class="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
                                    <span class="min-w-0 text-xs text-text-primary">{stop.name}</span>
                                    <div class="flex flex-wrap items-center gap-2">
                                        {@render placeActions(stop.localName, stop.name, undefined, stop.mapLink)}
                                    </div>
                                </li>
                            {/each}
                        </ul>
                    </div>
                {/if}

                {#if event.alternatives && event.alternatives.length > 0}
                    {@const altKey = event._id ?? event.time + event.title}
                    <div class="mt-3 border-t border-line">
                        <button
                            type="button"
                            onclick={() => expandedAlts[altKey] = !expandedAlts[altKey]}
                            aria-expanded={!!expandedAlts[altKey]}
                            class="w-full min-h-[44px] flex items-center justify-between gap-2 text-xs font-bold text-text-secondary transition duration-200 hover:text-text-primary cursor-pointer"
                        >
                            <span class="inline-flex items-center gap-1.5">
                                <ClipboardList size={13} class="text-option shrink-0" aria-hidden="true" />
                                備案地點（{event.alternatives.length}）
                            </span>
                            <ChevronDown size={16} class="shrink-0 transition-transform duration-200 {expandedAlts[altKey] ? 'rotate-180' : ''}" aria-hidden="true" />
                        </button>
                        {#if expandedAlts[altKey]}
                            <ul class="space-y-2 pb-1">
                                {#each event.alternatives as alt, k (`${k}-${alt.title}`)}
                                    <!-- Stacked, not side-by-side: the action chips are a fixed
                                         ~100px and would squeeze `note` into a narrow column. -->
                                    <li class="bg-tint-1 border border-line rounded-xl px-3 py-2">
                                        <div class="min-w-0">
                                            <span class="text-xs font-bold text-text-primary">{alt.title}</span>
                                            {#if alt.note}
                                                <p class="text-[11px] text-text-muted leading-relaxed"><RichText text={alt.note} /></p>
                                            {/if}
                                        </div>
                                        {#if alt.localName || alt.mapLink}
                                            <div class="flex flex-wrap items-center gap-2 mt-1">
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
        <div class="relative mb-6">
            <div class="absolute -left-[23px] top-1 w-3.5 h-3.5 rounded-full bg-bg-main border-2 border-line-emphasis z-10"></div>
            <div class="panel rounded-2xl p-4 ml-2.5">
                <div class="flex items-center gap-1.5 mb-1.5">
                    <BedDouble size={15} class="text-text-muted shrink-0" aria-hidden="true" />
                    <span class="text-[15px] font-bold text-text-primary">回飯店休息</span>
                </div>
                <p class="text-xs text-text-secondary leading-relaxed">{overnightHotel.name}</p>

                {#if overnightHotel.localName || overnightHotel.mapLink}
                    <div class="flex flex-wrap gap-2 mt-3 pt-3 border-t border-line">
                        {@render placeActions(overnightHotel.localName, overnightHotel.name, overnightHotel.address, overnightHotel.mapLink)}
                    </div>
                {/if}
            </div>
        </div>
    {/if}
</div>
