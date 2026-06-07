<script lang="ts">
interface DayInfo {
    day: number;
    date: string;
}

interface Props {
    days: DayInfo[];
    currentDay: number;
}

let { days, currentDay = $bindable() }: Props = $props();
</script>

<div class="overflow-x-auto no-scrollbar pb-3">
    <div class="flex gap-2">
        {#each days as { day, date } (day)}
            <button
                class="
                    flex-none w-[76px] flex flex-col items-center justify-center p-2 rounded-xl border transition-all duration-300 cursor-pointer
                    {currentDay === day
                    ? 'bg-gradient-to-br from-neon-blue/15 to-neon-pink/10 border-neon-blue shadow-[0_0_15px_rgba(0,240,255,0.25)]'
                    : 'bg-white/3 border-card-border hover:bg-white/5'}
                "
                onclick={() => (currentDay = day)}
            >
                <span class="text-[11px] font-medium {currentDay === day ? 'text-neon-blue' : 'text-text-muted'}">DAY 0{day}</span>
                <span class="text-[15px] font-bold mt-0.5 {currentDay === day ? 'text-text-primary' : 'text-text-secondary'}">
                    {date.split("(")[0]}
                </span>
            </button>
        {/each}
    </div>
</div>
