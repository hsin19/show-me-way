import {
    applyItineraryEdits,
    describeEdits,
    type ItineraryEdit,
} from "$lib/domain/itinerary-edits";
import {
    type ChatMessage,
    sendChatMessage,
} from "$lib/infra/http/gemini";

// The AI tab's conversation. A module singleton rather than the panel's own state, so
// leaving the tab and coming back finds the thread as it was — a reply that landed in
// between included — and in memory only, so a reload starts afresh. One trip per
// conversation: its edit cards name that trip's days and titles, so another trip
// starts a new one.

/**
 * Replayed to Gemini as history through `replayed`: the prose, never YAML, since the current
 * itinerary is re-sent in the system prompt. The rest is UI state for the suggestion card.
 */
export interface UiMessage extends ChatMessage {
    /** Set only once they have applied cleanly to `baseYaml`. */
    edits?: ItineraryEdit[];
    /** The itinerary as it was when the edits were proposed, so the card's diff stays stable once another lands. */
    baseYaml?: string;
    /** `baseYaml` with the edits applied: what the diff shows. */
    editYaml?: string;
    editApplied?: boolean;
    editError?: string;
    /** Why the edits no longer apply to the trip as it now stands. */
    applyError?: string;
}

/**
 * A turn as the model is shown it again. The trip it is sent shows only how things turned
 * out, so a model turn that proposed edits carries a note of what they were and what became
 * of them — not yet applied, applied, or refused and why, which is what lets the model
 * correct an edit that did not land. Plain text rather than a replayed function call and
 * result: the outcome is the user's to decide after the turn, and replaying a call would
 * have to carry the provider's own opaque signatures along.
 */
function replayed(message: UiMessage): ChatMessage {
    let note: string | null = null;
    if (message.editError) {
        note = `這次的修改沒辦法套用：${message.editError}`;
    } else if (message.edits) {
        const proposed = `修改提案為 ${describeEdits(message.edits)}。`;
        note = message.editApplied
            ? `${proposed}使用者已套用，目前的行程資料已包含這些變更。`
            : message.applyError
            ? `${proposed}使用者要套用時失敗：${message.applyError}`
            : `${proposed}使用者還沒有套用，目前的行程資料沒有這些變更。`;
    }
    return { role: message.role, content: note ? `${message.content}\n\n（App 紀錄：${note}）` : message.content };
}

class AiChat {
    messages = $state<UiMessage[]>([]);
    /** The composer's draft, kept with the thread it was being written for. */
    input = $state("");
    isSending = $state(false);
    /** When the turn in flight was sent, for the waiting bubble's count of seconds. */
    sentAt = $state<number | null>(null);
    /** What the turn in flight is doing besides waiting, when that is worth saying. */
    status = $state<string | null>(null);
    errorText = $state<string | null>(null);
    private tripId: string | null = null;
    private inFlight: AbortController | null = null;
    /** Bumped by every new conversation, so a reply still in flight for the last one is dropped. */
    private generation = 0;

    /** Starts a new conversation unless this one is about `tripId` already. */
    bindTrip(tripId: string): void {
        if (this.tripId === tripId) return;
        this.reset();
        this.tripId = tripId;
    }

    /** Gives up on the turn in flight, handing its question back to the composer as a failure would. */
    abort(): void {
        this.inFlight?.abort();
    }

    reset(): void {
        // Nothing will show the reply, so do not let it spend the user's quota either.
        this.inFlight?.abort();
        this.generation++;
        this.messages = [];
        this.input = "";
        this.errorText = null;
        this.isSending = false;
        this.sentAt = null;
        this.status = null;
    }

    /**
     * One turn against `baseYaml`, the trip as it stands now: what the model edits, and
     * what the card's diff keeps being drawn from once another edit has landed.
     */
    async send(text: string, apiKey: string, model: string, baseYaml: string): Promise<void> {
        const prompt = text.trim();
        if (!prompt || this.isSending) return;
        const generation = this.generation;
        const history = this.messages;
        this.messages = [...history, { role: "user", content: prompt }];
        this.input = "";
        this.errorText = null;
        this.isSending = true;
        this.sentAt = Date.now();
        const controller = new AbortController();
        this.inFlight = controller;

        try {
            const turn = await sendChatMessage(apiKey, model, history.map(replayed), prompt, baseYaml, {
                signal: controller.signal,
                onBusyRetry: (attempt, of) => {
                    if (generation === this.generation) this.status = `模型忙碌中，正在重試（${attempt}/${of}）`;
                },
            });
            if (generation !== this.generation) return;
            const next: UiMessage = { role: "model", content: turn.text };
            if (turn.edits) {
                next.content = turn.text || "我已幫你準備好行程修改，請確認下方的變更。";
                // Applied and validated here, before an apply is even offered — one of the
                // gates between the model and the user's trip.
                try {
                    next.editYaml = applyItineraryEdits(baseYaml, turn.edits);
                    next.edits = turn.edits;
                    next.baseYaml = baseYaml;
                } catch (e) {
                    next.editError = e instanceof Error ? e.message : "AI 給的修改格式有誤。";
                }
            }
            this.messages = [...this.messages, next];
        } catch (err) {
            if (generation !== this.generation) return;
            // Pop the failed user turn and hand the text back to the composer: left in the
            // thread it would be replayed to the model as an unanswered turn, and the retry
            // would render the same bubble twice.
            this.messages = history;
            this.input = prompt;
            // A stop the user asked for is not an error to show them.
            this.errorText = controller.signal.aborted ? null : err instanceof Error ? err.message : "發生未知錯誤，請再試一次。";
        } finally {
            if (generation === this.generation) {
                this.isSending = false;
                this.sentAt = null;
                this.status = null;
                this.inFlight = null;
            }
        }
    }
}

export const aiChat = new AiChat();
