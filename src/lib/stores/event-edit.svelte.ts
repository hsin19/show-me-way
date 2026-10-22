import {
    applyEventForm,
    type EventForm,
    eventFormOf,
    isFormDirty,
} from "$lib/domain/event-form";
import type { TimelineEvent } from "$lib/domain/trip";
import { formatDayDate } from "$lib/domain/utils";
import { showToast } from "./toast.svelte";
import { tripStore } from "./trip.svelte";

// The itinerary's edit mode: a draft of every authored event, taken when it opens, that the
// cards edit in place and 完成 saves in one go — one write, one undo, and an event whose
// time changed moves to its new place only then, never under the user's thumb. Kept outside
// the components because leaving the tab unmounts the itinerary, and the drafts have to be
// there on the way back.

class EventEditStore {
    active = $state(false);
    /** By `_id`. An event the trip gained since edit mode opened has none, and shows as it is. */
    forms = $state<Record<string, EventForm>>({});
    /** Why an event's draft would not save, by `_id`, in zh-TW. */
    errors = $state<Record<string, string>>({});

    /** Whether any draft says something its event does not, which leaving without saving would lose. */
    get dirty(): boolean {
        return this.authored().some(({ event }) => {
            const form = this.forms[event._id!];
            return !!form && isFormDirty(event, form);
        });
    }

    start(): void {
        this.forms = Object.fromEntries(this.authored().map(({ event }) => [event._id!, eventFormOf(event)]));
        this.errors = {};
        this.active = true;
    }

    /** Saves every changed draft and leaves edit mode. Stays, with `errors` set, while one would not save. */
    finish(): void {
        const changes: [string, TimelineEvent][] = [];
        const errors: Record<string, string> = {};
        let firstError: string | null = null;
        for (const { event, date } of this.authored()) {
            const form = this.forms[event._id!];
            if (!form || !isFormDirty(event, form)) continue;
            try {
                changes.push([event._id!, applyEventForm(event, form, date)]);
            } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                errors[event._id!] = message;
                // The card that says so may be on another day, so the toast names it.
                firstError ??= `${formatDayDate(date)}「${event.title}」：${message}`;
            }
        }
        this.errors = errors;
        if (firstError) {
            showToast(firstError);
            return;
        }
        const error = changes.length > 0 ? tripStore.editEvents(changes) : null;
        if (error) {
            showToast(error);
            return;
        }
        this.close();
    }

    /** Leaves edit mode without saving, after asking when that would lose an edit. */
    discard(): void {
        if (this.dirty && !confirm("要放棄這次的修改嗎？")) return;
        this.close();
    }

    private close(): void {
        this.active = false;
        this.forms = {};
        this.errors = {};
    }

    private authored(): { event: TimelineEvent; date: string; }[] {
        return (tripStore.data?.days ?? []).flatMap(day => day.timeline.map(event => ({ event, date: day.date })));
    }
}

export const eventEdit = new EventEditStore();
