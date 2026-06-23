<script lang="ts">
import Check from "@lucide/svelte/icons/check";
import KeyRound from "@lucide/svelte/icons/key-round";
import Loader2 from "@lucide/svelte/icons/loader-2";
import Send from "@lucide/svelte/icons/send";
import Sparkles from "@lucide/svelte/icons/sparkles";
import TriangleAlert from "@lucide/svelte/icons/triangle-alert";
import WandSparkles from "@lucide/svelte/icons/wand-sparkles";
import { tick } from "svelte";
import {
    type TripData,
    validateYaml,
} from "../api";
import {
    buildItineraryContext,
    type ChatMessage,
    clearGeminiApiKey,
    type GeminiModel,
    listGeminiModels,
    loadGeminiApiKey,
    loadGeminiModel,
    saveGeminiApiKey,
    saveGeminiModel,
    sendChatMessage,
} from "../gemini";
import { showToast } from "../toast.svelte";
import DiffView from "./DiffView.svelte";

interface Props {
    tripData: TripData;
    /** Apply a full itinerary YAML the chat proposed; returns whether it took. */
    onApplyEdit: (yaml: string) => boolean;
}

let { tripData, onApplyEdit }: Props = $props();

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
let keyInput = $state("");

// Model selection: the chosen id persists; the list is fetched per key (so it
// always reflects what that key can actually use, never a hardcoded list).
let model = $state(loadGeminiModel() ?? "");
let models = $state<GeminiModel[]>([]);
let modelsLoading = $state(false);

let scrollEl = $state<HTMLDivElement>();

// Fetch the available models whenever a key is present (initial mount or after
// saving one). Failure falls back to the default — chat still works.
$effect(() => {
    const key = apiKey;
    if (!key) {
        models = [];
        return;
    }
    modelsLoading = true;
    let cancelled = false;
    listGeminiModels(key)
        .then(list => {
            if (cancelled) return;
            models = list;
            // Default to the first model (dynamically sorted to be the newest stable
            // Flash model) if the user has no stored preference, or if the stored preference is missing.
            const hasStoredPreference = loadGeminiModel() !== null;
            if (list.length > 0) {
                if (!hasStoredPreference || !list.some(m => m.id === model)) {
                    model = list[0].id;
                    saveGeminiModel(model);
                }
            }
        })
        .catch((err: unknown) => {
            if (cancelled) return;
            console.error("Failed to list Gemini models", err);
        })
        .finally(() => {
            if (!cancelled) modelsLoading = false;
        });
    return () => {
        cancelled = true;
    };
});

function persistModel() {
    saveGeminiModel(model);
}

function saveKey(e: SubmitEvent) {
    e.preventDefault();
    const key = keyInput.trim();
    if (!key) return;
    saveGeminiApiKey(key);
    apiKey = key;
    keyInput = "";
    showToast("已儲存 API 金鑰");
}

function changeKey() {
    clearGeminiApiKey();
    apiKey = null;
    models = [];
    showToast("已清除 API 金鑰");
}

