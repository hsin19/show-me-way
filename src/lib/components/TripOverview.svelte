<script lang="ts">
import BedDouble from "@lucide/svelte/icons/bed-double";
import CalendarRange from "@lucide/svelte/icons/calendar-range";
import ChevronDown from "@lucide/svelte/icons/chevron-down";
import ChevronRight from "@lucide/svelte/icons/chevron-right";
import Layers from "@lucide/svelte/icons/layers";
import ListChecks from "@lucide/svelte/icons/list-checks";
import Maximize2 from "@lucide/svelte/icons/maximize-2";
import MessageSquareText from "@lucide/svelte/icons/message-square-text";
import Plus from "@lucide/svelte/icons/plus";
import Settings from "@lucide/svelte/icons/settings";
import Share2 from "@lucide/svelte/icons/share-2";
import Trash2 from "@lucide/svelte/icons/trash-2";
import Wallet from "@lucide/svelte/icons/wallet";
import type {
    DayItinerary,
    ProfileInfo,
    TripData,
} from "../api";
import type { EnlargedCard } from "../enlarge";
import {
    computeLedgerTotals,
    type ExpenseItem,
    getCurrencyConfig,
} from "../ledger";
import { getLanguageConfig } from "../phrases";
import {
    formatDateRange,
    formatDayDate,
    isOvernightStay,
} from "../utils";
import type { DailyWeather } from "../weather";
import HotelCards from "./HotelCards.svelte";
import WeatherBadge from "./WeatherBadge.svelte";

interface Props {
    trip: TripData["trip"];
    days: DayItinerary[];
    /** Pre-derived status label: countdown before the trip, next/in-progress event during it. */
    countdownText: string;
    /** Other saved trips (the active one is `trip` itself); empty when none parked. */
    profiles: ProfileInfo[];
    /** Local YYYY-MM-DD "today"; drives the phase card and the 今晚入住 highlight. */
    todayIso: string;
    /** Checked / total across todo + packing, for the pre-trip progress card. */
    prepDone: number;
    prepTotal: number;
    /** Expense records, for the post-trip spend summary card. */
    expenses: ExpenseItem[];
    /** This day's forecast; null hides the badge (same contract as Timeline). */
    weatherFor: (day: DayItinerary) => DailyWeather | null;
    onSelectDay: (day: number) => void;
    /** Show a hotel's address/confirmation enlarged; the overlay is a single app-level instance. */
    onEnlarge: (card: EnlargedCard) => void;
    /** Jump to the 準備 tab (pre-trip progress card). */
    onOpenPrepare: () => void;
    /** Open the ledger / phrase-deck tool sheets (owned by App). */
    onOpenLedger: () => void;
    onOpenPhrases: () => void;
    onSwitchProfile: (id: string) => void;
    onCreateProfile: () => void;
    onDeleteProfile: (id: string, name: string) => void;
    onShare: () => void;
    onOpenSettings: () => void;
}

let {
    trip,
    days,
    countdownText,
    profiles,
    todayIso,
    prepDone,
    prepTotal,
    expenses,
    weatherFor,
    onSelectDay,
    onEnlarge,
    onOpenPrepare,
    onOpenLedger,
    onOpenPhrases,
    onSwitchProfile,
    onCreateProfile,
    onDeleteProfile,
    onShare,
    onOpenSettings,
}: Props = $props();

// Collapsed by default — the switcher is a secondary action below the day list.
let showProfiles = $state(false);

// Trip phase drives which single helper card shows under the hero: prep
// progress before the trip, tonight's hotel during it, spend summary after.
// Plain string compare is safe for local-time YYYY-MM-DD dates.
let phase = $derived(todayIso < trip.start ? "before" : todayIso > trip.end ? "after" : "during");

let hotelList = $derived(trip.hotels ?? []);
// Same overnight semantics as Timeline (checkout day belongs to the next hotel).
let tonightHotel = $derived(hotelList.find(h => isOvernightStay(h, todayIso)) ?? null);

