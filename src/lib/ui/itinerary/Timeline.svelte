<script lang="ts">
import {
    classifyTimelineEvents,
    isCheckoutDay,
    isOvernightStay,
} from "$lib/domain/timeline";
import type {
    DayItinerary,
    HotelInfo,
} from "$lib/domain/trip";
import type { DailyWeather } from "$lib/infra/http/weather";
import type { EnlargedCard } from "$lib/ui/shared/enlarge";
import Share2 from "@lucide/svelte/icons/share-2";
import Zap from "@lucide/svelte/icons/zap";
import EventCard from "./EventCard.svelte";
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
const checkoutClock = $derived(checkoutHotel?.end.split("T")[1]);
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

<div class="relative pl-6 before:content-[''] before:absolute before:top-2 before:left-[7px] before:w-[2px] before:h-[calc(100%-16px)] before:bg-tint-3">
    {#if checkoutHotel}
        <div class="relative mb-6">
            <div class="absolute -left-[23px] top-1 w-3.5 h-3.5 rounded-full bg-bg-main border-2 border-booked z-10"></div>
            <div class="ml-2.5">
                <EventCard event={checkoutHotel} timeLabel={checkoutClock ? `退房 ${checkoutClock}` : "退房"} {driverPrompt} {mapProvider} {onEnlarge} />
            </div>
        </div>
    {/if}

    {#each dayData.timeline as event, i (event._id ?? `${event.start ?? event.time}${event.title}`)}
        {@const timeStatus = eventStatuses?.[i] ?? null}
        <!-- A manual check-in fades the card as "past" does; EventCard drops the
             "current" ring for it, so the two cannot contradict each other. -->
        <div class="relative mb-6 {event.status || timeStatus === 'past' ? 'opacity-60' : ''}" data-event-id={event._id}>
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
        <div class="relative mb-6">
            <div class="absolute -left-[23px] top-1 w-3.5 h-3.5 rounded-full bg-bg-main border-2 border-line-emphasis z-10"></div>
            <div class="ml-2.5">
                <EventCard event={overnightHotel} timeLabel="回飯店休息" {driverPrompt} {mapProvider} {onEnlarge} />
            </div>
        </div>
    {/if}
</div>
