<script lang="ts">
import { getLanguageConfig } from "$lib/domain/language";
import { isOvernightStay } from "$lib/domain/timeline";
import type {
    DayItinerary,
    TripData,
} from "$lib/domain/trip";
import {
    formatDateRange,
    splitDayDate,
} from "$lib/domain/utils";
import type { DailyWeather } from "$lib/infra/http/weather";
import type { ProfileInfo } from "$lib/infra/storage/profiles";
import type { EnlargedCard } from "$lib/ui/shared/enlarge";
import ProfileManager from "$lib/ui/tools/settings/ProfileManager.svelte";
import BedDouble from "@lucide/svelte/icons/bed-double";
import CalendarCheck from "@lucide/svelte/icons/calendar-check";
import CalendarRange from "@lucide/svelte/icons/calendar-range";
import ChevronDown from "@lucide/svelte/icons/chevron-down";
import ChevronRight from "@lucide/svelte/icons/chevron-right";
import Hourglass from "@lucide/svelte/icons/hourglass";
import Loader2 from "@lucide/svelte/icons/loader-2";
import Maximize2 from "@lucide/svelte/icons/maximize-2";
import Share2 from "@lucide/svelte/icons/share-2";
import AttachmentChip from "./AttachmentChip.svelte";
import HotelCards from "./HotelCards.svelte";
import WeatherBadge from "./WeatherBadge.svelte";

interface Props {
    trip: TripData["trip"];
    days: DayItinerary[];
    /** Time left until departure, already worded; null from the trip's first day on. */
    countdownText: string | null;
    /** Today's current or next event, already worded; null when today has nothing left to announce. */
    nextEventLabel: string | null;
    /** Local YYYY-MM-DD; the whole panel's notion of "today" comes from here, not from the clock. */
    todayIso: string;
    prepDone: number;
    prepTotal: number;
    profiles?: ProfileInfo[];
    /** Null hides the badge, same contract as Timeline. */
    weatherFor: (day: DayItinerary) => DailyWeather | null;
    onSelectDay: (day: number) => void;
    /** Ask App to open the fullscreen card; this component never renders a layer of its own. */
    onEnlarge: (card: EnlargedCard) => void;
    /** Deep-links out of the phase card into a 工具 sub-page. */
    onOpenPrepare: () => void;
    onShare: () => void;
    /** Building a share link is a hop round trip now, so the button disables while it runs. */
    sharing?: boolean;
    onSwitchProfile?: (id: string) => void;
    onCreateProfile?: () => void;
    onDeleteProfile?: (id: string) => void;
    onLoadCloudTrip?: (fileId: string, fileName: string) => void | Promise<void>;
    onDeleteCloudTrip?: (fileId: string) => void | Promise<void>;
}

let {
    trip,
    days,
    countdownText,
    nextEventLabel,
    todayIso,
    prepDone,
    prepTotal,
    profiles = [],
    weatherFor,
    onSelectDay,
    onEnlarge,
    onOpenPrepare,
    onShare,
    sharing = false,
    onSwitchProfile,
    onCreateProfile,
    onDeleteProfile,
    onLoadCloudTrip,
    onDeleteCloudTrip,
}: Props = $props();

let isSwitcherOpen = $state(false);

function toggleSwitcher() {
    isSwitcherOpen = !isSwitcherOpen;
}

// A plain string compare is safe here: these are all local-time YYYY-MM-DD.
let phase = $derived(todayIso < trip.start ? "before" : todayIso > trip.end ? "after" : "during");

let todayDay = $derived(days.find(d => d.date === todayIso) ?? null);

let hotelList = $derived(trip.hotels ?? []);
let tonightHotel = $derived(hotelList.find(h => isOvernightStay(h, todayIso)) ?? null);

let langConfig = $derived(getLanguageConfig(trip.lang));
</script>

