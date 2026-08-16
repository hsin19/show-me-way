<script lang="ts">
import {
    type InlineNode,
    parseInline,
} from "../markdown";

interface Props {
    /** Prose that may carry the inline-Markdown subset — see `lib/markdown.ts`. Undefined renders nothing: the fields behind it are optional at the gate. */
    text: string | undefined;
}

let { text }: Props = $props();

const nodes = $derived(parseInline(text));
</script>

<!-- Walks the node tree from `parseInline`. Every leaf goes through ordinary
     interpolation, never `{@html}` — share links import other people's YAML, so
     their prose must never be able to execute anything here. `sanitizeHref` has
     already rejected any non-http(s)/mailto target upstream.

     A link tap inside a checklist row does NOT tick the item off, but that is
     the HTML spec's doing, not this handler's: a `<label>`'s activation
     behavior is defined to do nothing for events targeted at an interactive
     descendant. `stopPropagation` only stops OTHER Svelte handlers on ancestor
     elements — Svelte delegates `onclick` to the root, so it runs after the
     event has already passed the label. Keep it for that case; do not rely on
     it to suppress a native `addEventListener` on the row.

     Keyed by index because a node IS its position in the string — it has no
     identity of its own to key on. -->

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
