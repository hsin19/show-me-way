<script lang="ts">
import Check from "@lucide/svelte/icons/check";
import Plus from "@lucide/svelte/icons/plus";
import Trash2 from "@lucide/svelte/icons/trash-2";
import type { Component } from "svelte";

import type { ChecklistItem } from "../api";

interface Props {
    title: string;
    icon?: Component;
    items: ChecklistItem[];
    onToggle: (id: string) => void;
    onAdd: (text: string) => void;
    onDelete: (id: string) => void;
}

let { title, icon: TitleIcon, items, onToggle, onAdd, onDelete }: Props = $props();

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
    <h3 class="text-base font-bold text-text-primary mb-4 flex items-center gap-2">
        {#if TitleIcon}<TitleIcon size={18} class="text-neon-blue" aria-hidden="true" />{/if}
        {title}
    </h3>
    <ul class="space-y-1">
        {#each items as item (item._id ?? item.text)}
            <li class="flex items-start gap-3 py-3 border-b border-white/5 last:border-b-0 group">
                <button
                    type="button"
                    role="checkbox"
                    aria-checked={item.checked}
                    onclick={() => onToggle(item._id!)}
                    class="flex items-start gap-3 flex-1 min-w-0 cursor-pointer text-left bg-transparent border-0 p-0"
                >
                    <span
                        aria-hidden="true"
                        class="
                            w-5 h-5 rounded-md border-2 border-text-muted bg-white/2 flex items-center justify-center flex-shrink-0 mt-0.5 transition-colors duration-300
                            {item.checked ? 'border-accent-green bg-accent-green/15' : 'group-hover:border-neon-blue'}
                        "
                    >
                        {#if item.checked}
                            <Check size={12} class="stroke-accent-green stroke-[4]" aria-hidden="true" />
                        {/if}
                    </span>
                    <span
                        class="
                            text-sm transition-colors duration-300 break-words
                            {item.checked ? 'text-text-muted line-through' : 'text-text-primary group-hover:text-neon-blue'}
                        "
                    >
                        {item.text}
                    </span>
                </button>
                <button
                    onclick={() => onDelete(item._id!)}
                    aria-label="刪除項目"
                    class="text-text-muted hover:text-neon-pink min-w-[44px] min-h-[44px] -m-2.5 flex items-center justify-center flex-shrink-0 opacity-60 hover:opacity-100 transition cursor-pointer"
                >
                    <Trash2 size={16} aria-hidden="true" />
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
            aria-label="{title} — 新增項目"
            autocomplete="off"
            placeholder="新增項目…"
            class="flex-1 min-w-0 bg-black/40 border border-card-border rounded-xl px-3 py-2 text-sm text-text-primary outline-none focus:border-neon-blue transition"
        />
        <button
            type="submit"
            aria-label="新增項目"
            class="flex-shrink-0 bg-gradient-to-r from-neon-blue to-neon-purple text-black rounded-xl p-2 transition active:scale-[0.96] cursor-pointer disabled:opacity-40"
            disabled={!newText.trim()}
        >
            <Plus size={18} class="stroke-[3]" aria-hidden="true" />
        </button>
    </form>
</div>
