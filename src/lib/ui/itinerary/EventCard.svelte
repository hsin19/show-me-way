<script lang="ts">
import {
    type EventTimeStatus,
    formatEventTime,
} from "$lib/domain/timeline";
import type { TimelineEvent } from "$lib/domain/trip";
import type { EnlargedCard } from "$lib/ui/shared/enlarge";
import RichText from "$lib/ui/shared/RichText.svelte";
import CalendarCheck from "@lucide/svelte/icons/calendar-check";
import Check from "@lucide/svelte/icons/check";
import ChevronDown from "@lucide/svelte/icons/chevron-down";
import ClipboardList from "@lucide/svelte/icons/clipboard-list";
import Flame from "@lucide/svelte/icons/flame";
import MapPin from "@lucide/svelte/icons/map-pin";
import Play from "@lucide/svelte/icons/play";
import SkipForward from "@lucide/svelte/icons/skip-forward";
import AttachmentChip from "./AttachmentChip.svelte";
import LinkChip from "./LinkChip.svelte";
import PlaceActions from "./PlaceActions.svelte";

// The one card for anything on the timeline: an authored event, or a hotel, which has the
// same shape. The timeline's dot and indent are the caller's.

interface Props {
    event: TimelineEvent;
    /** The day the card sits on, so a `start` / `end` there shows its time of day alone; absent in 住宿. */
    day?: string;
    /** Replaces the time chip's text, for a hotel's 退房 / 回飯店休息 node. */
    timeLabel?: string;
    /** From `classifyTimelineEvents`; null styles nothing. */
    timeStatus?: EventTimeStatus | null;
    /** The trip language's "please take me here" line, for the driver card an `address` opens. */
    driverPrompt?: string;
    mapProvider?: string;
    onEnlarge: (card: EnlargedCard) => void;
    /**
     * Offers the check-in buttons, which an authored event has and an adapted hotel does
     * not. `undefined` clears the mark, which is what re-tapping the active state does.
     */
    onSetStatus?: (status: "done" | "skipped" | undefined) => void;
}

let { event, day, timeLabel, timeStatus = null, driverPrompt, mapProvider, onEnlarge, onSetStatus }: Props = $props();

let timeText = $derived(timeLabel ?? formatEventTime(event, day));

// A manual check-in outranks the time-based styling: it suppresses the "current" ring,
// so the two cannot contradict each other on one card.
let current = $derived(!event.status && timeStatus === "current");
let altsOpen = $state(false);
</script>

<div class="panel rounded-2xl p-4 transition-transform duration-200 active:scale-[0.98] {current ? 'ring-2 ring-accent/50' : ''}">
    <div class="flex flex-wrap justify-between items-center gap-y-1 mb-2">
        {#if timeText}
            <span class="text-xs font-semibold px-2 py-0.5 rounded-lg bg-tint-2 text-text-secondary tabular-nums">
                {timeText}
            </span>
        {/if}
        <div class="flex items-center gap-1.5 {onSetStatus ? '-mr-2' : ''}">
            {#if current}
                <span class="inline-flex items-center gap-1 text-[11px] font-bold text-accent"><Play size={11} aria-hidden="true" />進行中</span>
            {/if}
            {#if event.type === "booked"}
                <span class="inline-flex items-center gap-1 text-[11px] font-bold text-booked"><CalendarCheck size={11} aria-hidden="true" />預訂</span>
            {:else if event.type === "must-go"}
                <span class="inline-flex items-center gap-1 text-[11px] font-bold text-must"><Flame size={11} aria-hidden="true" />必訪</span>
            {:else if event.type === "option"}
                <span class="inline-flex items-center gap-1 text-[11px] font-bold text-option"><ClipboardList size={11} aria-hidden="true" />備選</span>
            {/if}
            {#if onSetStatus}
                <!-- 44px hot zones behind a compact visible box: the negative
                     margins claw back the space that would otherwise grow the
                     header row and split the pair apart. -->
                <button
                    type="button"
                    onclick={() => onSetStatus(event.status === "done" ? undefined : "done")}
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
                    onclick={() => onSetStatus(event.status === "skipped" ? undefined : "skipped")}
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
            {/if}
        </div>
    </div>

    <div class="mb-1.5">
        <span class="text-[15px] font-bold {event.status ? 'text-text-muted line-through' : 'text-text-primary'}">{event.title}</span>
    </div>

    <p class="text-xs text-text-secondary leading-relaxed"><RichText text={event.desc} /></p>

    {#if event.bullets && event.bullets.length > 0}
        <ul class="list-disc list-inside mt-2.5 pl-2 text-xs text-text-secondary space-y-1">
            {#each event.bullets as bullet, k (`${k}-${bullet}`)}
                <li><RichText text={bullet} /></li>
            {/each}
        </ul>
    {/if}

    {#if event.localName || event.mapLink || event.address || (event.links && event.links.length > 0) || (event.attachments && event.attachments.length > 0)}
        <div class="flex flex-wrap gap-2 mt-3 pt-3 border-t border-line">
            <PlaceActions title={event.title} localName={event.localName} address={event.address} mapLink={event.mapLink} {driverPrompt} {mapProvider} {onEnlarge} />
            {#each event.links ?? [] as link, k (`${k}-${link.url}`)}
                <LinkChip label={link.label} url={link.url} />
            {/each}
            {#each event.attachments ?? [] as attachment, k (`${k}-${attachment.fileId}`)}
                <AttachmentChip {attachment} />
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
                            <PlaceActions title={stop.name} localName={stop.localName} mapLink={stop.mapLink} {mapProvider} {onEnlarge} />
                        </div>
                    </li>
                {/each}
            </ul>
        </div>
    {/if}

    {#if event.alternatives && event.alternatives.length > 0}
        <div class="mt-3 border-t border-line">
            <button
                type="button"
                onclick={() => altsOpen = !altsOpen}
                aria-expanded={altsOpen}
                class="w-full min-h-[44px] flex items-center justify-between gap-2 text-xs font-bold text-text-secondary transition duration-200 hover:text-text-primary cursor-pointer"
            >
                <span class="inline-flex items-center gap-1.5">
                    <ClipboardList size={13} class="text-option shrink-0" aria-hidden="true" />
                    備案地點（{event.alternatives.length}）
                </span>
                <ChevronDown size={16} class="shrink-0 transition-transform duration-200 {altsOpen ? 'rotate-180' : ''}" aria-hidden="true" />
            </button>
            {#if altsOpen}
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
                                    <PlaceActions title={alt.title} localName={alt.localName} mapLink={alt.mapLink} {mapProvider} {onEnlarge} />
                                </div>
                            {/if}
                        </li>
                    {/each}
                </ul>
            {/if}
        </div>
    {/if}
</div>
