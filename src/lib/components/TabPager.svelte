<script lang="ts" generics="T extends string | number">
import type { Snippet } from "svelte";
import { fly } from "svelte/transition";

interface Props {
    /** Ordered panel keys; swipe / wheel / select() step through this order. */
    keys: T[];
    /** Visible panel's key. Bindable — external writes (e.g. today-sync) also swap the panel. */
    current: T;
    /** Sticky chip row; receives select() so taps slide with the right direction. */
    header: Snippet<[(key: T) => void]>;
    /** The one visible panel; receives the current key and select() (for in-panel navigation). */
    panel: Snippet<[T, (key: T) => void]>;
    /** Called via rAF after a fresh panel mounts and lays out (e.g. scroll to the current event). */
    onPanelReady?: (key: T, panel: HTMLElement) => void;
}

let { keys, current = $bindable(), header, panel, onPanelReady }: Props = $props();

// --- One panel on screen at a time, swapped with a slide transition ---
// Only the current panel is rendered; the view is a pure function of `current`,
// so there is no horizontal scroll machinery to keep in sync. Native vertical
// scroll happens inside the panel; left/right paging is a swipe/wheel gesture
// (or a chip tap) that simply steps `current`. Shared by the itinerary strip
// (overview + days) and the 工具 tab (sub-pages).
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
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
    <!-- Sticky chip header: chips drive the same `current` as the pager below. -->
    <header class="shrink-0 z-[100] bg-bg-main/90 backdrop-blur-xl border-b border-white/5 pt-[calc(12px+var(--safe-top))] px-5">
        <div class="max-w-3xl mx-auto w-full">
            {@render header(select)}
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
                in:fly={{ x: dir * PAGE_SHIFT, duration: reduceMotion ? 0 : PAGE_MS }}
                class="absolute inset-0 overflow-y-auto overscroll-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            >
                <div class="max-w-3xl mx-auto w-full p-5">
                    {@render panel(current, select)}
                </div>
            </section>
        {/key}
    </div>
</div>