async function send(e: SubmitEvent) {
    e.preventDefault();
    const text = input.trim();
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
        const activeModel = model || (models.length > 0 ? models[0].id : "gemini-3.5-flash");
        const turn = await sendChatMessage(apiKey, activeModel, history, text, baseYaml);
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
        <!-- First-use: prompt for the user's own Gemini key. -->
        <div class="flex-1 overflow-y-auto overscroll-contain">
            <div class="max-w-md mx-auto w-full p-5 pt-[calc(20px+var(--safe-top))]">
                <div class="mb-4">
                    <h2 class="text-xl font-extrabold text-text-primary tracking-tight flex items-center gap-2">
                        <Sparkles size={22} class="text-neon-blue" aria-hidden="true" />AI 行程小幫手
                    </h2>
                    <p class="text-xs text-text-secondary mt-0.5">用自然語言查詢或編輯你的行程</p>
                </div>
                <form onsubmit={saveKey} class="glass-panel rounded-2xl p-5 space-y-4">
                    <div class="flex items-start gap-2 text-text-secondary">
                        <KeyRound size={18} class="text-neon-purple shrink-0 mt-0.5" aria-hidden="true" />
                        <p class="text-sm leading-relaxed">
                            請輸入你的 Google Gemini API 金鑰。金鑰只會儲存在這台裝置上，不會上傳。
                        </p>
                    </div>
                    <input
                        bind:value={keyInput}
                        type="password"
                        autocomplete="off"
                        aria-label="Gemini API 金鑰"
                        placeholder="貼上 API 金鑰…"
                        class="w-full bg-black/40 border border-card-border rounded-xl px-3 py-2.5 text-sm text-text-primary outline-none focus:border-neon-blue transition"
                    />
                    <button
                        type="submit"
                        disabled={!keyInput.trim()}
                        class="w-full bg-gradient-to-r from-neon-blue to-neon-purple text-black font-bold py-3 px-4 rounded-xl text-sm transition active:scale-[0.98] cursor-pointer disabled:opacity-40"
                    >
                        儲存並開始
                    </button>
                    <a
                        href="https://aistudio.google.com/app/apikey"
                        target="_blank"
                        rel="noopener noreferrer"
                        class="block text-center text-xs text-neon-blue hover:underline"
                    >
                        前往 Google AI Studio 取得免費金鑰
                    </a>
                </form>
            </div>
        </div>
    {:else}
        <!-- Header -->
        <div class="shrink-0 px-5 pt-[calc(16px+var(--safe-top))] pb-3 border-b border-white/5 flex items-center justify-between gap-3">
            <h2 class="text-lg font-extrabold text-text-primary tracking-tight flex items-center gap-2 min-w-0">
                <Sparkles size={20} class="text-neon-blue shrink-0" aria-hidden="true" /><span class="truncate">AI 行程小幫手</span>
            </h2>
            <div class="flex items-center gap-2 shrink-0">
                <select
                    bind:value={model}
                    onchange={persistModel}
                    disabled={modelsLoading}
                    aria-label="選擇 AI 模型"
                    class="max-w-[9rem] bg-black/40 border border-card-border rounded-lg px-2 py-1.5 text-xs text-text-primary outline-none focus:border-neon-blue transition cursor-pointer disabled:opacity-50"
                >
                    {#if models.length === 0}
                        <option value={model}>{modelsLoading ? "載入模型中…" : (model || "自動選擇")}</option>
                    {:else}
                        {#each models as m (m.id)}
                            <option value={m.id}>{m.displayName}</option>
                        {/each}
                    {/if}
                </select>
                <button
                    onclick={changeKey}
                    class="text-xs text-text-muted hover:text-neon-pink transition cursor-pointer shrink-0"
                >
                    更換金鑰
                </button>
            </div>
        </div>

        <!-- Messages -->
        <div bind:this={scrollEl} class="flex-1 min-h-0 overflow-y-auto overscroll-contain px-5 py-4">
            <div class="max-w-3xl mx-auto w-full space-y-3">
                {#if messages.length === 0}
                    <div class="text-center text-text-muted text-sm py-10">
                        <Sparkles size={28} class="text-neon-purple/60 mx-auto mb-3" aria-hidden="true" />
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
                                ? 'bg-gradient-to-r from-neon-blue to-neon-purple text-black font-medium'
                                : 'glass-panel text-text-primary'}
                            "
                        >
                            {message.content}
                        </div>
                    </div>
                    {#if message.editError}
                        <!-- The model proposed an edit, but it failed validation. -->
                        <div class="flex justify-start">
                            <div class="max-w-[85%] flex items-start gap-1.5 text-xs text-neon-pink bg-neon-pink/10 border border-neon-pink/20 p-2.5 rounded-lg">
                                <TriangleAlert size={14} class="shrink-0 mt-px" aria-hidden="true" />
                                <span>AI 產生的行程無效，未套用。{message.editError}</span>
                            </div>
                        </div>
                    {:else if message.editYaml}
                        <!-- Conversational edit: confirm before changing the itinerary. -->
                        <div class="flex justify-start">
                            <div class="max-w-[85%] w-full rounded-2xl border border-neon-purple/30 bg-neon-purple/5 p-3 space-y-2.5">
                                <div class="flex items-center gap-1.5 text-xs font-semibold text-neon-purple">
                                    <WandSparkles size={14} aria-hidden="true" />AI 建議修改行程
                                </div>
                                <DiffView base={message.baseYaml ?? ""} proposed={message.editYaml} />
                                {#if message.editApplied}
                                    <div class="flex items-center gap-1.5 text-xs font-semibold text-emerald-400">
                                        <Check size={14} aria-hidden="true" />已套用變更
                                    </div>
                                {:else}
                                    <button
                                        onclick={() => applyEdit(message)}
                                        class="w-full bg-gradient-to-r from-neon-blue to-neon-purple text-black font-bold py-2.5 px-4 rounded-xl text-sm transition active:scale-[0.98] cursor-pointer"
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
                        <div class="glass-panel rounded-2xl px-3.5 py-2.5 text-text-secondary">
                            <Loader2 size={16} class="animate-spin" aria-hidden="true" />
                        </div>
                    </div>
                {/if}
                {#if errorText}
                    <div class="flex items-start gap-1.5 text-xs text-neon-pink bg-neon-pink/10 border border-neon-pink/20 p-2.5 rounded-lg">
                        <TriangleAlert size={14} class="shrink-0 mt-px" aria-hidden="true" />
                        <span>{errorText}</span>
                    </div>
                {/if}
            </div>
        </div>

        <!-- Input -->
        <div class="shrink-0 px-5 pb-4 pt-2 border-t border-white/5">
            <form onsubmit={send} class="max-w-3xl mx-auto w-full flex items-center gap-2">
                <input
                    bind:value={input}
                    aria-label="輸入問題"
                    autocomplete="off"
                    placeholder="詢問或用說的編輯行程…"
                    disabled={isSending}
                    class="flex-1 min-w-0 bg-black/40 border border-card-border rounded-xl px-3 py-2.5 text-sm text-text-primary outline-none focus:border-neon-blue transition disabled:opacity-50"
                />
                <button
                    type="submit"
                    aria-label="送出"
                    disabled={!input.trim() || isSending}
                    class="flex-shrink-0 bg-gradient-to-r from-neon-blue to-neon-purple text-black rounded-xl p-2.5 transition active:scale-[0.96] cursor-pointer disabled:opacity-40"
                >
                    <Send size={18} class="stroke-[2.5]" aria-hidden="true" />
                </button>
            </form>
        </div>
    {/if}
</div>
