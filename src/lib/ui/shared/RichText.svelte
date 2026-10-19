<script lang="ts">
import {
    type InlineNode,
    type ListBlock,
    type ListItem,
    parseMarkdown,
} from "$lib/domain/markdown";

interface Props {
    /** Markdown, per `domain/markdown.ts`. Undefined renders nothing — these fields are optional at the gate. */
    text: string | undefined;
}

let { text }: Props = $props();

const blocks = $derived(parseMarkdown(text));
// A lone paragraph renders bare, with no wrapper of its own: that is all a one-line field
// ever is, so a desc inside a card's text or an item inside a checklist row lays out as
// plain inline text, and only prose that really has blocks brings block elements along.
const lone = $derived(blocks.length === 1 && blocks[0]!.type === "paragraph" ? blocks[0]!.lines : null);
</script>

<!-- Ordinary interpolation, never `{@html}`: share links import other people's
     YAML and the AI's replies are the model's to write, so neither may ever be able
     to execute anything here.

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

{#snippet lines(list: InlineNode[][])}
    {#each list as line, i (i)}{#if i > 0}<br>{/if}{@render render(line)}{/each}
{/snippet}

<!-- One line, and an item rendered through a snippet of its own: the formatter breaks an
     element's children onto separate lines, and Svelte turns those line breaks into a
     space at the end of every item. -->
{#snippet item(entry: ListItem)}{@render lines(entry.lines)}{#if entry.sublist}{@render listBlock(entry.sublist, true)}{/if}{/snippet}

{#snippet listBlock(block: ListBlock, nested: boolean)}
    {#if block.ordered}
        <ol class="list-decimal pl-5 space-y-0.5 {nested ? 'mt-0.5' : ''}" start={block.start}>
            {#each block.items as entry, k (k)}
                <li>{@render item(entry)}</li>
            {/each}
        </ol>
    {:else}
        <ul class="pl-4 space-y-0.5 {nested ? 'list-[circle] mt-0.5' : 'list-disc'}">
            {#each block.items as entry, k (k)}
                <li>{@render item(entry)}</li>
            {/each}
        </ul>
    {/if}
{/snippet}

{#if lone}
    {@render lines(lone)}
{:else if blocks.length > 0}
    <div class="space-y-1.5">
        {#each blocks as block, i (i)}
            {#if block.type === "paragraph"}
                <p>{@render lines(block.lines)}</p>
            {:else if block.type === "heading"}
                <svelte:element this={`h${block.level + 2}`} class="font-bold text-text-primary">{@render render(block.children)}</svelte:element>
            {:else if block.type === "list"}
                {@render listBlock(block, false)}
            {:else}
                <hr class="border-line">
            {/if}
        {/each}
    </div>
{/if}
