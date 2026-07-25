import type { Attachment } from "svelte/attachments";

/**
 * Width of the mask ramp at each end. Wide enough that a half-scrolled chip is
 * visibly fading rather than merely dim — see the ramp shape in `.edge-fade`.
 */
const FADE_PX = 40;

/**
 * Drive `.edge-fade`'s mask on a horizontally scrolling row: fade whichever end
 * still has content past it, and collapse that end's ramp once it is reached —
 * a permanently dimmed end chip reads as broken rather than as scrollable.
 *
 * An attachment rather than an `$effect` per caller: this is pure DOM
 * bookkeeping with no reactive inputs, and every row that scrolls horizontally
 * (TabPager's chip header, PhraseDeck's category filter) should behave
 * identically. The ResizeObserver watches the content as well as the scrollport,
 * so a changing chip set AND a rotation/resize both re-check — a hand-listed
 * reactive dependency covered only the first.
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
    // The row inside the scrollport: chips can be added or removed (工具 drops
    // pages without a trip) without the scrollport itself changing size.
    if (node.firstElementChild) observer.observe(node.firstElementChild);
    return () => {
        node.removeEventListener("scroll", update);
        observer.disconnect();
    };
};