<div class="panel rounded-2xl p-6 mb-6">
    <div class="flex justify-between items-start gap-2">
        <h2 class="text-2xl font-extrabold text-text-primary tracking-tight min-w-0 break-words">
            {trip.name}
        </h2>
        <button
            type="button"
            onclick={onShare}
            disabled={sharing}
            aria-busy={sharing}
            class="min-w-[44px] min-h-[44px] -mr-2 -mt-1 flex items-center justify-center rounded-xl text-accent hover:bg-accent/10 active:scale-95 transition cursor-pointer shrink-0 disabled:opacity-40 disabled:cursor-wait"
            aria-label="分享行程"
            title="分享行程"
        >
            {#if sharing}
                <Loader2 size={18} class="animate-spin" aria-hidden="true" />
            {:else}
                <Share2 size={18} aria-hidden="true" />
            {/if}
        </button>
    </div>
    <div class="mt-1 flex items-center justify-between gap-2">
        <!-- `min-w-0` lets the date shrink and wrap rather than push the switcher off
             the row on a narrow phone; the two nowrap halves make it break after the
             ・ instead of inside a date. -->
        <p class="min-w-0 text-xs text-text-secondary font-medium tracking-wide flex items-center gap-1.5">
            <CalendarRange size={14} class="shrink-0" aria-hidden="true" />
            <span><span class="whitespace-nowrap">{formatDateRange(trip.start, trip.end)}・</span><span class="whitespace-nowrap">共 {days.length} 天</span></span>
        </p>

        {#if onSwitchProfile && onCreateProfile}
            <button
                type="button"
                onclick={toggleSwitcher}
                class="inline-flex items-center gap-1.5 min-h-[44px] bg-tint-1 border border-card-border hover:border-accent/40 text-text-primary hover:text-accent text-xs font-bold px-3.5 py-2 rounded-full transition cursor-pointer active:scale-95 shrink-0"
                aria-expanded={isSwitcherOpen}
                aria-label="切換行程選單"
            >
                <span>切換行程</span>
                <ChevronDown size={13} class="shrink-0 transition-transform duration-200 {isSwitcherOpen ? 'rotate-180 text-accent' : 'text-text-muted'}" aria-hidden="true" />
            </button>
        {/if}
    </div>
    {#if isSwitcherOpen && onSwitchProfile && onCreateProfile}
        <div class="mt-4 pt-3.5 border-t border-line-faint">
            <ProfileManager
                activeTripName={trip.name}
                activeTripStartDate={trip.start}
                {profiles}
                expanded={true}
                onToggleExpand={toggleSwitcher}
                {onSwitchProfile}
                {onCreateProfile}
                onDeleteProfile={(id => onDeleteProfile?.(id))}
                onLoadCloudTrip={((fileId, fileName) => onLoadCloudTrip?.(fileId, fileName))}
                onDeleteCloudTrip={(fileId => onDeleteCloudTrip?.(fileId))}
            />
        </div>
    {/if}
</div>

<!-- Helper cards chosen by trip phase — what matters before, during and after a
     trip is not the same thing. Before, the countdown and what is left to prepare;
     mid-trip, the way back to today, which may sit far down the day list, and
     tonight's hotel; after, nothing. -->
{#if phase === "before" && countdownText}
    <button
        onclick={onOpenPrepare}
        class="w-full panel rounded-xl p-3.5 mb-6 flex items-center gap-3 text-left hover:bg-tint-2 transition cursor-pointer"
    >
        <Hourglass size={16} class="shrink-0 text-accent" aria-hidden="true" />
        <span class="flex-1 min-w-0">
            <span class="block text-sm font-bold text-text-primary">{countdownText}</span>
            <span class="block text-[11px] font-bold text-text-muted">行前準備{prepTotal > 0 ? ` ${prepDone}/${prepTotal} 項完成` : ""}</span>
        </span>
        <ChevronRight size={16} class="text-text-muted shrink-0" aria-hidden="true" />
    </button>
{:else if phase === "during" && (todayDay || tonightHotel)}
    <div class="space-y-3 mb-6">
        {#if todayDay}
            {@const today = todayDay}
            {@const date = splitDayDate(today.date)}
            <button
                onclick={() => onSelectDay(today.day)}
                class="w-full panel rounded-xl p-3.5 flex items-center gap-3 text-left hover:bg-tint-2 transition cursor-pointer"
            >
                <CalendarCheck size={16} class="shrink-0 text-accent" aria-hidden="true" />
                <span class="flex-1 min-w-0">
                    <span class="block text-[11px] font-bold text-text-muted">
                        <span class="text-must">今天</span>・DAY {String(today.day).padStart(2, "0")}・{date.mmdd}・{date.weekday}
                    </span>
                    <span class="block text-sm font-bold text-text-primary truncate">{today.title}</span>
                    {#if nextEventLabel}
                        <span data-next-event class="block text-xs font-semibold text-accent truncate mt-0.5">{nextEventLabel}</span>
                    {/if}
                </span>
                <ChevronRight size={16} class="text-text-muted shrink-0" aria-hidden="true" />
            </button>
        {/if}
        {#if tonightHotel}
            {@const hotel = tonightHotel}
            <div class="panel rounded-xl p-3.5 flex items-center gap-3">
                <BedDouble size={16} class="shrink-0 text-accent" aria-hidden="true" />
                <span class="flex-1 min-w-0">
                    <span class="block text-[11px] font-bold text-text-muted">今晚入住</span>
                    <span class="block text-sm font-bold text-text-primary truncate">{hotel.title}</span>
                </span>
                <!-- Offered on the same terms as PlaceActions' enlarge button. -->
                {#if hotel.address || hotel.localName}
                    <button
                        onclick={() => onEnlarge({ title: hotel.title, localName: hotel.localName ?? hotel.title, address: hotel.address, prompt: hotel.address ? langConfig.driverPrompt : undefined })}
                        aria-label="放大顯示今晚飯店給司機看"
                        class="shrink-0 min-w-[44px] min-h-[44px] -my-1.5 flex items-center justify-center bg-accent/10 text-accent rounded-lg transition duration-200 hover:bg-accent/20 cursor-pointer"
                    >
                        <Maximize2 size={15} aria-hidden="true" />
                    </button>
                {/if}
            </div>
        {/if}
    </div>
{/if}

<div class="space-y-2">
    {#each days as day (day.day)}
        {@const weather = weatherFor(day)}
        {@const date = splitDayDate(day.date)}
        {@const isToday = day.date === todayIso}
        <button
            onclick={() => onSelectDay(day.day)}
            aria-current={isToday ? "date" : undefined}
            class="w-full panel rounded-xl p-3.5 flex items-center gap-3 text-left hover:bg-tint-2 transition cursor-pointer {isToday ? 'ring-1 ring-accent/40' : ''}"
        >
            <!-- Same two lines as DayChip, and today marked by an accent edge alone
                 as there, so the list and the strip read as one thing; keep them in
                 step. -->
            {#if isToday}
                <span class="sr-only">今天</span>
            {/if}
            <div class="shrink-0 w-[68px] flex flex-col items-center">
                <span class="text-[11px] font-bold text-accent">DAY {String(day.day).padStart(2, "0")}</span>
                <span class="text-sm font-bold text-text-primary mt-0.5 whitespace-nowrap">
                    {date.mmdd} {date.weekday}
                </span>
            </div>
            <div class="flex-1 min-w-0">
                <p class="text-sm font-semibold text-text-primary truncate">{day.title}</p>
                {#if weather}
                    <div class="mt-1">
                        <WeatherBadge {weather} />
                    </div>
                {/if}
            </div>
            <ChevronRight size={16} class="text-text-muted shrink-0" aria-hidden="true" />
        </button>
    {/each}
</div>

<!-- Hotels live here rather than in 工具: mid-trip this is the panel you are
     already on, so the driver card stays one tap away. -->
{#if hotelList.length > 0}
    <div class="mt-6">
        <h3 class="text-[11px] font-bold text-text-muted mb-2 px-1">住宿</h3>
        <HotelCards hotels={hotelList} {todayIso} driverPrompt={langConfig.driverPrompt} mapProvider={trip.mapProvider} {onEnlarge} />
    </div>
{/if}

{#if trip.attachments && trip.attachments.length > 0}
    <div class="mt-6">
        <h3 class="text-[11px] font-bold text-text-muted mb-2 px-1">附件</h3>
        <div class="flex flex-wrap gap-2">
            {#each trip.attachments as attachment, k (`${k}-${attachment.fileId}`)}
                <AttachmentChip {attachment} />
            {/each}
        </div>
    </div>
{/if}
