<script lang="ts">
import { Check } from "@lucide/svelte";
import { onMount } from "svelte";

interface ChecklistItem {
    id: string;
    text: string;
    checked?: boolean;
}

interface Props {
    title: string;
    storageKey: string;
    defaultItems: ChecklistItem[];
}

let { title, storageKey, defaultItems }: Props = $props();

let checkedMap = $state<Record<string, boolean>>({});

onMount(() => {
    try {
        const saved = localStorage.getItem(storageKey);
        if (saved) {
            checkedMap = JSON.parse(saved);
        } else {
            // Initialize default checked states from each item's `checked` field
            const initial: Record<string, boolean> = {};
            defaultItems.forEach((item: ChecklistItem) => {
                initial[item.id] = item.checked ?? false;
            });
            checkedMap = initial;
            localStorage.setItem(storageKey, JSON.stringify(initial));
        }
    } catch (e) {
        console.error("Error loading checklist states:", e);
    }
});

function toggle(id: string) {
    checkedMap[id] = !checkedMap[id];
    localStorage.setItem(storageKey, JSON.stringify(checkedMap));
}
</script>

<div class="glass-panel rounded-2xl p-5 mb-5">
    <h3 class="text-base font-bold text-text-primary mb-4">{title}</h3>
    <ul class="space-y-1">
        {#each defaultItems as item (item.id)}
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
            <li
                onclick={() => toggle(item.id)}
                class="flex items-start gap-3 py-3 border-b border-white/5 last:border-b-0 cursor-pointer group"
            >
                <div
                    class="
                        w-5 h-5 rounded-md border-2 border-text-muted bg-white/2 flex items-center justify-center flex-shrink-0 mt-0.5 transition-all duration-300
                        {checkedMap[item.id] ? 'border-accent-green bg-accent-green/15' : 'group-hover:border-neon-blue'}
                    "
                >
                    {#if checkedMap[item.id]}
                        <Check size={12} class="stroke-accent-green stroke-[4]" />
                    {/if}
                </div>
                <span
                    class="
                        text-sm transition-all duration-300
                        {checkedMap[item.id] ? 'text-text-muted line-through' : 'text-text-primary group-hover:text-neon-blue'}
                    "
                >
                    {item.text}
                </span>
            </li>
        {/each}
    </ul>
</div>
