import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from "vitest";
import {
    dismissToast,
    runToastAction,
    shareOrCopyToClipboard,
    showToast,
    toast,
} from "./toast.svelte";

describe("toast stack", () => {
    beforeEach(() => {
        vi.useFakeTimers();
        // showToast schedules via window.setTimeout; node has no window, so
        // delegate to the (fake-timer-patched) global setTimeout at call time.
        vi.stubGlobal("window", {
            setTimeout: (handler: () => void, timeout?: number) => setTimeout(handler, timeout),
        });
    });

    afterEach(() => {
        // Drain pending timers first: the store is module state shared across this
        // file, so a leftover toast would leak into the next test. Persistent
        // toasts have no timer to drain, so dismiss them by hand.
        vi.advanceTimersByTime(10_000);
        for (const item of [...toast.items]) dismissToast(item.id);
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });

    const messages = () => toast.items.map(item => item.message);

    it("shows a plain message and auto-dismisses after 2500ms", () => {
        showToast("已複製");
        expect(messages()).toEqual(["已複製"]);
        expect(toast.items[0]?.action).toBeNull();

        vi.advanceTimersByTime(2499);
        expect(messages()).toEqual(["已複製"]);
        vi.advanceTimersByTime(1);
        expect(messages()).toEqual([]);
    });

    it("keeps an undo toast up for the longer 4500ms window", () => {
        showToast({ message: "已刪除", actionLabel: "復原", onAction: () => {} });
        expect(toast.items[0]?.action?.label).toBe("復原");

        vi.advanceTimersByTime(4499);
        expect(messages()).toEqual(["已刪除"]);
        vi.advanceTimersByTime(1);
        expect(messages()).toEqual([]);
    });

    it("ignores an actionLabel without an onAction and uses the plain window", () => {
        showToast({ message: "已複製", actionLabel: "復原" });
        expect(toast.items[0]?.action).toBeNull();

        vi.advanceTimersByTime(2500);
        expect(messages()).toEqual([]);
    });

    // Replaces the old "restarts the clock on back-to-back toasts" test: toasts
    // now coexist instead of overwriting, so each keeps its own deadline.
    it("stacks concurrent toasts, each expiring on its own clock", () => {
        showToast("第一則");
        vi.advanceTimersByTime(1000);
        showToast("第二則");

        // Oldest first — the renderer stacks bottom-anchored, so newest sits lowest.
        expect(messages()).toEqual(["第一則", "第二則"]);

        vi.advanceTimersByTime(1500); // 2500ms since the first
        expect(messages()).toEqual(["第二則"]);
        vi.advanceTimersByTime(1000); // 2500ms since the second
        expect(messages()).toEqual([]);
    });

    it("a later notice cannot cut an undo window short", () => {
        showToast({ message: "已刪除", actionLabel: "復原", onAction: () => {} });
        showToast("已複製");

        vi.advanceTimersByTime(2500); // the plain notice expires
        expect(messages()).toEqual(["已刪除"]);
        vi.advanceTimersByTime(1999);
        expect(messages()).toEqual(["已刪除"]); // still reachable at 4499ms
    });

    it("caps the stack at 3, dropping the oldest", () => {
        for (const message of ["一", "二", "三", "四"]) showToast(message);
        expect(messages()).toEqual(["二", "三", "四"]);
    });

    it("runToastAction fires only that toast's callback and leaves the rest", () => {
        const undoA = vi.fn();
        const undoB = vi.fn();
        showToast({ message: "A", actionLabel: "復原", onAction: undoA });
        showToast({ message: "B", actionLabel: "復原", onAction: undoB });

        runToastAction(toast.items[1]!.id);
        expect(undoB).toHaveBeenCalledOnce();
        expect(undoA).not.toHaveBeenCalled();
        expect(messages()).toEqual(["A"]);
    });

    it("clears the dismissed toast's timer so it cannot fire later", () => {
        const onAction = vi.fn();
        showToast({ message: "已刪除", actionLabel: "復原", onAction });

        runToastAction(toast.items[0]!.id);
        expect(onAction).toHaveBeenCalledOnce();
        expect(messages()).toEqual([]);

        vi.advanceTimersByTime(5000);
        expect(messages()).toEqual([]);
        expect(onAction).toHaveBeenCalledOnce();
    });

    // The PWA update notice: the one message that must not vanish unseen. Mirrors
    // App.svelte's onNeedRefresh call exactly, dedupeKey included.
    describe("persistent toast", () => {
        const update = () =>
            showToast({
                message: "已有新版本",
                actionLabel: "立即更新",
                onAction: () => {},
                kind: "update",
                persist: true,
                dedupeKey: "sw-update",
            });

        it("never expires", () => {
            update();
            vi.advanceTimersByTime(60_000);
            expect(messages()).toEqual(["已有新版本"]);
        });

        it("is not evicted by a burst of expiring toasts", () => {
            update();
            for (const message of ["一", "二", "三", "四", "五"]) showToast(message);
            // Cap applies to the expiring ones only; the notice survives.
            expect(messages()).toEqual(["已有新版本", "三", "四", "五"]);
        });

        it("stays at the top as newer toasts arrive", () => {
            update();
            showToast("後來的");
            // Oldest first, and the renderer stacks bottom-anchored → notice on top.
            expect(messages()[0]).toBe("已有新版本");
        });

        it("can be dismissed explicitly", () => {
            update();
            dismissToast(toast.items[0]!.id);
            expect(messages()).toEqual([]);
        });

        it("carries its kind through for the icon", () => {
            update();
            expect(toast.items[0]?.kind).toBe("update");
            expect(toast.items[0]?.persist).toBe(true);
        });

        // Two deploys in one long session fire onNeedRefresh twice. Without the
        // dedupeKey both notices would sit there for good: persistent toasts have
        // no timer and the cap skips them.
        it("replaces itself instead of stacking when the notice fires again", () => {
            update();
            const first = toast.items[0]!.id;
            update();
            expect(messages()).toEqual(["已有新版本"]);
            expect(toast.items[0]?.id).not.toBe(first);
        });

        it("does not displace unrelated toasts", () => {
            showToast("已複製");
            update();
            expect(messages()).toEqual(["已複製", "已有新版本"]);
        });
    });

    it("defaults to the success kind and no persistence", () => {
        showToast("已複製");
        expect(toast.items[0]?.kind).toBe("success");
        expect(toast.items[0]?.persist).toBe(false);
    });

    it("supports custom durationMs, showDismiss, and onDismiss callback", () => {
        const onDismiss = vi.fn();
        showToast({
            kind: "download",
            message: "下載專用",
            durationMs: 10000,
            showDismiss: true,
            onDismiss,
        });

        expect(toast.items[0]?.kind).toBe("download");
        expect(toast.items[0]?.showDismiss).toBe(true);

        vi.advanceTimersByTime(9999);
        expect(messages()).toEqual(["下載專用"]);
        expect(onDismiss).not.toHaveBeenCalled();

        vi.advanceTimersByTime(1);
        expect(messages()).toEqual([]);
        expect(onDismiss).toHaveBeenCalledTimes(1);
    });

    // `onDismiss` means "the user let this one go", so the three paths below have
    // to stay apart. The install prompt reads it as a 7-day cool-off: firing it on
    // a replacement once started that cool-off 3.5s into a toast nobody had
    // touched, and firing it on the action would start one on an accepted offer.
    it("fires onDismiss when the user closes the toast with ✕", () => {
        const onDismiss = vi.fn();
        showToast({ message: "關掉我", showDismiss: true, onDismiss });

        dismissToast(toast.items[0]!.id);
        expect(onDismiss).toHaveBeenCalledTimes(1);
    });

    it("does not fire onDismiss when the action runs", () => {
        const onDismiss = vi.fn();
        const onAction = vi.fn();
        showToast({ message: "接受我", actionLabel: "好", onAction, onDismiss });

        runToastAction(toast.items[0]!.id);
        expect(onAction).toHaveBeenCalledTimes(1);
        expect(onDismiss).not.toHaveBeenCalled();
    });

    it("does not fire onDismiss when a same-dedupeKey toast replaces it", () => {
        const onDismiss = vi.fn();
        showToast({ message: "第一版", dedupeKey: "same", durationMs: 10_000, onDismiss });
        showToast({ message: "第二版", dedupeKey: "same", durationMs: 10_000 });

        expect(messages()).toEqual(["第二版"]);
        expect(onDismiss).not.toHaveBeenCalled();
    });

    it("fires onDismiss when the cap evicts the toast", () => {
        const onDismiss = vi.fn();
        showToast({ message: "最舊", onDismiss });
        showToast("二");
        showToast("三");
        expect(onDismiss).not.toHaveBeenCalled();

        showToast("四");
        expect(messages()).toEqual(["二", "三", "四"]);
        expect(onDismiss).toHaveBeenCalledTimes(1);
    });

    it("runToastAction on an unknown id is a no-op", () => {
        showToast("還在畫面上");
        expect(() => runToastAction(9999)).not.toThrow();
        expect(messages()).toEqual(["還在畫面上"]);
    });
});

