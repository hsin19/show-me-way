<script lang="ts">
import {
    Check,
    Plus,
    Trash2,
} from "@lucide/svelte";

import type { ChecklistItem } from "../api";

interface Props {
    title: string;
    items: ChecklistItem[];
    onToggle: (id: string) => void;
    onAdd: (text: string) => void;
    onDelete: (id: string) => void;
}

let { title, items, onToggle, onAdd, onDelete }: Props = $props();

let newText = $state("");

function submitNew(e: SubmitEvent) {
    e.preventDefault();
    const text = newText.trim();
    if (!text) return;
    onAdd(text);
    newText = "";
}
</script>

<div class="glass-panel rounded-2xl p-5 mb-5">
    <h3 class="text-base font-bold text-text-primary mb-4">{title}</h3>
    <ul class="space-y-1">
        {#each items as item (item._id ?? item.text)}
            <li class="flex items-start gap-3 py-3 border-b border-white/5 last:border-b-0 group">
                <!-- svelte-ignore a11y_click_events_have_key_events -->
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <div
                    onclick={() => onToggle(item._id!)}
                    class="flex items-start gap-3 flex-1 min-w-0 cursor-pointer"
                >
                    <div
                        class="
                            w-5 h-5 rounded-md border-2 border-text-muted bg-white/2 flex items-center justify-center flex-shrink-0 mt-0.5 transition-all duration-300
                            {item.checked ? 'border-accent-green bg-accent-green/15' : 'group-hover:border-neon-blue'}
                        "
                    >
                        {#if item.checked}
                            <Check size={12} class="stroke-accent-green stroke-[4]" />
                        {/if}
                    </div>
                    <span
                        class="
                            text-sm transition-all duration-300 break-words
                            {item.checked ? 'text-text-muted line-through' : 'text-text-primary group-hover:text-neon-blue'}
                        "
                    >
                        {item.text}
                    </span>
                </div>
                <button
                    onclick={() => onDelete(item._id!)}
                    aria-label="刪除項目"
                    class="text-text-muted hover:text-neon-pink p-1 -m-1 flex-shrink-0 opacity-60 hover:opacity-100 transition cursor-pointer"
                >
                    <Trash2 size={15} />
                </button>
            </li>
        {/each}
        {#if items.length === 0}
            <li class="text-xs text-text-muted py-3 text-center">尚無項目，於下方新增。</li>
        {/if}
    </ul>

    <form onsubmit={submitNew} class="flex items-center gap-2 mt-3">
        <input
            bind:value={newText}
            placeholder="新增項目…"
            class="flex-1 min-w-0 bg-black/40 border border-card-border rounded-xl px-3 py-2 text-sm text-text-primary outline-none focus:border-neon-blue transition"
        />
        <button
            type="submit"
            aria-label="新增項目"
            class="flex-shrink-0 bg-gradient-to-r from-neon-blue to-neon-purple text-black rounded-xl p-2 transition active:scale-[0.96] cursor-pointer disabled:opacity-40"
            disabled={!newText.trim()}
        >
            <Plus size={18} class="stroke-[3]" />
        </button>
    </form>
</div>
