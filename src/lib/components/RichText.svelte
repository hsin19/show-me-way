<script lang="ts">
import {
    type InlineNode,
    parseInline,
} from "../domain/markdown";

interface Props {
    /** Inline Markdown, per `lib/markdown.ts`. Undefined renders nothing — these fields are optional at the gate. */
    text: string | undefined;
}

let { text }: Props = $props();

const nodes = $derived(parseInline(text));
</script>

<!-- Ordinary interpolation, never `{@html}`: share links import other people's
     YAML, so their prose must never be able to execute anything here.

     A link tap inside a checklist row does NOT tick the item off, but that is the
     HTML spec's doing rather than this handler's — a `<label>`'s activation
     behavior does nothing for an event targeted at an interactive descendant.
     `stopPropagation` only stops other Svelte handlers on ancestors, since Svelte
     delegates `onclick` to the root; keep it for that, but do not rely on it to
     suppress a native listener on the row.

     Keyed by index because a node IS its position in the string. -->

{#snippet render(list: InlineNode[])}
    {#each list as node, i (i)}
        {#if node.type === "text"}{node.value}
        {:else if node.type === "code"}<code class="font-mono text-[0.9em] px-1 py-0.5 rounded bg-tint-2 text-text-primary">{node.value}</code>
        {:else if node.type === "strong"}<strong class="font-bold text-text-primary">{@render render(node.children)}</strong>
        {:else if node.type === "em"}<em class="italic">{@render render(node.children)}</em>
        {:else}<a
                href={node.href}
                target="_blank"
                rel="noopener noreferrer"
                onclick={e => e.stopPropagation()}
                class="text-accent underline underline-offset-2 break-words hover:text-text-primary transition duration-200"
            >{@render render(node.children)}</a>{/if}
    {/each}
{/snippet}

{@render render(nodes)}
