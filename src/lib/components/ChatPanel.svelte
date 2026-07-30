<script lang="ts">
import Check from "@lucide/svelte/icons/check";
import KeyRound from "@lucide/svelte/icons/key-round";
import Loader2 from "@lucide/svelte/icons/loader-2";
import RefreshCw from "@lucide/svelte/icons/refresh-cw";
import Send from "@lucide/svelte/icons/send";
import Settings from "@lucide/svelte/icons/settings";
import Sparkles from "@lucide/svelte/icons/sparkles";
import TriangleAlert from "@lucide/svelte/icons/triangle-alert";
import WandSparkles from "@lucide/svelte/icons/wand-sparkles";
import { tick } from "svelte";
import {
    type TripData,
    validateYaml,
} from "../api";
import { edgeFade } from "../edge-fade";
import {
    buildItineraryContext,
    type ChatMessage,
    loadGeminiApiKey,
    sendChatMessage,
} from "../gemini";
import { createModelPicker } from "../gemini-models.svelte";
import DiffView from "./DiffView.svelte";

interface Props {
    tripData: TripData;
    /** Apply a full itinerary YAML the chat proposed; returns whether it took. */
    onApplyEdit: (yaml: string) => boolean;
    /** Navigate to App Settings page. */
    onOpenAppSettings?: () => void;
}

let { tripData, onApplyEdit, onOpenAppSettings }: Props = $props();

// A chat message plus the UI-only edit state for conversational edits. `content`
// is the text replayed to Gemini as history (the prose / edit summary, never the
// raw YAML — the current itinerary is re-sent each turn via the system prompt).
interface UiMessage extends ChatMessage {
    /** Validated full itinerary YAML the model proposed via the update_itinerary tool. */
    editYaml?: string;
    /** Itinerary YAML at the time the edit was proposed, for a stable before/after diff. */
    baseYaml?: string;
    /** Whether the user has already applied this edit. */
    editApplied?: boolean;
    /** Validation error when the model's proposed edit was not a valid itinerary. */
    editError?: string;
}

// In-memory only (v1): closing the tab keeps state, a page reload clears it.
let messages = $state<UiMessage[]>([]);
let input = $state("");
let isSending = $state(false);
let errorText = $state<string | null>(null);

// The key persists in localStorage; this mirrors it so the view reacts to
// save / clear without a reload.
let apiKey = $state<string | null>(loadGeminiApiKey());

// Model selection, fetched per key so it always reflects what that key can
// actually use. The App 設定 picker runs on the same helper — see
// `gemini-models.svelte.ts` for why this is not inlined here.
const modelPicker = createModelPicker(() => apiKey);

let scrollEl = $state<HTMLDivElement>();
let composerEl = $state<HTMLTextAreaElement>();

