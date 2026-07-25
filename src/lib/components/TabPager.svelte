<script lang="ts" generics="T extends string | number">
import type { Snippet } from "svelte";
import { fly } from "svelte/transition";
import { edgeFade } from "../edge-fade";
import { prefersReducedMotion } from "../utils";

interface Props {
    /** Ordered keys; drives BOTH the chip row and the panel order, so the two cannot drift. */
    keys: T[];
    /** Visible panel's key. Bindable — external writes (e.g. today-sync) also swap the panel. */
    current: T;
    /**
     * How many leading keys get pinned chips: rendered outside the scroller, so
     * they stay put while the rest scrolls. Must be a leading run — the pinned
     * chips are simply a separate flex child, which only works at one end.
     */
    pinnedCount?: number;
    /**
     * One chip's content, given its key, select(), and whether it is current.
     * `active` comes last so a caller that derives its own highlight can just
     * take (key, select). The caller renders its own <button> — the two rows
     * differ too much to share styling — while TabPager owns the row layout, the
     * scrolling and the edge fade.
     */
    chip: Snippet<[T, (key: T) => void, boolean]>;
    /** The one visible panel; receives the current key and select() (for in-panel navigation). */
    panel: Snippet<[T, (key: T) => void]>;
    /** Called via rAF after a fresh panel mounts and lays out (e.g. scroll to the current event). */
    onPanelReady?: (key: T, panel: HTMLElement) => void;
}

let { keys, current = $bindable(), pinnedCount = 0, chip, panel, onPanelReady }: Props = $props();

let pinnedKeys = $derived(keys.slice(0, pinnedCount));
let scrollKeys = $derived(keys.slice(pinnedCount));

// --- One panel on screen at a time, swapped with a slide transition ---
// Only the current panel is rendered; the view is a pure function of `current`,
// so there is no horizontal scroll machinery to keep in sync. Native vertical
// scroll happens inside the panel; left/right paging is a swipe/wheel gesture
// (or a chip tap) that simply steps `current`. Shared by the itinerary strip
// (overview + days) and the 工具 tab (sub-pages).
// Panel-change slide transition (ms / px). Tweak here for feel.
const PAGE_MS = 280;
const PAGE_SHIFT = 80;

// Slide direction for the transition (+1 = new panel enters from the right).
let dir = $state(1);

// Navigate to a specific panel (chip tap / in-panel link). Sets the slide
// direction from the index delta, then changes the key. External `current`
// writes (via the binding) skip this and reuse the last direction.
function select(key: T) {
    if (key === current) return;
    dir = keys.indexOf(key) >= keys.indexOf(current) ? 1 : -1;
    current = key;
}

// Step to the previous / next panel, clamped to the ends.
function step(delta: number) {
    const i = keys.indexOf(current);
    const next = Math.max(0, Math.min(keys.length - 1, i + delta));
    if (next === i) return;
    dir = delta > 0 ? 1 : -1;
    current = keys[next];
}

// Horizontal swipe (mobile) → step a panel. Read on touchend so vertical
// scrolling is never intercepted; only a clearly-horizontal flick past the
// threshold pages. Gestures starting on form fields or horizontally scrolling
// rows ([data-swipe-ignore]) belong to those elements, never the pager.
const SWIPE_MIN = 50;
let touchX = 0;
let touchY = 0;
let touchIgnored = false;
function onTouchStart(e: TouchEvent) {
    const target = e.target as Element | null;
    touchIgnored = !!target?.closest("input, textarea, select, [data-swipe-ignore]");
    touchX = e.touches[0].clientX;
    touchY = e.touches[0].clientY;
}
function onTouchEnd(e: TouchEvent) {
    if (touchIgnored) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - touchX;
    const dy = t.clientY - touchY;
    if (Math.abs(dx) > SWIPE_MIN && Math.abs(dx) > Math.abs(dy) * 1.5) {
        step(dx < 0 ? 1 : -1);
    }
}

// Desktop horizontal wheel / trackpad → step a panel. One step per gesture (lock
// releases once the wheel goes idle), so a flick's burst can't skip several panels.
let pager = $state<HTMLElement>();
$effect(() => {
    const el = pager;
    if (!el) return;
    let locked = false;
    let idleTimer: number;
    const onWheel = (e: WheelEvent) => {
        if (e.ctrlKey) return; // pinch-zoom
        let horiz: number;
        if (e.shiftKey) horiz = e.deltaX || e.deltaY;
        else if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) horiz = e.deltaX;
        else return; // vertical-dominant → native panel scroll
        if (!horiz) return;
        e.preventDefault();
        clearTimeout(idleTimer);
        idleTimer = window.setTimeout(() => (locked = false), 140);
        if (locked || Math.abs(horiz) < 4) return;
        locked = true;
        step(horiz > 0 ? 1 : -1);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
});

