<script lang="ts">
import { isOvernightStay } from "$lib/domain/timeline";
import type { HotelInfo } from "$lib/domain/trip";
import { splitDayDate } from "$lib/domain/utils";
import { copyToClipboard } from "$lib/stores/toast.svelte";
import type { EnlargedCard } from "$lib/ui/shared/enlarge";
import BedDouble from "@lucide/svelte/icons/bed-double";
import Calendar from "@lucide/svelte/icons/calendar";
import Copy from "@lucide/svelte/icons/copy";
import Maximize2 from "@lucide/svelte/icons/maximize-2";
import ConfirmationChips from "./ConfirmationChips.svelte";

interface Props {
    hotels: HotelInfo[];
    /** Local YYYY-MM-DD; drives the 今晚入住 highlight and the sort. */
    todayIso: string;
    /** The trip language's "please take me here" line, for the driver card. */
    driverPrompt: string;
    /** Ask App to open the fullscreen card; this component never renders a layer of its own. */
    onEnlarge: (card: EnlargedCard) => void;
}

let { hotels, todayIso, driverPrompt, onEnlarge }: Props = $props();

// Shared with Timeline and the 報平安 report, so a changeover day cannot end up
// marking both hotels.
function isCurrentStay(hotel: HotelInfo): boolean {
    return isOvernightStay(hotel, todayIso);
}

// Outside the trip nothing matches and the YAML order survives.
let sortedHotels = $derived(
    [...hotels].sort((a, b) => Number(isCurrentStay(b)) - Number(isCurrentStay(a))),
);

function showAddressForDriver(hotel: HotelInfo) {
    onEnlarge({
        kind: "place",
        title: hotel.name,
        localName: hotel.localName ?? hotel.name,
        address: hotel.address,
        prompt: driverPrompt,
    });
}
</script>

<div class="space-y-3">
    <!-- Index in the key: two stays at the same hotel are legal YAML, and a duplicate key throws in production. -->
    {#each sortedHotels as hotel, i (`${i}-${hotel.name}`)}
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
                        <span>{splitDayDate(hotel.checkIn).mmdd} 入房 – {splitDayDate(hotel.checkOut).mmdd} 退房</span>
                    </div>
                </div>

                <button
                    onclick={() => copyToClipboard(`${hotel.name}\n${hotel.address}`, "已複製飯店地址資訊")}
                    class="min-w-[44px] min-h-[44px] flex items-center justify-center text-text-secondary border border-card-border rounded-lg transition hover:bg-tint-2 hover:text-text-primary cursor-pointer flex-shrink-0"
                    aria-label="複製地址"
                    title="複製地址"
                >
                    <Copy size={14} aria-hidden="true" />
                </button>
            </div>

            <div class="bg-well border border-card-border p-3.5 rounded-xl text-center font-bold text-base text-text-primary tracking-wide my-3">
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
