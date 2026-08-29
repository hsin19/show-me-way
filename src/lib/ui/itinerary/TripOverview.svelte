<script lang="ts">
import {
    computeLedgerTotals,
    type ExpenseItem,
    formatAmount,
    getCurrencyConfig,
} from "$lib/domain/ledger";
import { getLanguageConfig } from "$lib/domain/phrases";
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
import CalendarRange from "@lucide/svelte/icons/calendar-range";
import ChevronDown from "@lucide/svelte/icons/chevron-down";
import ChevronRight from "@lucide/svelte/icons/chevron-right";
import FolderKanban from "@lucide/svelte/icons/folder-kanban";
import ListChecks from "@lucide/svelte/icons/list-checks";
import Maximize2 from "@lucide/svelte/icons/maximize-2";
import Share2 from "@lucide/svelte/icons/share-2";
import Wallet from "@lucide/svelte/icons/wallet";
import HotelCards from "./HotelCards.svelte";
import WeatherBadge from "./WeatherBadge.svelte";

interface Props {
    trip: TripData["trip"];
    days: DayItinerary[];
    /** Already worded by the caller — a countdown, or what is happening now. */
    countdownText: string;
    /** Local YYYY-MM-DD; the whole panel's notion of "today" comes from here, not from the clock. */
    todayIso: string;
    prepDone: number;
    prepTotal: number;
    expenses: ExpenseItem[];
    profiles?: ProfileInfo[];
    /** Null hides the badge, same contract as Timeline. */
    weatherFor: (day: DayItinerary) => DailyWeather | null;
    onSelectDay: (day: number) => void;
    /** Ask App to open the fullscreen card; this component never renders a layer of its own. */
    onEnlarge: (card: EnlargedCard) => void;
    /** Deep-links out of the phase card into a 工具 sub-page. */
    onOpenPrepare: () => void;
    onOpenLedger: () => void;
    onShare: () => void;
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
    todayIso,
    prepDone,
    prepTotal,
    expenses,
    profiles = [],
    weatherFor,
    onSelectDay,
    onEnlarge,
    onOpenPrepare,
    onOpenLedger,
    onShare,
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

let hotelList = $derived(trip.hotels ?? []);
let tonightHotel = $derived(hotelList.find(h => isOvernightStay(h, todayIso)) ?? null);

let langConfig = $derived(getLanguageConfig(trip.lang));

let ledgerTotals = $derived(computeLedgerTotals(expenses));
let currencySymbol = $derived(getCurrencyConfig((trip.currency ?? "TWD").toUpperCase()).currencySymbol);
</script>

<div class="panel rounded-2xl p-6 mb-6">
    <div class="flex justify-between items-start gap-2">
        <h2 class="text-2xl font-extrabold text-text-primary tracking-tight min-w-0 break-words">
            {trip.name}
        </h2>
        <button
            type="button"
            onclick={onShare}
            class="min-w-[44px] min-h-[44px] -mr-2 -mt-1 flex items-center justify-center rounded-xl text-accent hover:bg-accent/10 active:scale-95 transition cursor-pointer shrink-0"
            aria-label="分享行程"
            title="分享行程"
        >
            <Share2 size={18} aria-hidden="true" />
        </button>
    </div>
    <p class="text-xs text-text-secondary font-medium tracking-wide mt-1.5 flex items-center gap-1.5">
        <CalendarRange size={14} class="shrink-0" aria-hidden="true" />
        {formatDateRange(trip.start, trip.end)}・共 {days.length} 天
    </p>

    <!-- Deliberately NOT flex-wrap: wrapping is decided from each item's full
         content width BEFORE any shrinking, so a long capsule label would drop to
         a second row untouched instead of ellipsing. -->
    <div class="mt-4 flex items-center justify-between gap-2">
        <!-- `min-w-0` is what lets the inner `truncate` work at all: without it
             this flex item cannot shrink below its content, and a long 進行中 label
             pushes the switcher off the row. -->
        <div data-countdown class="inline-flex min-w-0 items-center bg-accent/12 text-accent text-xs font-bold px-3.5 py-2 rounded-full">
            <span class="truncate">{countdownText}</span>
        </div>