// --- Chip row: horizontal scroll, edge fade, keep the current chip in view ---
// The fade itself is the shared `edgeFade` attachment (src/lib/edge-fade.ts).
let scroller = $state<HTMLDivElement>();

// Keep the current chip in view. Without this, deep-linking (the overview's
// phase card jumps straight to 記帳) can select a chip that is scrolled off
// screen. Scoped scrollTo, NOT scrollIntoView: the latter adjusts every
// scrollable ancestor, which WebKit lets cancel the pager's own gestures.
$effect(() => {
    if (!scroller) return;
    const behavior = prefersReducedMotion() ? "auto" : "smooth";
    const idx = scrollKeys.indexOf(current);
    if (idx < 0) {
        // A pinned chip is current: it never moves, so rewind the row instead so
        // the first scrollable chip sits right beside it.
        scroller.scrollTo({ left: 0, behavior });
        return;
    }
    const el = scroller.querySelectorAll<HTMLElement>("[data-pager-chip]")[idx];
    if (!el) return;
    const chipRect = el.getBoundingClientRect();
    const rowRect = scroller.getBoundingClientRect();
    const left = scroller.scrollLeft + (chipRect.left - rowRect.left) - (rowRect.width - chipRect.width) / 2;
    scroller.scrollTo({ left: Math.max(0, left), behavior });
});

// Notify whenever the panel (re)mounts for a new key. `{#key current}`
// recreates the section, so `panelEl` is reassigned each switch; rAF waits for
// the new content to lay out before the consumer measures it.
let panelEl = $state<HTMLElement>();
$effect(() => {
    const key = current;
    const el = panelEl;
    if (!el || !onPanelReady) return;
    requestAnimationFrame(() => onPanelReady(key, el));
});
</script>

<div class="flex flex-col h-full">
    <!-- Chip header: chips drive the same `current` as the pager below. It is a
         plain flex row above the pager, not `position: sticky` — the pager itself
         is the only thing that scrolls vertically.
         Pinned chips are a separate flex child rather than a sticky element
         inside the scroller — that keeps them out of the scroll content entirely,
         so nothing passes beneath them (no opaque backing needed) and the
         scroller's own leading edge is free to fade. -->
    <header class="shrink-0 z-[100] bg-bg-main/90 backdrop-blur-xl border-b border-line pt-[calc(6px+var(--safe-top))] px-5">
        <!-- pt 6 + pb 1.5 here plus py-1.5 on both children = the original 12px
             above and below the chips; see the scroller's comment for why the
             padding has to sit inside the scrollport. -->
        <div class="max-w-3xl mx-auto w-full flex pb-1.5">
            {#if pinnedKeys.length > 0}
                <div class="flex gap-2 shrink-0 pr-2 py-1.5">
                    {#each pinnedKeys as key (key)}
                        {@render chip(key, select, key === current)}
                    {/each}
                </div>
            {/if}
            <!-- min-w-0 is required, not cosmetic: a flex item defaults to
                 min-width:auto and would refuse to shrink below its content,
                 pushing the row wider than the screen instead of scrolling.
                 py-1.5 is not spacing either, it is room for the focus ring: a horizontal
                 scrollport clips vertically too (`overflow-x: auto` makes the
                 untouched `overflow-y: visible` compute to `auto`), and app.css
                 draws :focus-visible as a 2px outline at 2px offset, so a
                 scrollport exactly as tall as a chip cuts the ring's top and
                 bottom off. `overflow-clip-margin` cannot help — with the other
                 axis on `auto`, `overflow-y: clip` computes to `hidden`, which
                 ignores it. The header's pt / the row's pb give the same 6px back
                 so the chips do not move. -->
            <div
                bind:this={scroller}
                data-pager-scroller
                class="flex-1 min-w-0 py-1.5 overflow-x-auto no-scrollbar edge-fade"
                {@attach edgeFade}
            >
                <div class="flex gap-2">
                    {#each scrollKeys as key (key)}
                        <div data-pager-chip class="flex-none">
                            {@render chip(key, select, key === current)}
                        </div>
                    {/each}
                </div>
            </div>
        </div>
    </header>

    <!-- Pager viewport: one panel at a time, slid in/out on key change. -->
    <!-- svelte-ignore a11y_no_static_element_interactions (touch handlers only
         observe a horizontal flick to page; they never block scrolling) -->
    <div bind:this={pager} class="relative flex-1 min-h-0 overflow-hidden">
        {#key current}
            <section
                bind:this={panelEl}
                ontouchstart={onTouchStart}
                ontouchend={onTouchEnd}
                in:fly={{ x: dir * PAGE_SHIFT, duration: prefersReducedMotion() ? 0 : PAGE_MS }}
                class="absolute inset-0 overflow-y-auto overscroll-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            >
                <div class="max-w-3xl mx-auto w-full p-5">
                    {@render panel(current, select)}
                </div>
            </section>
        {/key}
    </div>
</div>
