import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from "vitest";
import {
    runToastAction,
    showToast,
    toast,
} from "./toast.svelte";

describe("toast store", () => {
    beforeEach(() => {
        vi.useFakeTimers();
        // showToast schedules via window.setTimeout; node has no window, so
        // delegate to the (fake-timer-patched) global setTimeout at call time.
        vi.stubGlobal("window", {
            setTimeout: (handler: () => void, timeout?: number) => setTimeout(handler, timeout),
        });
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.useRealTimers();
    });

    it("shows a plain message and auto-hides after 2500ms", () => {
        showToast("已複製");
        expect(toast.visible).toBe(true);
        expect(toast.message).toBe("已複製");
        expect(toast.actionLabel).toBeNull();

        vi.advanceTimersByTime(2499);
        expect(toast.visible).toBe(true);
        vi.advanceTimersByTime(1);
        expect(toast.visible).toBe(false);
    });

    it("keeps an undo toast up for the longer 4500ms window", () => {
        showToast({ message: "已刪除", actionLabel: "復原", onAction: () => {} });
        expect(toast.visible).toBe(true);
        expect(toast.actionLabel).toBe("復原");

        vi.advanceTimersByTime(4499);
        expect(toast.visible).toBe(true);
        vi.advanceTimersByTime(1);
        expect(toast.visible).toBe(false);
    });

    it("ignores an actionLabel without an onAction and uses the plain window", () => {
        showToast({ message: "已複製", actionLabel: "復原" });
        expect(toast.actionLabel).toBeNull();

        vi.advanceTimersByTime(2500);
        expect(toast.visible).toBe(false);
    });

    it("restarts the clock on back-to-back toasts so the first timer cannot hide the second", () => {
        showToast("第一則");
        vi.advanceTimersByTime(2000);
        showToast({ message: "已刪除", actionLabel: "復原", onAction: () => {} });

        // Cross the first toast's original 2500ms deadline; the second must survive it.
        vi.advanceTimersByTime(1000);
        expect(toast.visible).toBe(true);
        expect(toast.message).toBe("已刪除");
        expect(toast.actionLabel).toBe("復原");

        // The second toast's own 4500ms window still ends on schedule.
        vi.advanceTimersByTime(3499);
        expect(toast.visible).toBe(true);
        vi.advanceTimersByTime(1);
        expect(toast.visible).toBe(false);
    });

    it("runToastAction fires the callback and dismisses immediately", () => {
        const onAction = vi.fn();
        showToast({ message: "已刪除", actionLabel: "復原", onAction });

        runToastAction();
        expect(onAction).toHaveBeenCalledTimes(1);
        expect(toast.visible).toBe(false);

        // The pending hide timer was cleared; nothing re-fires later.
        vi.advanceTimersByTime(5000);
        expect(toast.visible).toBe(false);
    });
});
