<script lang="ts" generics="T extends string | number">
import type { Snippet } from "svelte";
import { fly } from "svelte/transition";
import { edgeFade } from "../domain/edge-fade";
import { prefersReducedMotion } from "../domain/utils";

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
     * One chip's content — the caller renders its own `<button>`, since the two
     * chip rows in the app differ too much to share styling. `active` comes last
     * so a caller that derives its own highlight can take just (key, select).
     */
    chip: Snippet<[T, (key: T) => void, boolean]>;
    /** The one visible panel; `select` is there for in-panel navigation. */
    panel: Snippet<[T, (key: T) => void]>;
    /** After a fresh panel has mounted AND laid out, so the consumer can measure it. */
    onPanelReady?: (key: T, panel: HTMLElement) => void;
}

let { keys, current = $bindable(), pinnedCount = 0, chip, panel, onPanelReady }: Props = $props();

let pinnedKeys = $derived(keys.slice(0, pinnedCount));
let scrollKeys = $derived(keys.slice(pinnedCount));

// Only the current panel exists, so the view is a pure function of `current` and
// there is no horizontal scroll machinery to keep in sync. Paging is a gesture or
// a chip tap that steps the key; vertical scrolling stays native, inside a panel.
const PAGE_MS = 280;
const PAGE_SHIFT = 80;

// +1 = the incoming panel enters from the right.
let dir = $state(1);

// An external write to `current` (the binding, e.g. today-sync) bypasses this and
// reuses whatever direction was last set.
function select(key: T) {
    if (key === current) return;
    dir = keys.indexOf(key) >= keys.indexOf(current) ? 1 : -1;
    current = key;
}

function step(delta: number) {
    const i = keys.indexOf(current);
    const next = Math.max(0, Math.min(keys.length - 1, i + delta));
    if (next === i) return;
    dir = delta > 0 ? 1 : -1;
    current = keys[next];
}

// Measured on touchend, not during the move, so vertical scrolling is never
// intercepted — only a clearly horizontal flick pages. A gesture that starts on a
// form field or a `[data-swipe-ignore]` row belongs to that element.
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

// Desktop trackpad. One step per gesture — the lock releases once the wheel goes
// idle — so a single flick's burst of events cannot skip several panels.
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

let scroller = $state<HTMLDivElement>();

// Deep-linking (the overview's phase card jumps straight to 記帳) can select a
// chip that is scrolled off screen. A scoped scrollTo, NOT scrollIntoView: that
// adjusts every scrollable ancestor, which on WebKit cancels the pager's gestures.
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

// `{#key current}` recreates the section on every switch, so this fires per
// panel; the rAF is what lets the consumer measure laid-out content.
let panelEl = $state<HTMLElement>();
$effect(() => {
    const key = current;
    const el = panelEl;
    if (!el || !onPanelReady) return;
    requestAnimationFrame(() => onPanelReady(key, el));
});
</script>

<div class="flex flex-col h-full">
    <!-- A plain flex row, not `position: sticky`: the pager below is the only
         thing that scrolls vertically. The pinned chips are a separate flex child
         rather than a sticky element inside the scroller, which keeps them out of
         the scroll content entirely — nothing passes beneath them, so they need
         no opaque backing, and the scroller's leading edge is free to fade. -->
    <header class="shrink-0 z-[100] bg-bg-main/90 backdrop-blur-xl border-b border-line pt-[calc(6px+var(--safe-top))] px-5">
        <!-- This pt/pb plus py-1.5 on both children add back up to the 12px the
             chips need; the split exists because the padding has to sit inside the
             scrollport — see the scroller below. -->
        <div class="max-w-3xl mx-auto w-full flex pb-1.5">
            {#if pinnedKeys.length > 0}
                <div class="flex gap-2 shrink-0 pr-2 py-1.5">
                    {#each pinnedKeys as key (key)}
                        {@render chip(key, select, key === current)}
                    {/each}
                </div>
            {/if}
            <!-- Neither utility here is cosmetic. Without min-w-0 the flex item
                 keeps its default min-width:auto, refuses to shrink below its
                 content, and pushes the row wider than the screen instead of
                 scrolling. py-1.5 is room for the focus ring: a horizontal
                 scrollport clips vertically too (`overflow-x: auto` makes the
                 untouched `overflow-y: visible` compute to `auto`), and app.css
                 draws :focus-visible at a 2px offset, so a scrollport exactly as
                 tall as a chip cuts the ring off. `overflow-clip-margin` cannot
                 help — with the other axis on `auto`, `overflow-y: clip` computes
                 to `hidden`, which ignores it. -->
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
