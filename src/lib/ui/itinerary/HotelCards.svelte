<script lang="ts">
import { isOvernightStay } from "$lib/domain/timeline";
import type { HotelInfo } from "$lib/domain/trip";
import type { EnlargedCard } from "$lib/ui/shared/enlarge";
import EventCard from "./EventCard.svelte";

interface Props {
    hotels: HotelInfo[];
    /** Local YYYY-MM-DD; drives which stay reads as in progress, and the sort. */
    todayIso: string;
    /** The trip language's "please take me here" line, for the driver card. */
    driverPrompt: string;
    mapProvider?: string;
    /** Ask App to open the fullscreen card; this component never renders a layer of its own. */
    onEnlarge: (card: EnlargedCard) => void;
}

let { hotels, todayIso, driverPrompt, mapProvider, onEnlarge }: Props = $props();

// Shared with Timeline and the 報平安 report, so a changeover day cannot end up
// marking both hotels.
function isCurrentStay(hotel: HotelInfo): boolean {
    return isOvernightStay(hotel, todayIso);
}

// Outside the trip nothing matches and the YAML order survives.
let sortedHotels = $derived(
    [...hotels].sort((a, b) => Number(isCurrentStay(b)) - Number(isCurrentStay(a))),
);
</script>

<div class="space-y-3">
    <!-- Index in the key: two stays at the same hotel are legal YAML, and a duplicate key throws in production. -->
    {#each sortedHotels as hotel, i (`${i}-${hotel.title}`)}
        <EventCard event={hotel} timeStatus={isCurrentStay(hotel) ? "current" : null} {driverPrompt} {mapProvider} {onEnlarge} />
    {/each}
</div>
