import type { Attachment } from "svelte/attachments";

/** Wide enough that a half-scrolled chip reads as fading rather than merely dim. */
const FADE_PX = 40;

/**
 * Attach to any horizontally scrolling `.edge-fade` row: the end with content
 * past it fades, the end that has been reached does not — a permanently dimmed
 * last chip reads as broken rather than as scrollable.
 *
 * An attachment rather than an `$effect` per caller, since this is pure DOM
 * bookkeeping with no reactive inputs and every scrolling row should behave
 * identically.
 */
export const edgeFade: Attachment<HTMLElement> = node => {
    const update = () => {
        // 1px slack: fractional scroll offsets never land exactly on the bounds.
        const max = node.scrollWidth - node.clientWidth;
        node.style.setProperty("--fade-start", node.scrollLeft <= 1 ? "0px" : `${FADE_PX}px`);
        node.style.setProperty("--fade-end", node.scrollLeft >= max - 1 ? "0px" : `${FADE_PX}px`);
    };
    update();
    node.addEventListener("scroll", update, { passive: true });
    const observer = new ResizeObserver(update);
    observer.observe(node);
    // The content too, not just the scrollport: chips come and go (工具 drops
    // pages without a trip) while the scrollport keeps its size.
    if (node.firstElementChild) observer.observe(node.firstElementChild);
    return () => {
        node.removeEventListener("scroll", update);
        observer.disconnect();
    };
};