        {#if onSwitchProfile && onCreateProfile}
            <button
                type="button"
                onclick={toggleSwitcher}
                class="inline-flex items-center gap-1.5 bg-tint-1 border border-card-border hover:border-accent/40 text-text-primary hover:text-accent text-xs font-bold px-3.5 py-2 rounded-full transition cursor-pointer active:scale-95 shrink-0"
                aria-expanded={isSwitcherOpen}
                aria-label="切換行程選單"
            >
                <FolderKanban size={13} class="shrink-0 text-accent" aria-hidden="true" />
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

<!-- Exactly one helper card, chosen by trip phase — what matters before, during
     and after a trip is not the same thing. -->
{#if phase === "before" && prepTotal > 0}
    <button
        onclick={onOpenPrepare}
        class="w-full panel rounded-xl p-3.5 mb-6 flex items-center gap-3 text-left hover:bg-tint-2 transition cursor-pointer"
    >
        <ListChecks size={16} class="shrink-0 text-accent" aria-hidden="true" />
        <span class="flex-1 min-w-0">
            <span class="block text-[11px] font-bold text-text-muted">行前準備</span>
            <span class="block text-sm font-bold text-text-primary">{prepDone}/{prepTotal} 項完成</span>
        </span>
        <ChevronRight size={16} class="text-text-muted shrink-0" aria-hidden="true" />
    </button>
{:else if phase === "during" && tonightHotel}
    {@const hotel = tonightHotel}
    <div class="panel rounded-xl p-3.5 mb-6 flex items-center gap-3">
        <BedDouble size={16} class="shrink-0 text-accent" aria-hidden="true" />
        <span class="flex-1 min-w-0">
            <span class="block text-[11px] font-bold text-text-muted">今晚入住</span>
            <span class="block text-sm font-bold text-text-primary truncate">{hotel.name}</span>
        </span>
        <button
            onclick={() => onEnlarge({ kind: "place", title: hotel.name, localName: hotel.localName ?? hotel.name, address: hotel.address, prompt: langConfig.driverPrompt })}
            aria-label="放大顯示今晚飯店給司機看"
            class="shrink-0 min-w-[44px] min-h-[44px] -my-1.5 flex items-center justify-center bg-accent/10 text-accent rounded-lg transition duration-200 hover:bg-accent/20 cursor-pointer"
        >
            <Maximize2 size={15} aria-hidden="true" />
        </button>
    </div>
{:else if phase === "after" && expenses.length > 0}
    <button
        onclick={onOpenLedger}
        class="w-full panel rounded-xl p-3.5 mb-6 flex items-center gap-3 text-left hover:bg-tint-2 transition cursor-pointer"
    >
        <Wallet size={16} class="shrink-0 text-accent" aria-hidden="true" />
        <span class="flex-1 min-w-0">
            <span class="block text-[11px] font-bold text-text-muted">旅程消費總結</span>
            <span class="block text-sm font-bold text-text-primary">共 {expenses.length} 筆・花費 {formatAmount(currencySymbol, ledgerTotals.totalSpent)}</span>
        </span>
        <ChevronRight size={16} class="text-text-muted shrink-0" aria-hidden="true" />
    </button>
{/if}

<div class="space-y-2">
    {#each days as day (day.day)}
        {@const weather = weatherFor(day)}
        {@const date = splitDayDate(day.date)}
        <button
            onclick={() => onSelectDay(day.day)}
            class="w-full panel rounded-xl p-3.5 flex items-center gap-3 text-left hover:bg-tint-2 transition cursor-pointer"
        >
            <!-- Same two lines as DayChip, so the list and the strip read as one
                 thing; keep them in step. -->
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
        <HotelCards hotels={hotelList} {todayIso} driverPrompt={langConfig.driverPrompt} {onEnlarge} />
    </div>
{/if}
