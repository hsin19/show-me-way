<script lang="ts">
import TriangleAlert from "@lucide/svelte/icons/triangle-alert";

interface Props {
    message: string;
    confirmLabel?: string;
    cancelLabel?: string;
    onconfirm: () => void;
    oncancel: () => void;
}

let {
    message,
    confirmLabel = "確定",
    cancelLabel = "取消",
    onconfirm,
    oncancel,
}: Props = $props();
</script>

<div class="rounded-xl border border-danger/40 bg-danger/10 p-2.5">
    <p class="flex items-start gap-1.5 text-[11px] font-medium text-danger leading-normal">
        <TriangleAlert size={14} class="shrink-0 mt-px" aria-hidden="true" />
        {message}
    </p>
    <div class="mt-2 flex gap-2">
        <button
            type="button"
            onclick={onconfirm}
            class="
                flex-1 min-h-[44px] rounded-lg bg-danger text-accent-contrast text-xs font-bold
                cursor-pointer hover:opacity-90 transition duration-200
            "
        >
            {confirmLabel}
        </button>
        <button
            type="button"
            onclick={oncancel}
            class="
                flex-1 min-h-[44px] rounded-lg bg-tint-2 text-text-secondary text-xs font-bold
                cursor-pointer hover:bg-tint-3 transition duration-200
            "
        >
            {cancelLabel}
        </button>
    </div>
</div>
