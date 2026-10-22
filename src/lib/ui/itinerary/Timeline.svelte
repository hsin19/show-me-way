<script lang="ts">
import {
    classifyTimelineEvents,
    isCheckoutDay,
    isOvernightStay,
} from "$lib/domain/timeline";
import type {
    DayItinerary,
    HotelInfo,
    TimelineEvent,
} from "$lib/domain/trip";
import {
    moveEventToDay,
    moveItem,
    newEvent,
    setText,
} from "$lib/domain/trip-edit";
import { formatDayDate } from "$lib/domain/utils";
import type { DailyWeather } from "$lib/infra/http/weather";
import { showToast } from "$lib/stores/toast.svelte";
import { tripEdit } from "$lib/stores/trip-edit.svelte";
import type { EnlargedCard } from "$lib/ui/shared/enlarge";
import Plus from "@lucide/svelte/icons/plus";
import TriangleAlert from "@lucide/svelte/icons/triangle-alert";
import Zap from "@lucide/svelte/icons/zap";
import CardActions from "./CardActions.svelte";
import CardActionsToggle from "./CardActionsToggle.svelte";
import EventCard from "./EventCard.svelte";
import EventEditor from "./EventEditor.svelte";
import WeatherBadge from "./WeatherBadge.svelte";

interface Props {
    dayData: DayItinerary;
    hotels?: HotelInfo[];
    /** The trip language's "please take me here" line, for the driver card an address opens. */
    driverPrompt: string;
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

let { dayData, hotels = [], driverPrompt, mapProvider, weather = null, now = null, onEnlarge, onSetEventStatus, onShareDay }: Props = $props();

const eventStatuses = $derived(now ? classifyTimelineEvents(dayData.timeline, dayData.date, now) : null);

// In edit mode the day is the draft's, changed in place; the dates never change, so the date finds it.
const draftDay = $derived(tripEdit.active ? tripEdit.draft?.days.find(d => d.date === dayData.date) : undefined);

// The draft's stays while editing, so a check-in moved on the overview shows here before ✓;
// one whose dates are still being typed places nothing.
const stays = $derived(draftDay ? (tripEdit.draft?.trip.hotels ?? []).filter(h => h.start && h.end) : hotels);

// Both hotel nodes below are synthesized per render and NEVER persisted into the
// YAML — nothing dedupes, so an authored copy would show twice and the user could
// not delete either. On a changeover day both appear: this day is the checkout of
// one hotel and the first night of the next.
const overnightHotel = $derived(
    stays.find(h => isOvernightStay(h, dayData.date)),
);

const checkoutHotel = $derived(
    stays.find(h => isCheckoutDay(h, dayData.date)),
);
const checkoutClock = $derived(checkoutHotel?.end.split("T")[1]);

let actionsOpen = $state(false);

// Every other day of the draft, for an event's 移到… picker.
const moveTargets = $derived((tripEdit.draft?.days ?? []).filter(d => d.date !== dayData.date).map(d => ({ date: d.date, label: `${formatDayDate(d.date)} ${d.title}` })));

function moveToDay(day: DayItinerary, index: number, date: string) {
    const target = tripEdit.draft?.days.find(d => d.date === date);
    if (!target) return;
    moveEventToDay(day, index, target);
    // The event leaves the day on screen, so say where it went.
    showToast(`已移到 ${formatDayDate(date)}`);
}

const field = "bg-transparent border-b border-dashed border-line-emphasis outline-none focus:border-solid focus:border-accent placeholder:text-text-muted placeholder:font-normal";
</script>

{#snippet dot(event: TimelineEvent)}
    <div
        class="
            absolute -left-[23px] top-1 w-3.5 h-3.5 rounded-full bg-bg-main border-2 z-10 transition duration-200
            {event.type === 'booked' ? 'border-booked' : ''}
            {event.type === 'must-go' ? 'border-must' : ''}
            {event.type === 'option' ? 'border-option' : ''}
            {(event.type ?? 'standard') === 'standard' ? 'border-line-emphasis' : ''}
        "
    >
    </div>
{/snippet}

{#snippet hotelNode(hotel: HotelInfo, timeLabel: string, ring: string)}
    <div class="relative mb-6">
        <div class="absolute -left-[23px] top-1 w-3.5 h-3.5 rounded-full bg-bg-main border-2 {ring} z-10"></div>
        <div class="ml-2.5">
            <EventCard event={hotel} {timeLabel} {driverPrompt} {mapProvider} {onEnlarge} />
        </div>
    </div>
{/snippet}

{#snippet editing(day: DayItinerary)}
    {@const dayError = tripEdit.errors.get(day)}
    <div class="panel rounded-2xl p-5 mb-6 ring-1 ring-accent/40">
        <input aria-label="這天的標題" bind:value={day.title} autocomplete="off" placeholder="這天的標題" class="{field} block w-full min-h-[44px] text-xl font-extrabold tracking-tight text-text-primary" />
        <label class="mt-1 flex items-center gap-1.5 text-sm text-text-secondary">
            <Zap size={15} class="text-accent shrink-0" aria-hidden="true" />
            <strong class="shrink-0 text-text-primary">今日節奏：</strong>
            <input aria-label="今日節奏" bind:value={() => day.pace, v => setText(day, "pace", v)} autocomplete="off" placeholder="自由安排行程" class="{field} flex-1 min-w-0 min-h-[44px]" />
        </label>
        <label class="flex items-center gap-2 text-xs">
            <span class="shrink-0 w-14 text-[11px] font-bold text-text-muted">天氣城市</span>
            <input aria-label="天氣城市" bind:value={() => day.city ?? "", v => setText(day, "city", v)} autocomplete="off" placeholder="沿用整趟行程的城市" class="{field} flex-1 min-w-0 min-h-[44px] text-text-secondary" />
        </label>
        {#if dayError}
            <p role="alert" class="mt-2 flex items-start gap-1.5 text-xs text-danger">
                <TriangleAlert size={13} class="shrink-0 mt-0.5" aria-hidden="true" />{dayError}
            </p>
        {/if}
        <p class="text-xs text-accent mt-3">點文字就能直接修改，改完按右上角 ✓ 儲存</p>
    </div>

    <div class="relative pl-6 before:content-[''] before:absolute before:top-2 before:left-[7px] before:w-[2px] before:h-[calc(100%-16px)] before:bg-tint-3">
        {#if checkoutHotel}
            {@render hotelNode(checkoutHotel, checkoutClock ? `退房 ${checkoutClock}` : "退房", "border-booked")}
        {/if}

        {#each day.timeline as event, i (event._id)}
            <div class="relative mb-6" data-event-id={event._id}>
                {@render dot(event)}
                <div class="ml-2.5">
                    <EventEditor
                        bind:entry={() => event, v => (day.timeline[i] = v)}
                        dayDate={day.date}
                        error={tripEdit.errors.get(event)}
                        onMoveUp={i > 0 ? () => moveItem(day.timeline, i, -1) : undefined}
                        onMoveDown={i < day.timeline.length - 1 ? () => moveItem(day.timeline, i, 1) : undefined}
                        onInsertBelow={() => day.timeline.splice(i + 1, 0, newEvent(day.date))}
                        onRemove={() => day.timeline.splice(i, 1)}
                        {moveTargets}
                        onMoveToDay={date => moveToDay(day, i, date)}
                    />
                </div>
            </div>
        {/each}

        <div class="relative mb-6 ml-2.5">
            <button
                type="button"
                onclick={() => day.timeline.push(newEvent(day.date))}
                class="btn-secondary w-full border-dashed"
            >
                <Plus size={14} aria-hidden="true" />新增事件
            </button>
        </div>

        {#if overnightHotel}
            {@render hotelNode(overnightHotel, "回飯店休息", "border-line-emphasis")}
        {/if}
    </div>
{/snippet}

{#if draftDay}
    {@render editing(draftDay)}
{:else}
    <div class="panel rounded-2xl p-5 mb-6">
        <div class="flex justify-between items-center mb-3">
            <!-- min-w-0 + break-words: a title with no break opportunity (a URL, a
             long latin run) would refuse to shrink and make the day panel scroll
             sideways, which also fights TabPager's swipe paging. -->
            <h3 class="text-xl font-extrabold tracking-tight min-w-0 break-words">{dayData.title}</h3>
            <div class="shrink-0 -mr-2">
                <CardActionsToggle bind:open={actionsOpen} />
            </div>
        </div>
        {#if actionsOpen}
            <CardActions shareLabel="分享今日行程" onShare={onShareDay} onDone={() => (actionsOpen = false)} class="mb-3" />
        {/if}
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

    <div class="relative pl-6 before:content-[''] before:absolute before:top-2 before:left-[7px] before:w-[2px] before:h-[calc(100%-16px)] before:bg-tint-3">
        {#if checkoutHotel}
            {@render hotelNode(checkoutHotel, checkoutClock ? `退房 ${checkoutClock}` : "退房", "border-booked")}
        {/if}

        {#each dayData.timeline as event, i (event._id ?? `${event.start ?? event.time}${event.title}`)}
            {@const timeStatus = eventStatuses?.[i] ?? null}
            <!-- A manual check-in fades the card as "past" does; EventCard drops the
             "current" ring for it, so the two cannot contradict each other. -->
            <div class="relative mb-6 {event.status || timeStatus === 'past' ? 'opacity-60' : ''}" data-event-id={event._id}>
                {@render dot(event)}

                <div class="ml-2.5">
                    <EventCard
                        {event}
                        day={dayData.date}
                        {timeStatus}
                        {driverPrompt}
                        {mapProvider}
                        {onEnlarge}
                        onSetStatus={status => onSetEventStatus(event._id!, status)}
                    />
                </div>
            </div>
        {/each}

        {#if overnightHotel}
            {@render hotelNode(overnightHotel, "回飯店休息", "border-line-emphasis")}
        {/if}
    </div>
{/if}
