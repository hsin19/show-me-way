import {
    type GeminiModel,
    type GeminiModelFilterMode,
    listGeminiModels,
    loadGeminiModel,
    pickDefaultModel,
    saveGeminiModel,
} from "./gemini";

// Last-resort id for when a send happens with no list to choose from — only
// reachable if the models call failed but the user got to a composer anyway.
const FALLBACK_MODEL = "gemini-3.5-flash";

/**
 * "Which models can this key use, and which one is picked" — shared by the
 * App 設定 model picker and ChatPanel's header select, which would otherwise
 * keep two copies of the same fetch//select/persist dance and drift apart.
 *
 * Both components own the same localStorage key, so the default-model decision
 * has to live in one place: whichever screen the user opens first is the one
 * that writes it.
 *
 * Call at component init — it registers an `$effect`, so the fetch is torn down
 * with the component and a late response cannot write into a dead one.
 */
export function createModelPicker(
    getKey: () => string | null,
    getFilterMode?: () => GeminiModelFilterMode,
) {
    let list = $state<GeminiModel[]>([]);
    let loading = $state(false);
    // Listing the models doubles as key validation — the Gemini API has no
    // separate verify endpoint, a bad key just 400s here. Callers surface this
    // rather than letting the user discover it when their first send fails.
    let error = $state<string | null>(null);
    let selected = $state(loadGeminiModel() ?? "");
    let retryToken = $state(0);

    $effect(() => {
        const key = getKey();
        const mode = getFilterMode?.();
        void retryToken;
        if (!key) {
            list = [];
            error = null;
            return;
        }
        loading = true;
        error = null;
        let cancelled = false;
        listGeminiModels(key, mode)
            .then(models => {
                if (cancelled) return;
                list = models;
                // Re-pick when the user has no stored preference, or when the
                // stored one is not among the models this key can actually use.
                const hasStoredPreference = loadGeminiModel() !== null;
                if (!hasStoredPreference || !models.some(m => m.id === selected)) {
                    const fallback = pickDefaultModel(models);
                    if (fallback) {
                        selected = fallback;
                        saveGeminiModel(fallback);
                    }
                }
            })
            .catch((err: unknown) => {
                if (cancelled) return;
                console.error("Failed to list Gemini models", err);
                list = [];
                error = err instanceof Error ? err.message : "無法取得模型清單，請稍後再試。";
            })
            .finally(() => {
                if (!cancelled) loading = false;
            });
        return () => {
            cancelled = true;
        };
    });

    return {
        get list() {
            return list;
        },
        get loading() {
            return loading;
        },
        get error() {
            return error;
        },
        /** Bindable: assigning through this persists, so there is no onchange to forget. */
        get selected() {
            return selected;
        },
        set selected(id: string) {
            selected = id;
            saveGeminiModel(id);
        },
        /** The id to actually send with, never empty. */
        get activeModel() {
            return selected || pickDefaultModel(list) || FALLBACK_MODEL;
        },
        /** Re-run the fetch. listGeminiModels drops its memory cache on rejection, so this really retries. */
        retry() {
            retryToken++;
        },
        /** Forget the selection when the key it belonged to is cleared. */
        reset() {
            list = [];
            error = null;
            selected = "";
        },
    };
}
