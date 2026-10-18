<script lang="ts">
import type { Attachment } from "$lib/domain/trip";
import LinkChip from "./LinkChip.svelte";

interface Props {
    attachment: Attachment;
}

let { attachment }: Props = $props();

// Drive's own viewer: a tap opens the Drive app on a phone, and the viewer's login decides access.
let url = $derived(`https://drive.google.com/file/d/${encodeURIComponent(attachment.fileId)}/view`);
</script>

<LinkChip label={attachment.label} {url} />
