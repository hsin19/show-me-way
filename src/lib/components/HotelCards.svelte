<script lang="ts">
import BedDouble from "@lucide/svelte/icons/bed-double";
import Calendar from "@lucide/svelte/icons/calendar";
import Copy from "@lucide/svelte/icons/copy";
import Maximize2 from "@lucide/svelte/icons/maximize-2";
import type { HotelInfo } from "../api";
import type { EnlargedCard } from "../enlarge";
import { copyToClipboard } from "../toast.svelte";
import { isOvernightStay } from "../utils";
import ConfirmationChips from "./ConfirmationChips.svelte";

interface Props {
    hotels: HotelInfo[];
    /** Local YYYY-MM-DD "today"; drives the 今晚入住 highlight and sort. */
    todayIso: string;
    /** Localized prompt shown on the fullscreen driver card (from trip.lang). */
    driverPrompt: string;
    /** Enlarge a hotel's address or confirmation code; single app-level overlay. */
    onEnlarge: (card: EnlargedCard) => void;
}

let { hotels, todayIso, driverPrompt, onEnlarge }: Props = $props();

// Same overnight semantics as Timeline / the 報平安 report (checkout day
// belongs to the next hotel), so a changeover day never marks both hotels.
function isCurrentStay(hotel: HotelInfo): boolean {
    return isOvernightStay(hotel, todayIso);
}

// Tonight's hotel first during the trip; outside the trip nothing matches and
// the YAML order is kept.
let sortedHotels = $derived(
    [...hotels].sort((a, b) => Number(isCurrentStay(b)) - Number(isCurrentStay(a))),
);

// Show the address (and local-language name) full-screen for a driver.
function showAddressForDriver(hotel: HotelInfo) {
    onEnlarge({
        kind: "place",
        title: hotel.name,
        localName: hotel.localName ?? hotel.name,
        address: hotel.address,
        prompt: driverPrompt,
    });
}

// Format YYYY-MM-DD to display MM/DD
function formatShortDate(dateStr: string): string {
    const parts = dateStr.split("-");
    if (parts.length === 3) {
        return `${parts[1]}/${parts[2]}`;
    }
    return dateStr;
}
</script>

<div class="space-y-3">
    {#each sortedHotels as hotel (hotel.name)}
        <div
            class="
                panel rounded-2xl p-5
                {isCurrentStay(hotel) ? 'ring-1 ring-accent/40' : ''}
            "
        >
            <div class="flex justify-between items-start mb-3">
                <div class="space-y-1">
                    <div class="flex items-center gap-2 flex-wrap">
                        <span class="text-sm font-bold text-text-primary block">{hotel.name}</span>
                        {#if isCurrentStay(hotel)}
                            <span class="inline-flex items-center gap-1 text-[11px] bg-accent/12 text-accent font-bold px-1.5 py-0.5 rounded-md">
                                <BedDouble size={11} aria-hidden="true" /> 當前入住
                            </span>
                        {/if}
                    </div>

                    <div class="flex items-center gap-1 text-[10px] text-text-secondary">
                        <Calendar size={10} aria-hidden="true" />
                        <span>{formatShortDate(hotel.checkIn)} 入房 – {formatShortDate(hotel.checkOut)} 退房</span>
                    </div>
                </div>

                <button
                    onclick={() => copyToClipboard(`${hotel.name}\n${hotel.address}`, "已複製飯店地址資訊")}
                    class="min-w-[44px] min-h-[44px] flex items-center justify-center text-text-secondary border border-card-border rounded-lg transition hover:bg-white/5 hover:text-text-primary cursor-pointer flex-shrink-0"
                    aria-label="複製地址"
                    title="複製地址"
                >
                    <Copy size={14} aria-hidden="true" />
                </button>
            </div>

            <div class="bg-black/25 border border-card-border p-3.5 rounded-xl text-center font-bold text-base text-text-primary tracking-wide my-3">
                {hotel.address}
            </div>

            {#if hotel.confirmation}
                <div class="flex flex-wrap gap-2 my-3">
                    <ConfirmationChips confirmation={hotel.confirmation} title={hotel.name} {onEnlarge} />
                </div>
            {/if}

            <button
                onclick={() => showAddressForDriver(hotel)}
                class="w-full bg-accent text-accent-contrast font-bold py-2.5 px-4 rounded-xl text-xs flex items-center justify-center gap-1.5 transition active:scale-[0.98] cursor-pointer"
            >
                <Maximize2 size={12} aria-hidden="true" />
                全螢幕放大給司機看
            </button>
        </div>
    {/each}
</div>