describe("shareOrCopyToClipboard", () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.stubGlobal("window", {
            setTimeout: (handler: () => void, timeout?: number) => setTimeout(handler, timeout),
        });
    });

    afterEach(() => {
        vi.advanceTimersByTime(10_000);
        for (const item of [...toast.items]) dismissToast(item.id);
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });

    it("uses the native share sheet when available, without falling back to copy", async () => {
        const share = vi.fn(() => Promise.resolve());
        vi.stubGlobal("navigator", { share });

        await shareOrCopyToClipboard({ url: "https://example.com" }, "https://example.com", "copy msg");

        expect(share).toHaveBeenCalledWith({ url: "https://example.com" });
        expect(toast.items).toHaveLength(0);
    });

    it("stays silent (no toast, no copy) when the user declines the share sheet", async () => {
        const share = vi.fn(() => Promise.reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
        vi.stubGlobal("navigator", { share });

        await shareOrCopyToClipboard({ url: "https://example.com" }, "https://example.com", "copy msg");

        expect(toast.items).toHaveLength(0);
    });

    it("falls back to copying when the share sheet fails for a real reason", async () => {
        const share = vi.fn(() => Promise.reject(new Error("share sheet busy")));
        const writeText = vi.fn(() => Promise.resolve());
        vi.stubGlobal("navigator", { share, clipboard: { writeText } });

        await shareOrCopyToClipboard({ url: "https://example.com" }, "https://example.com", "已複製連結");
        // `copyToClipboard` reports success via a `.then()` on this same promise,
        // registered before this await — awaiting it lets that microtask run first.
        await writeText.mock.results[0]?.value;

        expect(writeText).toHaveBeenCalledWith("https://example.com");
        expect(toast.items.map(item => item.message)).toEqual(["已複製連結"]);
    });

    it("copies directly when the browser has no share API at all", async () => {
        const writeText = vi.fn(() => Promise.resolve());
        vi.stubGlobal("navigator", { clipboard: { writeText } });

        await shareOrCopyToClipboard({ text: "今日行程" }, "今日行程", "已複製今日行程");
        await writeText.mock.results[0]?.value;

        expect(writeText).toHaveBeenCalledWith("今日行程");
        expect(toast.items.map(item => item.message)).toEqual(["已複製今日行程"]);
    });
});
