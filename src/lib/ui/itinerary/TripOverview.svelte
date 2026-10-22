<script lang="ts">
import { getLanguageConfig } from "$lib/domain/language";
import { isOvernightStay } from "$lib/domain/timeline";
import type {
    DayItinerary,
    HotelInfo,
    TripData,
} from "$lib/domain/trip";
import {
    moveItem,
    newHotel,
    setText,
} from "$lib/domain/trip-edit";
import {
    formatDateRange,
    splitDayDate,
} from "$lib/domain/utils";
import type { DailyWeather } from "$lib/infra/http/weather";
import type { ProfileInfo } from "$lib/infra/storage/profiles";
import { tripEdit } from "$lib/stores/trip-edit.svelte";
import type { EnlargedCard } from "$lib/ui/shared/enlarge";
import ProfileManager from "$lib/ui/tools/settings/ProfileManager.svelte";
import BedDouble from "@lucide/svelte/icons/bed-double";
import CalendarCheck from "@lucide/svelte/icons/calendar-check";
import CalendarRange from "@lucide/svelte/icons/calendar-range";
import ChevronDown from "@lucide/svelte/icons/chevron-down";
import ChevronRight from "@lucide/svelte/icons/chevron-right";
import Hourglass from "@lucide/svelte/icons/hourglass";
import Maximize2 from "@lucide/svelte/icons/maximize-2";
import Plus from "@lucide/svelte/icons/plus";
import TriangleAlert from "@lucide/svelte/icons/triangle-alert";
import X from "@lucide/svelte/icons/x";
import AttachmentChip from "./AttachmentChip.svelte";
import CardActions from "./CardActions.svelte";
import CardActionsToggle from "./CardActionsToggle.svelte";
import EventEditor from "./EventEditor.svelte";
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
let actionsOpen = $state(false);

function toggleSwitcher() {
    isSwitcherOpen = !isSwitcherOpen;
}

// A plain string compare is safe here: these are all local-time YYYY-MM-DD.
let phase = $derived(todayIso < trip.start ? "before" : todayIso > trip.end ? "after" : "during");

let todayDay = $derived(days.find(d => d.date === todayIso) ?? null);

let hotelList = $derived(trip.hotels ?? []);
let tonightHotel = $derived(hotelList.find(h => isOvernightStay(h, todayIso)) ?? null);

let langConfig = $derived(getLanguageConfig(trip.lang));

// In edit mode the trip-level fields are the draft's, changed in place.
const draftTrip = $derived(tripEdit.active ? tripEdit.draft?.trip : undefined);

const LANGS = [["", "未設定（英文）"], ["ja", "日文"], ["ko", "韓文"], ["en", "英文"]] as const;
// `lang` takes any string, so a code the list does not know is offered as itself rather than shown as unset.
const langOptions = $derived(!draftTrip?.lang || LANGS.some(([code]) => code === draftTrip.lang) ? LANGS : [...LANGS, [draftTrip.lang, draftTrip.lang] as const]);
const MAPS = [["", "Google 地圖（預設）"], ["google", "Google 地圖"], ["naver", "Naver 地圖"]] as const;

function setMap(edited: TripData["trip"], value: string) {
    if (value === "google" || value === "naver") edited.mapProvider = value;
    else delete edited.mapProvider;
}

const field = "bg-transparent border-b border-dashed border-line-emphasis outline-none focus:border-solid focus:border-accent placeholder:text-text-muted placeholder:font-normal";
const rowLabel = "shrink-0 w-14 text-[11px] font-bold text-text-muted";
const dateField = "flex-1 min-w-0 min-h-[44px] px-2 rounded-lg bg-tint-2 text-xs font-semibold text-text-secondary tabular-nums outline-none focus:ring-2 focus:ring-accent/60";

function changeRange(input: HTMLInputElement, edge: "start" | "end") {
    const first = days[0]?.date ?? "";
    const last = days.at(-1)?.date ?? "";
    const accepted = tripEdit.setRange(edge === "start" ? input.value : first, edge === "end" ? input.value : last);
    // A refused range leaves the days as they were, so the input goes back to saying so.
    if (!accepted) input.value = edge === "start" ? first : last;
}
</script>

