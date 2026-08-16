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
 * Which models this key can use, and which one is picked — shared by App 設定's
 * picker and ChatPanel's header select. They write the same localStorage key, so
 * the "no stored preference yet" decision has to be made in one place or
 * whichever screen opens first silently wins.
 *
 * Call it at component init: it registers an `$effect`, so the fetch is torn down
 * with the component and a late response cannot write into a dead one.
 */
export function createModelPicker(
    getKey: () => string | null,
    getFilterMode?: () => GeminiModelFilterMode,
) {
    let list = $state<GeminiModel[]>([]);
    let loading = $state(false);
    // Worth rendering, not swallowing: listing the models is the only key
    // validation there is, so this is where a bad key surfaces instead of on the
    // user's first send.
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
        /** A real refetch, not a replay: `listGeminiModels` drops its memo on rejection. */
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
