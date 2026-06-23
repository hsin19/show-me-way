// Line-level text diff for showing AI-proposed itinerary edits as a unified
// (git-style) inline diff. Both sides come from the same `serializeToYaml`, so
// a plain line diff highlights real content changes without formatting noise.

export type DiffLineType = "equal" | "added" | "removed";

export interface DiffLine {
    type: DiffLineType;
    text: string;
}

// Split into lines for diffing, dropping a single trailing newline so the
// serializer's final "\n" doesn't surface as a spurious empty line.
function splitLines(text: string): string[] {
    return text.replace(/\n$/, "").split("\n");
}

/**
 * Compute a line-level unified diff between two texts via the classic LCS
 * dynamic-programming table. Returns the lines in order, each tagged `equal`,
 * `removed` (only in `oldText`), or `added` (only in `newText`). Removals are
 * emitted before additions within a change, matching `diff -u` / git output.
 *
 * O(m·n) time and memory — fine for itinerary YAML (a few hundred lines).
 */
export function diffLines(oldText: string, newText: string): DiffLine[] {
    const a = splitLines(oldText);
    const b = splitLines(newText);
    const m = a.length;
    const n = b.length;

    // dp[i][j] = length of the LCS of a[i..] and b[j..].
    const dp: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
    for (let i = m - 1; i >= 0; i--) {
        for (let j = n - 1; j >= 0; j--) {
            dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
        }
    }

    const out: DiffLine[] = [];
    let i = 0;
    let j = 0;
    while (i < m && j < n) {
        if (a[i] === b[j]) {
            out.push({ type: "equal", text: a[i] });
            i++;
            j++;
        } else if (dp[i + 1][j] >= dp[i][j + 1]) {
            out.push({ type: "removed", text: a[i] });
            i++;
        } else {
            out.push({ type: "added", text: b[j] });
            j++;
        }
    }
    while (i < m) out.push({ type: "removed", text: a[i++] });
    while (j < n) out.push({ type: "added", text: b[j++] });
    return out;
}

/** Count added / removed lines in a diff, for a "+a -b" summary label. */
export function diffStats(lines: DiffLine[]): { added: number; removed: number; } {
    let added = 0;
    let removed = 0;
    for (const line of lines) {
        if (line.type === "added") added++;
        else if (line.type === "removed") removed++;
    }
    return { added, removed };
}
