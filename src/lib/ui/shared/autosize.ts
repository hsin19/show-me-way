import type { Attachment } from "svelte/attachments";

/**
 * Attach to a textarea to grow it with what it holds, so a long text is edited in the page's
 * own scroll rather than in a box that scrolls inside it — on a phone, the inner one swallows
 * the swipe that was meant for the page.
 */
export const autosize: Attachment<HTMLTextAreaElement> = textarea => {
    const fit = () => {
        textarea.style.height = "auto";
        textarea.style.height = `${textarea.scrollHeight}px`;
    };
    fit();
    textarea.addEventListener("input", fit);
    return () => textarea.removeEventListener("input", fit);
};
