<script lang="ts">
import type { SVGAttributes } from "svelte/elements";

interface Props extends SVGAttributes<SVGSVGElement> {
    size?: number | string;
}

// Naver icon from Simple Icons (https://simpleicons.org/?q=naver).
// Uses `currentColor` so it inherits the surrounding text color.
let { size = 24, ...rest }: Props = $props();
</script>

<svg role="img" width={size} height={size} viewBox="0 0 24 24" fill="currentColor" {...rest}>
    <path d="M16.273 12.845 7.376 0H0v24h7.726V11.156L16.624 24H24V0h-7.727v12.845Z" />
</svg>
