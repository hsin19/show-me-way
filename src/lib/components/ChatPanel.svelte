<script lang="ts">
import KeyRound from "@lucide/svelte/icons/key-round";
import Loader2 from "@lucide/svelte/icons/loader-2";
import Send from "@lucide/svelte/icons/send";
import Sparkles from "@lucide/svelte/icons/sparkles";
import TriangleAlert from "@lucide/svelte/icons/triangle-alert";
import { tick } from "svelte";
import type { TripData } from "../api";
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

interface Props {
    tripData: TripData;
}

let { tripData }: Props = $props();

// In-memory only (v1): closing the tab keeps state, a page reload clears it.
let messages = $state<ChatMessage[]>([]);
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

    try {
        const activeModel = model || (models.length > 0 ? models[0].id : "gemini-3.5-flash");
        const reply = await sendChatMessage(apiKey, activeModel, history, text, buildItineraryContext(tripData));
        messages = [...messages, { role: "model", content: reply }];
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
                    <p class="text-xs text-text-secondary mt-0.5">用自然語言詢問你的行程</p>
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
                        <p>試著問問看：</p>
                        <p class="mt-1 text-text-secondary">「第二天的行程是什麼？」</p>
                        <p class="text-text-secondary">「這趟旅程住哪些飯店？」</p>
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
                    placeholder="詢問你的行程…"
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