{#snippet editingHeader(edited: TripData["trip"])}
    {@const tripError = tripEdit.errors.get(edited)}
    <div class="panel rounded-2xl p-6 mb-6 ring-1 ring-accent/40">
        <input aria-label="行程名稱" bind:value={edited.name} autocomplete="off" placeholder="行程名稱" class="{field} block w-full min-h-[44px] text-2xl font-extrabold text-text-primary tracking-tight" />
        <div class="mt-2">
            <!-- value + onchange, not a binding: a range is applied whole, and may be refused. -->
            <div class="flex items-center gap-2 text-xs mb-1">
                <span class={rowLabel}>日期</span>
                <input type="date" aria-label="開始日期" value={days[0]?.date} onchange={e => changeRange(e.currentTarget, "start")} class={dateField} />
                <span class="text-text-muted" aria-hidden="true">–</span>
                <input type="date" aria-label="結束日期" value={days.at(-1)?.date} onchange={e => changeRange(e.currentTarget, "end")} class={dateField} />
            </div>
            <label class="flex items-center gap-2 text-xs">
                <span class={rowLabel}>天氣城市</span>
                <input aria-label="天氣城市" bind:value={() => edited.city ?? "", v => setText(edited, "city", v)} autocomplete="off" placeholder="英文較準，例如 Tokyo" class="{field} flex-1 min-w-0 min-h-[44px] text-text-secondary" />
            </label>
            <label class="flex items-center gap-2 text-xs">
                <span class={rowLabel}>當地語言</span>
                <!-- value + onchange, not bind:value, as in EventEditor's type picker. -->
                <span class="relative flex-1 min-w-0">
                    <select aria-label="當地語言" value={edited.lang ?? ""} onchange={e => setText(edited, "lang", e.currentTarget.value)} class="{field} appearance-none w-full min-h-[44px] pr-5 text-text-secondary cursor-pointer">
                        {#each langOptions as [code, label] (code)}
                            <option value={code}>{label}</option>
                        {/each}
                    </select>
                    <ChevronDown size={12} class="pointer-events-none absolute right-0.5 top-1/2 -translate-y-1/2 text-text-muted" aria-hidden="true" />
                </span>
            </label>
            <label class="flex items-center gap-2 text-xs">
                <span class={rowLabel}>地圖</span>
                <span class="relative flex-1 min-w-0">
                    <select aria-label="地圖" value={edited.mapProvider ?? ""} onchange={e => setMap(edited, e.currentTarget.value)} class="{field} appearance-none w-full min-h-[44px] pr-5 text-text-secondary cursor-pointer">
                        {#each MAPS as [value, label] (value)}
                            <option {value}>{label}</option>
                        {/each}
                    </select>
                    <ChevronDown size={12} class="pointer-events-none absolute right-0.5 top-1/2 -translate-y-1/2 text-text-muted" aria-hidden="true" />
                </span>
            </label>
        </div>
        {#if tripError}
            <p role="alert" class="mt-2 flex items-start gap-1.5 text-xs text-danger">
                <TriangleAlert size={13} class="shrink-0 mt-0.5" aria-hidden="true" />{tripError}
            </p>
        {/if}
        <p class="text-xs text-accent mt-3">點文字就能直接修改，改完按右上角 ✓ 儲存</p>
    </div>
{/snippet}

{#snippet editingHotels(edited: TripData["trip"])}
    <div class="mt-6">
        <h3 class="text-[11px] font-bold text-text-muted mb-2 px-1">住宿</h3>
        <div class="space-y-3">
            {#each edited.hotels as hotel, i (hotel)}
                <EventEditor
                    bind:entry={() => hotel, v => (edited.hotels[i] = v as HotelInfo)}
                    error={tripEdit.errors.get(hotel)}
                    onMoveUp={i > 0 ? () => moveItem(edited.hotels, i, -1) : undefined}
                    onMoveDown={i < edited.hotels.length - 1 ? () => moveItem(edited.hotels, i, 1) : undefined}
                    onInsertBelow={() => edited.hotels.splice(i + 1, 0, newHotel(hotel.end.slice(0, 10) || trip.start))}
                    onRemove={() => edited.hotels.splice(i, 1)}
                />
            {/each}
            <button type="button" onclick={() => edited.hotels.push(newHotel(edited.hotels.at(-1)?.end.slice(0, 10) || trip.start))} class="btn-secondary w-full border-dashed">
                <Plus size={14} aria-hidden="true" />新增住宿
            </button>
        </div>
    </div>
    {#if edited.attachments?.length}
        <div class="mt-6">
            <h3 class="text-[11px] font-bold text-text-muted mb-2 px-1">附件</h3>
            {#each edited.attachments as attachment, i (attachment)}
                <div class="flex items-center gap-1">
                    <input aria-label="附件名稱" bind:value={attachment.label} autocomplete="off" class="{field} flex-1 min-w-0 min-h-[44px] text-xs text-text-secondary" />
                    <button
                        type="button"
                        onclick={() => edited.attachments?.splice(i, 1)}
                        aria-label="刪除這個附件"
                        title="刪除這個附件"
                        class="min-w-[44px] min-h-[44px] -mr-2 flex items-center justify-center rounded-xl text-text-muted hover:text-text-primary hover:bg-tint-2 transition cursor-pointer"
                    >
                        <X size={16} aria-hidden="true" />
                    </button>
                </div>
            {/each}
        </div>
    {/if}
{/snippet}

{#if draftTrip}
    {@render editingHeader(draftTrip)}
{:else}
    <div class="panel rounded-2xl p-6 mb-6">
        <div class="flex justify-between items-start gap-2">
            <h2 class="text-2xl font-extrabold text-text-primary tracking-tight min-w-0 break-words">
                {trip.name}
            </h2>
            <!-- -mt-1.5 centres the 44px button on the title's first 32px line. -->
            <div class="shrink-0 -mr-2 -mt-1.5">
                <CardActionsToggle bind:open={actionsOpen} {sharing} />
            </div>
        </div>
        {#if actionsOpen}
            <CardActions shareLabel="分享行程" {onShare} {sharing} onDone={() => (actionsOpen = false)} class="mt-3 mb-2" />
        {/if}
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
                    class="btn-secondary shrink-0 active:scale-95"
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
{/if}

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
{#if draftTrip}
    {@render editingHotels(draftTrip)}
{:else if hotelList.length > 0}
    <div class="mt-6">
        <h3 class="text-[11px] font-bold text-text-muted mb-2 px-1">住宿</h3>
        <HotelCards hotels={hotelList} {todayIso} driverPrompt={langConfig.driverPrompt} mapProvider={trip.mapProvider} {onEnlarge} />
    </div>
{/if}

{#if !draftTrip && trip.attachments && trip.attachments.length > 0}
    <div class="mt-6">
        <h3 class="text-[11px] font-bold text-text-muted mb-2 px-1">附件</h3>
        <div class="flex flex-wrap gap-2">
            {#each trip.attachments as attachment, k (`${k}-${attachment.fileId}`)}
                <AttachmentChip {attachment} />
            {/each}
        </div>
    </div>
{/if}
