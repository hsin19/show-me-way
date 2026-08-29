import {
    describe,
    expect,
    it,
} from "vitest";
import {
    diffLines,
    diffStats,
} from "./diff";

describe("diffLines", () => {
    it("marks every line equal for identical text", () => {
        const lines = diffLines("a\nb\nc", "a\nb\nc");
        expect(lines).toEqual([
            { type: "equal", text: "a" },
            { type: "equal", text: "b" },
            { type: "equal", text: "c" },
        ]);
    });

    it("detects a pure addition", () => {
        const lines = diffLines("a\nc", "a\nb\nc");
        expect(lines).toEqual([
            { type: "equal", text: "a" },
            { type: "added", text: "b" },
            { type: "equal", text: "c" },
        ]);
    });

    it("detects a pure removal", () => {
        const lines = diffLines("a\nb\nc", "a\nc");
        expect(lines).toEqual([
            { type: "equal", text: "a" },
            { type: "removed", text: "b" },
            { type: "equal", text: "c" },
        ]);
    });

    it("emits removal before addition for a changed line", () => {
        const lines = diffLines("a\nold\nc", "a\nnew\nc");
        expect(lines).toEqual([
            { type: "equal", text: "a" },
            { type: "removed", text: "old" },
            { type: "added", text: "new" },
            { type: "equal", text: "c" },
        ]);
    });

    it("ignores a single trailing newline so it is not a spurious empty line", () => {
        const lines = diffLines("a\nb\n", "a\nb\n");
        expect(lines).toEqual([
            { type: "equal", text: "a" },
            { type: "equal", text: "b" },
        ]);
    });
});

describe("diffStats", () => {
    it("counts added and removed lines", () => {
        const lines = diffLines("a\nold\nc", "a\nnew\nc\nd");
        expect(diffStats(lines)).toEqual({ added: 2, removed: 1 });
    });
});
