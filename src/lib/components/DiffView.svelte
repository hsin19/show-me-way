<script lang="ts">
import ChevronDown from "@lucide/svelte/icons/chevron-down";
import ChevronUp from "@lucide/svelte/icons/chevron-up";
import {
    diffLines,
    diffStats,
} from "../diff";

interface Props {
    /** Itinerary YAML before the proposed edit. */
    base: string;
    /** Itinerary YAML the model proposed. */
    proposed: string;
}

let { base, proposed }: Props = $props();

let lines = $derived(diffLines(base, proposed));
let stats = $derived(diffStats(lines));

// First line index of each change "hunk" (a run of added/removed lines), used
// as the jump targets for the prev/next buttons.
let hunkStarts = $derived.by(() => {
    const starts: number[] = [];
    let inHunk = false;
    lines.forEach((line, i) => {
        const changed = line.type !== "equal";
        if (changed && !inHunk) starts.push(i);
        inHunk = changed;
    });
    return starts;
});

let scrollEl = $state<HTMLDivElement>();
// Per-line element refs, so a jump can scroll the hunk to the container's center
// without moving the outer chat scroll (offsetTop is relative to scrollEl).
let lineEls: HTMLElement[] = [];
let current = $state(-1);

// Cycle to the next/previous hunk and center it in the scroll container.
function jump(dir: 1 | -1) {
    const n = hunkStarts.length;
    if (n === 0) return;
    current = (current + dir + n) % n;
    const el = lineEls[hunkStarts[current]];
    if (el && scrollEl) {
        scrollEl.scrollTo({
            top: el.offsetTop - scrollEl.clientHeight / 2 + el.clientHeight / 2,
            behavior: "smooth",
        });
    }
}
</script>

<details class="group">
    <summary class="text-xs text-text-secondary cursor-pointer select-none hover:text-text-primary transition flex items-center gap-2">
        查看變更
        <span class="font-mono text-[11px]">
            <span class="text-emerald-400">+{stats.added}</span>
            <span class="text-neon-pink">-{stats.removed}</span>
        </span>
    </summary>
    {#if hunkStarts.length === 0}
        <p class="mt-2 text-[11px] text-text-muted">與目前行程沒有差異。</p>
    {:else}
        <div class="mt-2 flex items-center justify-between gap-2">
            <span class="text-[11px] text-text-muted">
                {#if current >= 0}第 {current + 1} / {hunkStarts.length} 處{:else}共 {hunkStarts.length} 處變更{/if}
            </span>
            <div class="flex items-center gap-1">
                <button
                    onclick={() => jump(-1)}
                    aria-label="上一處變更"
                    class="p-1 rounded-md bg-black/40 border border-card-border text-text-secondary hover:text-neon-blue hover:border-neon-blue transition cursor-pointer"
                >
                    <ChevronUp size={14} aria-hidden="true" />
                </button>
                <button
                    onclick={() => jump(1)}
                    aria-label="下一處變更"
                    class="p-1 rounded-md bg-black/40 border border-card-border text-text-secondary hover:text-neon-blue hover:border-neon-blue transition cursor-pointer"
                >
                    <ChevronDown size={14} aria-hidden="true" />
                </button>
            </div>
        </div>
        <div
            bind:this={scrollEl}
            class="relative mt-1.5 max-h-60 overflow-auto rounded-lg bg-black/40 py-1 font-mono text-[11px] leading-relaxed"
        >
            {#each lines as line, i (i)}
                <div
                    bind:this={lineEls[i]}
                    class="
                        px-2 whitespace-pre-wrap break-words {line.type === 'added'
                        ? 'bg-emerald-500/15 text-emerald-300'
                        : line.type === 'removed'
                        ? 'bg-neon-pink/15 text-neon-pink'
                        : 'text-text-muted'}
                    "
                >
                    <span class="select-none opacity-60">{line.type === "added" ? "+" : line.type === "removed" ? "-" : " "} </span>{line.text}
                </div>
            {/each}
        </div>
    {/if}
</details>
