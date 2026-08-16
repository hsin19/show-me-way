// A line diff is enough for AI-proposed edits because both sides come out of the
// same `serializeToYaml` — there is no formatting noise for a word diff to see
// through, and this needs no dependency.

export type DiffLineType = "equal" | "added" | "removed";

export interface DiffLine {
    type: DiffLineType;
    text: string;
}

// The trailing newline goes, or the serializer's final "\n" shows up as an empty
// diff line on both sides.
function splitLines(text: string): string[] {
    return text.replace(/\n$/, "").split("\n");
}

/**
 * A unified (git-style) diff: every line in order, removals before additions
 * within a change. O(m·n) in time and memory, which is fine for an itinerary and
 * would not be for a large file.
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

export function diffStats(lines: DiffLine[]): { added: number; removed: number; } {
    let added = 0;
    let removed = 0;
    for (const line of lines) {
        if (line.type === "added") added++;
        else if (line.type === "removed") removed++;
    }
    return { added, removed };
}