// Newlines are allowed, so the composer grows with the text up to ~5 lines and
// scrolls after that; clearing `input` after a send shrinks it back.
$effect(() => {
    const el = composerEl;
    if (!el) return;
    void input;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 132)}px`;
});

const QUICK_PROMPTS = [
    { label: "在地美食推薦", icon: "🍽️", text: "推薦這趟行程當地的必吃美食與口袋名單" },
    { label: "檢查行程節奏", icon: "⏱️", text: "幫我檢查各天景點的時間安排是否過於緊湊" },
    { label: "整理住宿資訊", icon: "🏨", text: "整理這次旅程的所有飯店住宿點與退房時間" },
    { label: "雨天備案景點", icon: "🌧️", text: "提供幾項適合當作雨天備案的室內景點建議" },
];

async function triggerSend(promptText: string) {
    const text = promptText.trim();
    if (!text || isSending || !apiKey) return;

    const history = messages;
    messages = [...history, { role: "user", content: text }];
    input = "";
    errorText = null;
    isSending = true;
    await scrollToBottom();

    // Snapshot the itinerary the model is editing against, so a proposed edit's
    // before/after diff stays stable even after it (or another edit) is applied.
    const baseYaml = buildItineraryContext(tripData);

    try {
        const turn = await sendChatMessage(apiKey, modelPicker.activeModel, history, text, baseYaml);
        // The edit tool's handler: validate the proposed YAML here, then surface
        // it behind a confirm step. Invalid edits show an inline note instead.
        const next: UiMessage = { role: "model", content: turn.text || turn.edit?.summary || "" };
        if (turn.edit) {
            next.content = turn.text || turn.edit.summary || "我已幫你準備好行程修改，請確認下方的變更。";
            try {
                validateYaml(turn.edit.yaml);
                next.editYaml = turn.edit.yaml;
                next.baseYaml = baseYaml;
            } catch (e) {
                next.editError = e instanceof Error ? e.message : "AI 產生的行程格式有誤。";
            }
        }
        messages = [...messages, next];
    } catch (err) {
        // Keep the user's question in place so they can retry; surface the cause.
        errorText = err instanceof Error ? err.message : "發生未知錯誤，請再試一次。";
    } finally {
        isSending = false;
        await scrollToBottom();
    }
}

async function send(e: SubmitEvent) {
    e.preventDefault();
    await triggerSend(input);
}

// Enter is a newline (the composer is a textarea), so desktop keeps a shortcut.
function onComposerKeydown(e: KeyboardEvent) {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        void triggerSend(input);
    }
}

async function scrollToBottom() {
    await tick();
    scrollEl?.scrollTo({ top: scrollEl.scrollHeight, behavior: "smooth" });
}

// Hand the proposed YAML to App, which validates, backs up, and swaps it in.
// Mark the card as applied only when it actually took.
function applyEdit(message: UiMessage) {
    if (!message.editYaml || message.editApplied) return;
    if (onApplyEdit(message.editYaml)) message.editApplied = true;
}
</script>

<div class="h-full flex flex-col">
    {#if !apiKey}
        <!-- No key set: direct user to App Settings -->
        <div class="flex-1 overflow-y-auto overscroll-contain flex items-center justify-center p-5">
            <div class="max-w-md w-full panel rounded-2xl p-6 text-center space-y-4">
                <div class="w-12 h-12 rounded-full bg-accent/15 text-accent flex items-center justify-center mx-auto">
                    <KeyRound size={24} aria-hidden="true" />
                </div>
                <div class="space-y-1">
                    <h2 class="text-lg font-extrabold text-text-primary tracking-tight">
                        尚未設定 AI 金鑰
                    </h2>
                    <p class="text-xs text-text-secondary leading-relaxed">
                        使用 AI 行程小幫手查詢或編輯行程前，請先至 App 設定填寫你的 Google Gemini API 金鑰。
                    </p>
                </div>
                {#if onOpenAppSettings}
                    <button
                        type="button"
                        onclick={onOpenAppSettings}
                        class="w-full bg-accent text-accent-contrast font-bold py-3 px-4 rounded-xl text-sm transition active:scale-[0.98] cursor-pointer flex items-center justify-center gap-2"
                    >
                        <Settings size={16} aria-hidden="true" />
                        前往 App 設定
                    </button>
                {/if}
            </div>
        </div>
    {:else if modelPicker.error}
        <!-- The models call is the only key check there is, and it hits the same
             host as the chat itself — if it failed, sending cannot work either.
             So this replaces the whole tab rather than sitting above a composer
             that would only fail again. 重試 is here because the cause may be a
             network blip, which would otherwise dead-end on a settings page that
             has nothing wrong to fix. -->
        <div role="alert" class="flex-1 overflow-y-auto overscroll-contain flex items-center justify-center p-5">
            <div class="max-w-md w-full panel rounded-2xl p-6 text-center space-y-4">
                <div class="w-12 h-12 rounded-full bg-danger/15 text-danger flex items-center justify-center mx-auto">
                    <TriangleAlert size={24} aria-hidden="true" />
                </div>
                <div class="space-y-1">
                    <h2 class="text-lg font-extrabold text-text-primary tracking-tight">
                        AI 金鑰無法使用
                    </h2>
                    <p class="text-xs text-text-secondary leading-relaxed whitespace-pre-line">{modelPicker.error}</p>
                </div>
                <div class="space-y-2">
                    {#if onOpenAppSettings}
                        <button
                            type="button"
                            onclick={onOpenAppSettings}
                            class="w-full bg-accent text-accent-contrast font-bold py-3 px-4 rounded-xl text-sm transition active:scale-[0.98] cursor-pointer flex items-center justify-center gap-2"
                        >
                            <Settings size={16} aria-hidden="true" />
                            前往 App 設定
                        </button>
                    {/if}
                    <button
                        type="button"
                        onclick={() => modelPicker.retry()}
                        disabled={modelPicker.loading}
                        class="w-full bg-tint-1 border border-card-border text-text-secondary hover:bg-tint-2 font-bold py-2.5 px-4 rounded-xl text-sm transition active:scale-[0.98] cursor-pointer disabled:opacity-40 flex items-center justify-center gap-2"
                    >
                        {#if modelPicker.loading}
                            <Loader2 size={16} class="animate-spin" aria-hidden="true" />
                        {:else}
                            <RefreshCw size={16} aria-hidden="true" />
                        {/if}
                        重試
                    </button>
                </div>
            </div>
        </div>
    {:else}
        <!-- Header -->
        <div class="shrink-0 px-5 pt-[calc(16px+var(--safe-top))] pb-3 border-b border-line flex items-center justify-between gap-3">
            <h2 class="text-lg font-extrabold text-text-primary tracking-tight flex items-center gap-2 min-w-0">
                <Sparkles size={20} class="text-accent shrink-0" aria-hidden="true" /><span class="truncate">AI 行程小幫手</span>
            </h2>
            <div class="flex items-center gap-2 shrink-0">
                <select
                    bind:value={modelPicker.selected}
                    disabled={modelPicker.loading}
                    aria-label="選擇 AI 模型"
                    class="max-w-[9rem] bg-well-deep border border-card-border rounded-lg px-2 py-1.5 text-xs text-text-primary outline-none focus:border-accent transition cursor-pointer disabled:opacity-50"
                >
                    {#if modelPicker.list.length === 0}
                        <option value={modelPicker.selected}>{modelPicker.selected || (modelPicker.loading ? "載入模型中…" : "自動選擇")}</option>
                    {:else}
                        {#each modelPicker.list as m (m.id)}
                            <option value={m.id}>{m.displayName}</option>
                        {/each}
                    {/if}
                </select>
                {#if onOpenAppSettings}
                    <button
                        onclick={onOpenAppSettings}
                        aria-label="前往 App 設定管理 AI 金鑰"
                        title="前往 App 設定管理 AI 金鑰"
                        class="text-text-muted hover:text-accent transition cursor-pointer flex items-center justify-center p-1 rounded-lg shrink-0"
                    >
                        <Settings size={18} aria-hidden="true" />
                    </button>
                {/if}
            </div>
        </div>

        <!-- Messages -->
        <div bind:this={scrollEl} class="flex-1 min-h-0 overflow-y-auto overscroll-contain px-5 py-4">
            <div class="max-w-3xl mx-auto w-full space-y-3">
                {#if messages.length === 0}
                    <div class="text-center text-text-muted text-sm py-10">
                        <Sparkles size={28} class="text-text-muted mx-auto mb-3" aria-hidden="true" />
                        <p>試著問問看，或直接用說的編輯行程：</p>
                        <p class="mt-1 text-text-secondary">「第二天的行程是什麼？」</p>
                        <p class="text-text-secondary">「幫我在第三天下午加一個咖啡廳」</p>
                        <p class="text-text-secondary">「把待辦加上『換日幣』」</p>
                    </div>
                {/if}
                {#each messages as message, i (i)}
                    <div class="flex {message.role === 'user' ? 'justify-end' : 'justify-start'}">
                        <div
                            class="
                                max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed whitespace-pre-wrap break-words
                                {message.role === 'user'
                                ? 'bg-accent text-accent-contrast font-medium'
                                : 'panel text-text-primary'}
                            "
                        >
                            {message.content}
                        </div>
                    </div>
                    {#if message.editError}
                        <!-- The model proposed an edit, but it failed validation. -->
                        <div class="flex justify-start">
                            <div class="max-w-[85%] flex items-start gap-1.5 text-xs text-danger bg-danger/10 border border-danger/20 p-2.5 rounded-lg">
                                <TriangleAlert size={14} class="shrink-0 mt-px" aria-hidden="true" />
                                <span>AI 產生的行程無效，未套用。{message.editError}</span>
                            </div>
                        </div>
                    {:else if message.editYaml}
                        <!-- Conversational edit: confirm before changing the itinerary. -->
                        <div class="flex justify-start">
                            <div class="max-w-[85%] w-full rounded-2xl border border-accent/25 bg-accent/8 p-3 space-y-2.5">
                                <div class="flex items-center gap-1.5 text-xs font-semibold text-accent">
                                    <WandSparkles size={14} aria-hidden="true" />AI 建議修改行程
                                </div>
                                <DiffView base={message.baseYaml ?? ""} proposed={message.editYaml} />
                                {#if message.editApplied}
                                    <div class="flex items-center gap-1.5 text-xs font-semibold text-positive">
                                        <Check size={14} aria-hidden="true" />已套用變更
                                    </div>
                                {:else}
                                    <button
                                        onclick={() => applyEdit(message)}
                                        class="w-full bg-accent text-accent-contrast font-bold py-2.5 px-4 rounded-xl text-sm transition active:scale-[0.98] cursor-pointer"
                                    >
                                        套用變更
                                    </button>
                                    <p class="text-[11px] text-text-muted leading-relaxed">
                                        套用前會自動備份目前行程，可在設定中還原。
                                    </p>
                                {/if}
                            </div>
                        </div>
                    {/if}
                {/each}
                {#if isSending}
                    <div class="flex justify-start">
                        <div class="panel rounded-2xl px-3.5 py-2.5 text-text-secondary">
                            <Loader2 size={16} class="animate-spin" aria-hidden="true" />
                        </div>
                    </div>
                {/if}
                {#if errorText}
                    <div class="flex items-start gap-1.5 text-xs text-danger bg-danger/10 border border-danger/20 p-2.5 rounded-lg">
                        <TriangleAlert size={14} class="shrink-0 mt-px" aria-hidden="true" />
                        <span class="whitespace-pre-line">{errorText}</span>
                    </div>
                {/if}
            </div>
        </div>

        <!-- Input -->
        <!-- No border-t: the quick prompt chips now lead this block, and a rule
             running straight across them read as a stray line rather than as the
             edge of the composer. -->
        <div class="shrink-0 px-5 pb-4 pt-2">
            <div class="max-w-3xl mx-auto w-full">
                <!-- Quick prompt chips bar. Same scrolling chip row as TabPager's
                     header and PhraseDeck's filter: the shared edgeFade attachment,
                     plus room inside the scrollport for the focus ring (a
                     horizontal scrollport clips vertically too — see
                     TabPager.svelte). pb-2 already provides it at the bottom; the
                     top needs pt-1.5, pulled back by -mt-1.5 so nothing moves. -->
                <div
                    class="-mt-1.5 pt-1.5 pb-2 overflow-x-auto no-scrollbar edge-fade"
                    data-swipe-ignore
                    {@attach edgeFade}
                >
                    <div class="flex gap-2">
                        {#each QUICK_PROMPTS as p (p.label)}
                            <button
                                type="button"
                                disabled={isSending}
                                onclick={() => triggerSend(p.text)}
                                class="flex-none min-h-[36px] px-3 py-1.5 rounded-xl bg-tint-1 border border-card-border text-xs font-bold text-text-secondary hover:text-accent hover:bg-tint-2 transition duration-200 cursor-pointer disabled:opacity-50 flex items-center gap-1.5"
                            >
                                <span>{p.icon}</span>
                                <span>{p.label}</span>
                            </button>
                        {/each}
                    </div>
                </div>

                <form onsubmit={send} class="flex items-end gap-2">
                    <textarea
                        bind:this={composerEl}
                        bind:value={input}
                        onkeydown={onComposerKeydown}
                        aria-label="輸入問題"
                        autocomplete="off"
                        rows="1"
                        enterkeyhint="enter"
                        placeholder="詢問或用說的編輯行程…（Enter 換行）"
                        disabled={isSending}
                        class="flex-1 min-w-0 resize-none bg-well-deep border border-card-border rounded-xl px-3 py-2.5 text-sm text-text-primary outline-none focus:border-accent transition disabled:opacity-50"
                    ></textarea>
                    <button
                        type="submit"
                        aria-label="送出"
                        disabled={!input.trim() || isSending}
                        class="flex-shrink-0 bg-accent text-accent-contrast rounded-xl p-2.5 transition active:scale-[0.96] cursor-pointer disabled:opacity-40"
                    >
                        <Send size={18} class="stroke-[2.5]" aria-hidden="true" />
                    </button>
                </form>
            </div>
        </div>
    {/if}
</div>