// Built-in phrase deck / driver prompt resolved from trip.lang (English fallback).
let langConfig = $derived(getLanguageConfig(trip.lang));

let ledgerTotals = $derived(computeLedgerTotals(expenses));
let currencySymbol = $derived(getCurrencyConfig((trip.currency ?? "TWD").toUpperCase()).currencySymbol);
</script>

<!-- Trip hero card -->
<div class="panel rounded-2xl p-6 mb-6">
    <h2 class="text-2xl font-extrabold text-text-primary tracking-tight">
        {trip.name}
    </h2>
    <p class="text-xs text-text-secondary font-medium tracking-wide mt-1.5 flex items-center gap-1.5">
        <CalendarRange size={14} class="shrink-0" aria-hidden="true" />
        {formatDateRange(trip.start, trip.end)}・共 {days.length} 天
    </p>
    <div class="mt-4 inline-flex max-w-full items-center bg-accent/12 text-accent text-xs font-bold px-3.5 py-2 rounded-full">
        <span class="truncate">{countdownText}</span>
    </div>
</div>

<!-- Phase-aware helper card: exactly one of prep progress (before the trip),
     tonight's hotel (during), or the spend summary (after). -->
{#if phase === "before" && prepTotal > 0}
    <button
        onclick={onOpenPrepare}
        class="w-full panel rounded-xl p-3.5 mb-6 flex items-center gap-3 text-left hover:bg-white/5 transition cursor-pointer"
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
        class="w-full panel rounded-xl p-3.5 mb-6 flex items-center gap-3 text-left hover:bg-white/5 transition cursor-pointer"
    >
        <Wallet size={16} class="shrink-0 text-accent" aria-hidden="true" />
        <span class="flex-1 min-w-0">
            <span class="block text-[11px] font-bold text-text-muted">旅程消費總結</span>
            <span class="block text-sm font-bold text-text-primary">共 {expenses.length} 筆・花費 {currencySymbol}{ledgerTotals.totalSpent.toLocaleString()}</span>
        </span>
        <ChevronRight size={16} class="text-text-muted shrink-0" aria-hidden="true" />
    </button>
{/if}

<!-- Per-day jump list -->
<div class="space-y-2">
    {#each days as day (day.day)}
        {@const weather = weatherFor(day)}
        <button
            onclick={() => onSelectDay(day.day)}
            class="w-full panel rounded-xl p-3.5 flex items-center gap-3 text-left hover:bg-white/5 transition cursor-pointer"
        >
            <div class="shrink-0 w-[56px] flex flex-col items-center">
                <span class="text-[11px] font-bold text-accent">DAY {String(day.day).padStart(2, "0")}</span>
                <span class="text-sm font-bold text-text-primary mt-0.5">{formatDayDate(day.date).split("(")[0]}</span>
            </div>
            <div class="flex-1 min-w-0">
                <p class="text-sm font-semibold text-text-primary truncate">{day.region}</p>
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

<!-- Hotels: moved here from the removed 助手 tab — during the trip you're on
     this panel anyway, so the driver card is one tap away. -->
{#if hotelList.length > 0}
    <div class="mt-6">
        <h3 class="text-[11px] font-bold text-text-muted mb-2 px-1">住宿</h3>
        <HotelCards hotels={hotelList} {todayIso} driverPrompt={langConfig.driverPrompt} {onEnlarge} />
    </div>
{/if}

<!-- Tool entries: rarely-used features demoted from the tab bar into sheets. -->
<div class="grid grid-cols-2 gap-2 mt-6">
    <button
        onclick={onOpenLedger}
        class={[
            "bg-white/3 border border-card-border text-text-secondary font-bold py-3.5 px-4 rounded-xl text-xs flex items-center justify-center gap-1.5 hover:bg-white/5 hover:text-accent transition cursor-pointer",
            langConfig.phrases.length === 0 && "col-span-2",
        ]}
    >
        <Wallet size={14} aria-hidden="true" /> 匯率與記帳
    </button>
    {#if langConfig.phrases.length > 0}
        <button
            onclick={onOpenPhrases}
            class="bg-white/3 border border-card-border text-text-secondary font-bold py-3.5 px-4 rounded-xl text-xs flex items-center justify-center gap-1.5 hover:bg-white/5 hover:text-accent transition cursor-pointer"
        >
            <MessageSquareText size={14} aria-hidden="true" /> 實用常用語
        </button>
    {/if}
</div>

<!-- Trip profile switcher: swap to another saved trip or start a new one.
     Lives here (not in Settings) so it's a top-level navigation action; the
     active trip is `trip`, `profiles` holds the other parked ones. -->
<div class="mt-6">
    <button
        onclick={() => (showProfiles = !showProfiles)}
        aria-expanded={showProfiles}
        class="w-full panel rounded-xl p-3.5 flex items-center gap-2.5 text-left hover:bg-white/5 transition cursor-pointer"
    >
        <Layers size={16} class="shrink-0 text-accent" aria-hidden="true" />
        <span class="flex-1 min-w-0">
            <span class="block text-[11px] font-bold text-text-muted">目前行程</span>
            <span class="block text-sm font-bold text-text-primary truncate">{trip.name}</span>
        </span>
        <ChevronDown size={16} class="shrink-0 text-text-muted transition-transform {showProfiles ? 'rotate-180' : ''}" aria-hidden="true" />
    </button>
    {#if showProfiles}
        <div class="mt-2 space-y-1.5">
            {#each profiles as profile (profile.id)}
                <div class="flex items-center gap-1">
                    <button
                        onclick={() => onSwitchProfile(profile.id)}
                        class="flex-1 min-w-0 min-h-[44px] flex items-center justify-between gap-2 px-3.5 rounded-xl bg-white/3 border border-card-border text-text-secondary hover:text-accent hover:bg-white/5 transition cursor-pointer"
                    >
                        <span class="truncate text-sm font-semibold">{profile.name}</span>
                        <span class="shrink-0 text-[11px] font-bold">切換</span>
                    </button>
                    <button
                        onclick={() => onDeleteProfile(profile.id, profile.name)}
                        aria-label="刪除行程 {profile.name}"
                        class="shrink-0 min-w-[44px] min-h-[44px] flex items-center justify-center text-text-muted hover:text-danger transition cursor-pointer"
                    >
                        <Trash2 size={16} aria-hidden="true" />
                    </button>
                </div>
            {/each}
            <button
                onclick={onCreateProfile}
                class="w-full min-h-[44px] flex items-center justify-center gap-1.5 px-3.5 rounded-xl bg-white/3 border border-dashed border-card-border text-text-secondary hover:text-accent hover:bg-white/5 transition cursor-pointer text-xs font-bold"
            >
                <Plus size={14} aria-hidden="true" /> 新增行程
            </button>
        </div>
    {/if}
</div>

<!-- Share + YAML settings entry — these replaced the old header gear button
     and the share button that used to live inside the settings modal. -->
<div class="grid grid-cols-2 gap-2 mt-3">
    <button
        onclick={onShare}
        class="bg-accent/10 text-accent font-bold py-3.5 px-4 rounded-xl text-xs flex items-center justify-center gap-1.5 hover:bg-accent/15 transition active:scale-[0.98] cursor-pointer"
    >
        <Share2 size={14} aria-hidden="true" /> 分享行程
    </button>
    <button
        onclick={onOpenSettings}
        class="bg-white/3 border border-card-border text-text-secondary font-bold py-3.5 px-4 rounded-xl text-xs flex items-center justify-center gap-1.5 hover:bg-white/5 hover:text-text-primary transition cursor-pointer"
    >
        <Settings size={14} aria-hidden="true" /> 自訂 YAML 行程
    </button>
</div>
