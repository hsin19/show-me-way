/** A click the page should handle itself; a modified one keeps the link's own job (new tab, copy address). */
export function isPlainClick(e: MouseEvent): boolean {
    return e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey;
}
