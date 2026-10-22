import { eventStartMinutes } from "$lib/domain/timeline";
import {
    serializeToYaml,
    type TripData,
} from "$lib/domain/trip";
import {
    attachmentIds,
    eventIssue,
    hotelIssue,
    resizeDays,
    settleEvent,
    tidyDraft,
} from "$lib/domain/trip-edit";
import {
    daysBetweenIso,
    formatDayDate,
    isCalendarDate,
} from "$lib/domain/utils";
import { SvelteMap } from "svelte/reactivity";
import { gdriveSync } from "./gdrive.svelte";
import { showErrorToast } from "./toast.svelte";
import { tripStore } from "./trip.svelte";

/** Longer than any trip planned here: past it, a mistyped year would add a day for every date in between. */
const MAX_TRIP_DAYS = 90;

// The itinerary's edit mode: a copy of the whole trip, taken when it opens, that the cards
// change in place and ✓ saves in one go — one write, one undo, and an event whose time
// changed moves to its new place only then, never under the user's thumb. Kept outside the
// components because leaving the tab unmounts the itinerary, and the copy has to be there
// on the way back.

class TripEditStore {
    active = $state(false);
    /** What edit mode shows and changes in place of the trip; null outside it. */
    draft = $state<TripData | null>(null);
    /** Why an entry would not save, in zh-TW, keyed by the draft object itself: an event, a hotel, a day, or the trip. */
    errors = new SvelteMap<object, string>();
    /** The trip as it stood when edit mode opened, to tell an edit from a change made elsewhere meanwhile. */
    private base = "";
    /** Files uploaded to Drive during this edit: the ones the trip does not link to when it ends are trashed. */
    private uploads: string[] = [];

    /** Whether the draft says something the trip does not, which leaving without saving would lose. */
    get dirty(): boolean {
        if (!this.draft) return false;
        const tidied = JSON.parse(JSON.stringify(this.draft)) as TripData;
        tidyDraft(tidied);
        return serializeToYaml(tidied) !== this.base;
    }

    start(): void {
        const data = tripStore.data;
        if (!data) return;
        this.base = serializeToYaml(data);
        this.draft = JSON.parse(JSON.stringify(data)) as TripData;
        this.uploads = [];
        this.errors.clear();
        this.active = true;
    }

    /** Saves the draft and leaves edit mode. Stays, with `errors` set, while something would not save. */
    finish(): void {
        const draft = this.draft;
        const data = tripStore.data;
        if (!draft || !data) {
            this.close();
            return;
        }
        // A pull or another tab's save landed meanwhile; saving the copy would quietly undo it.
        if (serializeToYaml(data) !== this.base) {
            showErrorToast("行程在編輯期間有更新，請按 ✕ 取消後再改一次");
            return;
        }
        tidyDraft(draft);

        this.errors.clear();
        let firstError: string | null = null;
        const flag = (entry: object, issue: string | null, where: string) => {
            if (!issue) return;
            this.errors.set(entry, issue);
            // The card that says so may be on another day, so the toast names it.
            firstError ??= `${where}：${issue}`;
        };
        if (!draft.trip.name.trim()) flag(draft.trip, "行程名稱不能空白", "總覽");
        for (const hotel of draft.trip.hotels) flag(hotel, hotelIssue(hotel), `住宿「${hotel.title || "未命名"}」`);
        for (const day of draft.days) {
            if (!day.title.trim()) flag(day, "這天的標題不能空白", formatDayDate(day.date));
            for (const event of day.timeline) flag(event, eventIssue(event), `${formatDayDate(day.date)}「${event.title || "未命名事件"}」`);
        }
        if (firstError) {
            showErrorToast(firstError);
            return;
        }

        this.settleRetimed(draft, data);
        const error = tripStore.saveEditedTrip(draft);
        if (error) {
            showErrorToast(error);
            return;
        }
        const linked = attachmentIds(draft);
        this.close(this.uploads.filter(fileId => !linked.has(fileId)));
    }

    noteUpload(fileId: string): void {
        this.uploads.push(fileId);
    }

    /**
     * Resizes the trip to `start`–`end`: days outside it go, after asking when they hold
     * events, and dates it gains become free days. False, having said why, when refused.
     */
    setRange(start: string, end: string): boolean {
        const draft = this.draft;
        if (!draft || !isCalendarDate(start) || !isCalendarDate(end)) return false;
        if (end < start) {
            showErrorToast("結束日不能早於開始日");
            return false;
        }
        if (daysBetweenIso(start, end) + 1 > MAX_TRIP_DAYS) {
            showErrorToast(`行程最長 ${MAX_TRIP_DAYS} 天，請確認日期有沒有打錯`);
            return false;
        }
        const dropped = draft.days.filter(day => day.date < start || day.date > end);
        const events = dropped.reduce((count, day) => count + day.timeline.length, 0);
        if (events > 0 && !confirm(`會拿掉 ${dropped.map(day => formatDayDate(day.date)).join("、")} 這 ${dropped.length} 天，連同上面的 ${events} 個事件。確定嗎？`)) return false;
        draft.days = resizeDays(draft.days, start, end);
        return true;
    }

    /** Leaves edit mode without saving, after asking when that would lose an edit. */
    discard(): void {
        const question = this.uploads.length > 0 ? "要放棄這次的修改嗎？這次上傳的附件也會從 Drive 刪掉。" : "要放棄這次的修改嗎？";
        if (this.dirty && !confirm(question)) return;
        this.close(this.uploads);
    }

    /** Events added, or whose start changed, go where their time says; the rest keep the order they were given. */
    private settleRetimed(draft: TripData, data: TripData): void {
        const before = new Map(data.days.flatMap(day => day.timeline.map(event => [event._id, eventStartMinutes(event, day.date)])));
        for (const day of draft.days) {
            const retimed = day.timeline.filter(event => !before.has(event._id) || before.get(event._id) !== eventStartMinutes(event, day.date));
            for (const event of retimed) settleEvent(day.timeline, day.timeline.indexOf(event), day.date);
        }
    }

    /** Leaves edit mode, trashing `unused` — this edit's uploads the trip ended up not linking to. */
    private close(unused: readonly string[] = []): void {
        if (unused.length > 0) void gdriveSync.trashAttachments(unused);
        this.uploads = [];
        this.active = false;
        this.draft = null;
        this.errors.clear();
    }
}

export const tripEdit = new TripEditStore();
