<script lang="ts">
import Monitor from "@lucide/svelte/icons/monitor";
import Moon from "@lucide/svelte/icons/moon";
import Palette from "@lucide/svelte/icons/palette";
import Sun from "@lucide/svelte/icons/sun";
import {
    setThemePref,
    theme,
    type ThemePref,
} from "../theme.svelte";

// App-level preferences, as opposed to the trip-level 行程管理 page. Nothing
// here travels with a trip profile or the itinerary YAML.

const THEMES: { id: ThemePref; label: string; icon: typeof Sun; hint: string; }[] = [
    { id: "system", label: "跟隨系統", icon: Monitor, hint: "依裝置的深淺色設定自動切換" },
    { id: "light", label: "淺色", icon: Sun, hint: "紙感淺色，白天在外面看得比較清楚" },
    { id: "dark", label: "深色", icon: Moon, hint: "沉穩深藍，夜間或室內比較不刺眼" },
];

let activeHint = $derived(THEMES.find(t => t.id === theme.pref)?.hint ?? "");
</script>

<div class="mb-4">
    <h2 class="text-xl font-extrabold text-text-primary tracking-tight flex items-center gap-2">
        <Palette size={22} class="text-accent" aria-hidden="true" />App 設定
    </h2>
    <p class="text-xs text-text-secondary mt-0.5">此頁的設定屬於整個 App，不隨行程切換</p>
</div>

<section class="panel rounded-xl p-3.5">
    <h3 class="text-sm font-bold text-text-primary mb-2.5">外觀</h3>

    <!-- radiogroup rather than three buttons: this is one setting with three
         mutually exclusive values, and arrow keys should move between them. -->
    <div role="radiogroup" aria-label="外觀主題" class="flex gap-2">
        {#each THEMES as option (option.id)}
            {@const selected = theme.pref === option.id}
            <button
                type="button"
                role="radio"
                aria-checked={selected}
                onclick={() => setThemePref(option.id)}
                class="
                    flex-1 min-h-[44px] flex flex-col items-center justify-center gap-1 px-2 py-2.5
                    rounded-xl border text-[11px] font-bold transition duration-200 cursor-pointer
                    {selected
                    ? 'bg-accent/15 border-accent/40 text-accent'
                    : 'bg-tint-1 border-card-border text-text-secondary hover:bg-tint-2'}
                "
            >
                <option.icon size={17} aria-hidden="true" />
                {option.label}
            </button>
        {/each}
    </div>

    <!-- No line break before the fullwidth parenthesis: Svelte would keep the
         whitespace and zh-TW punctuation must sit flush against the text. -->
    <p class="text-[11px] text-text-muted mt-2.5 leading-normal">
        {activeHint}{#if theme.pref === "system"}<span class="text-text-secondary"
            >（目前為{
                    theme.resolved === "dark"
                    ? "深色"
                    : "淺色"
                }）</span>{/if}
    </p>
</section>
