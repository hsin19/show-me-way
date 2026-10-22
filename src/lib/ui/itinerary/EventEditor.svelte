<script lang="ts">
import type {
    HotelInfo,
    TimelineEvent,
} from "$lib/domain/trip";
import {
    clockOf,
    dateOf,
    setEndClock,
    setStartClock,
    setText,
    setTimeMode,
    type TimeMode,
    timeModeOf,
    withClock,
    withDate,
} from "$lib/domain/trip-edit";
import { autosize } from "$lib/ui/shared/autosize";
import ArrowDown from "@lucide/svelte/icons/arrow-down";
import ArrowUp from "@lucide/svelte/icons/arrow-up";
import ChevronDown from "@lucide/svelte/icons/chevron-down";
import Plus from "@lucide/svelte/icons/plus";
import Trash2 from "@lucide/svelte/icons/trash-2";
import TriangleAlert from "@lucide/svelte/icons/triangle-alert";
import X from "@lucide/svelte/icons/x";
import AttachmentUpload from "./AttachmentUpload.svelte";

// One timeline entry in edit mode — an event, or a hotel, which has the same fields — laid
// out as its card is, every word an input over the draft it is bound to. Fields an entry
// leaves empty stay out of the way behind the ＋ chips at the bottom.

interface Props {
    /** Bindable: the draft entry, changed in place. */
    entry: TimelineEvent | HotelInfo;
    /** The day an event sits on; absent for a hotel, which is timed by check-in and check-out dates. */
    dayDate?: string;
    error?: string;
    /** Absent at the top of the list. */
    onMoveUp?: () => void;
    /** Absent at the bottom of the list. */
    onMoveDown?: () => void;
    onInsertBelow: () => void;
    onRemove: () => void;
    /** The other days an event can move to, labelled for the picker; absent for a hotel. */
    moveTargets?: { date: string; label: string; }[];
    onMoveToDay?: (date: string) => void;
}

let { entry = $bindable(), dayDate, error, onMoveUp, onMoveDown, onInsertBelow, onRemove, moveTargets = [], onMoveToDay }: Props = $props();

function pickDay(select: HTMLSelectElement) {
    const date = select.value;
    // Back to the prompt: the picker is an action, not a setting that keeps its choice.
    select.value = "";
    if (date) onMoveToDay?.(date);
}

// 起訖時間 first, as the one to reach for: only a start the app can read drives 進行中 and a red-eye's next-day landing.
const TIME_MODES: [TimeMode, string][] = [["clock", "起訖時間"], ["text", "文字"]];
const TYPES = [["standard", "一般"], ["booked", "預訂"], ["must-go", "必訪"], ["option", "備選"]] as const;
const STAY = [["start", "入住"], ["end", "退房"]] as const;

const noun = $derived(dayDate ? "事件" : "住宿");

// Optional one-line fields opened from a ＋ chip and still empty: a cleared field leaves the
// entry, so without this it would vanish the moment it was opened.
let opened = $state<string[]>([]);
// The ＋ chips stay folded behind one, so a card in edit mode is not mostly buttons.
let adding = $state(false);

function addField(add: () => void) {
    add();
    adding = false;
}
const showLocalName = $derived(entry.localName !== undefined || opened.includes("localName"));
const showMapLink = $derived(entry.mapLink !== undefined || opened.includes("mapLink"));

function addTo<K extends "bullets" | "stops" | "links" | "alternatives" | "attachments">(key: K, item: NonNullable<TimelineEvent[K]>[number]) {
    // Pushed through the entry, not into what `??=` hands back: that is the bare array, not the reactive one.
    entry[key] ??= [];
    (entry[key] as unknown[]).push(item);
}

function setType(value: string) {
    if (value === "standard") delete entry.type;
    else entry.type = value as NonNullable<TimelineEvent["type"]>;
}

const field = "bg-transparent border-b border-dashed border-line-emphasis outline-none focus:border-solid focus:border-accent placeholder:text-text-muted placeholder:font-normal";
const chipField = "min-h-[44px] px-2 rounded-lg bg-tint-2 text-xs font-semibold text-text-secondary tabular-nums outline-none focus:ring-2 focus:ring-accent/60 placeholder:text-text-muted placeholder:font-normal";
const rowLabel = "shrink-0 w-14 text-[11px] font-bold text-text-muted";
const iconButton = "min-w-[44px] min-h-[44px] flex items-center justify-center rounded-xl text-text-muted hover:text-text-primary hover:bg-tint-2 transition cursor-pointer disabled:opacity-30 disabled:pointer-events-none";
const subLabel = "shrink-0 w-12 text-[11px] font-bold text-text-muted";
const chip = "min-h-[44px] px-3 inline-flex items-center gap-1 rounded-xl border border-dashed border-card-border text-[11px] font-bold text-text-muted hover:text-accent hover:border-accent/40 transition cursor-pointer";
</script>

{#snippet textRow(label: string, key: "address" | "localName" | "mapLink", placeholder: string)}
    <label class="flex items-center gap-2 text-xs">
        <span class={rowLabel}>{label}</span>
        <input
            bind:value={() => entry[key] ?? "", v => setText(entry, key, v)}
            autocomplete="off"
            {placeholder}
            class="{field} flex-1 min-w-0 min-h-[44px] text-text-secondary"
        />
    </label>
{/snippet}

{#snippet removeButton(label: string, onclick: () => void)}
    <button type="button" {onclick} aria-label={label} title={label} class="{iconButton} -my-1 -mr-2 shrink-0">
        <X size={16} aria-hidden="true" />
    </button>
{/snippet}

{#snippet section(title: string)}
    <p class="mt-3 mb-0.5 text-[11px] font-bold text-text-muted">{title}</p>
{/snippet}

<div class="panel rounded-2xl p-4 ring-1 ring-accent/40">
    <div class="flex items-center -mx-2 -mt-2 mb-1">
        <button type="button" onclick={onMoveUp} disabled={!onMoveUp} aria-label="上移" title="上移" class={iconButton}>
            <ArrowUp size={16} aria-hidden="true" />
        </button>
        <button type="button" onclick={onMoveDown} disabled={!onMoveDown} aria-label="下移" title="下移" class={iconButton}>
            <ArrowDown size={16} aria-hidden="true" />
        </button>
        {#if onMoveToDay && moveTargets.length > 0}
            <!-- value + onchange as for the type picker; appearance-none for WebKit's height. A
                 fixed width, since a select is as wide as its longest option and only the
                 prompt shows here — the native list still names each day in full. -->
            <div class="relative">
                <select aria-label="移到別天" value="" onchange={e => pickDay(e.currentTarget)} class="appearance-none w-[3.75rem] min-h-[44px] pl-2 pr-5 bg-transparent text-[11px] font-bold text-text-muted hover:text-text-primary outline-none cursor-pointer">
                    <option value="" disabled>移到…</option>
                    {#each moveTargets as target (target.date)}
                        <option value={target.date}>{target.label}</option>
                    {/each}
                </select>
                <ChevronDown size={12} class="pointer-events-none absolute right-0.5 top-1/2 -translate-y-1/2 text-text-muted" aria-hidden="true" />
            </div>
        {/if}
        <button type="button" onclick={onInsertBelow} aria-label="在下方插入{noun}" title="在下方插入{noun}" class="{iconButton} ml-auto">
            <Plus size={16} aria-hidden="true" />
        </button>
        <button type="button" onclick={onRemove} aria-label="刪除這個{noun}" title="刪除這個{noun}" class="{iconButton} hover:text-danger">
            <Trash2 size={16} aria-hidden="true" />
        </button>
    </div>

    <div class="flex flex-wrap justify-between items-center gap-y-1 mb-1">
        {#if dayDate}
            <div role="group" aria-label="時間寫法" class="flex -ml-0.5">
                {#each TIME_MODES as [mode, label] (mode)}
                    <button
                        type="button"
                        aria-pressed={timeModeOf(entry) === mode}
                        onclick={() => setTimeMode(entry, mode, dayDate)}
                        class="min-h-[44px] px-0.5 flex items-center cursor-pointer"
                    >
                        <span class="px-2 py-1 rounded-md text-[11px] font-bold transition {timeModeOf(entry) === mode ? 'bg-accent/15 text-accent' : 'text-text-muted hover:text-text-secondary'}">{label}</span>
                    </button>
                {/each}
            </div>
        {:else}
            <span class="text-[11px] font-bold text-text-muted">住宿</span>
        {/if}
        <!-- value + onchange, not bind:value: Svelte reads a bound select back through
             `:checked`, which happy-dom does not match on an option. appearance-none
             because WebKit ignores a native select's min-height, so the chevron is drawn. -->
        <div class="relative -mr-1">
            <select
                aria-label="類型"
                value={entry.type ?? "standard"}
                onchange={e => setType(e.currentTarget.value)}
                class="appearance-none min-h-[44px] pl-2 pr-5 bg-transparent text-[11px] font-bold text-text-secondary outline-none cursor-pointer"
            >
                {#each TYPES as [value, label] (value)}
                    <option {value}>{label}</option>
                {/each}
            </select>
            <ChevronDown size={12} class="pointer-events-none absolute right-0.5 top-1/2 -translate-y-1/2 text-text-muted" aria-hidden="true" />
        </div>
    </div>

    {#if dayDate}
        <div class="flex items-center gap-1.5 mb-1">
            {#if timeModeOf(entry) === "text"}
                <input aria-label="時間" bind:value={() => entry.time ?? "", v => setText(entry, "time", v)} autocomplete="off" placeholder="例如 14:00 - 15:30" class="{chipField} w-44" />
            {:else}
                <input type="time" aria-label="開始" bind:value={() => clockOf(entry.start), v => setStartClock(entry, v, dayDate)} class={chipField} />
                <span class="text-xs text-text-muted" aria-hidden="true">–</span>
                <input type="time" aria-label="結束" bind:value={() => clockOf(entry.end), v => setEndClock(entry, v)} class={chipField} />
            {/if}
        </div>
    {:else}
        {#each STAY as [key, label] (key)}
            <div class="flex items-center gap-1.5 mb-1">
                <span class={rowLabel}>{label}</span>
                <input type="date" aria-label="{label}日期" bind:value={() => dateOf(entry[key]), v => (entry[key] = withDate(entry[key] ?? "", v))} class={chipField} />
                <input type="time" aria-label="{label}時間" bind:value={() => clockOf(entry[key]), v => (entry[key] = withClock(entry[key] ?? "", v))} class={chipField} />
            </div>
        {/each}
    {/if}

    <input aria-label="標題" bind:value={entry.title} autocomplete="off" placeholder={dayDate ? "標題" : "飯店名稱"} class="{field} block w-full mb-1.5 min-h-[44px] text-[15px] font-bold text-text-primary" />
    <textarea
        aria-label="說明"
        bind:value={() => entry.desc ?? "", v => setText(entry, "desc", v)}
        rows="1"
        placeholder="新增說明…"
        {@attach autosize}
        class="{field} block w-full min-h-[44px] py-3 resize-none overflow-hidden text-xs text-text-secondary leading-relaxed"
    ></textarea>

    <div class="mt-1.5">
        {@render textRow("地址", "address", "當地語言，放大給司機看")}
        {#if showLocalName}
            {@render textRow("當地名稱", "localName", "地圖搜尋用的當地語言名稱")}
        {/if}
        {#if showMapLink}
            {@render textRow("地圖連結", "mapLink", "maps.app.goo.gl 或 naver.me 短網址")}
        {/if}
    </div>

    {#if entry.bullets?.length}
        {@render section("條列")}
        <!-- Keyed by position: bullets are bare strings, two may read the same, and nothing else tells them apart. -->
        {#each entry.bullets as bullet, i (i)}
            <div class="flex items-center gap-1">
                <span class="text-text-muted text-xs" aria-hidden="true">•</span>
                <input
                    aria-label="條列"
                    bind:value={() => bullet, v => entry.bullets && (entry.bullets[i] = v)}
                    autocomplete="off"
                    class="{field} flex-1 min-w-0 min-h-[44px] text-xs text-text-secondary"
                />
                {@render removeButton("刪除這一條", () => entry.bullets?.splice(i, 1))}
            </div>
        {/each}
    {/if}

    {#if entry.stops?.length}
        {@render section("地點")}
        {#each entry.stops as stop, i (stop)}
            <div class="flex items-start gap-1 py-1 border-b border-line last:border-b-0">
                <div class="flex-1 min-w-0">
                    <label class="flex items-center gap-2"><span class={subLabel}>名稱</span><input aria-label="地點名稱" bind:value={stop.name} autocomplete="off" placeholder="例如 特雷維噴泉" class="{field} flex-1 min-w-0 min-h-[44px] text-xs text-text-primary" /></label>
                    <label class="flex items-center gap-2"><span class={subLabel}>當地名稱</span><input aria-label="地點當地名稱" bind:value={() => stop.localName ?? "", v => setText(stop, "localName", v)} autocomplete="off" placeholder="地圖搜尋用" class="{field} flex-1 min-w-0 min-h-[44px] text-xs text-text-secondary" /></label>
                    <label class="flex items-center gap-2"><span class={subLabel}>地圖連結</span><input aria-label="地點地圖連結" bind:value={() => stop.mapLink ?? "", v => setText(stop, "mapLink", v)} autocomplete="off" inputmode="url" placeholder="短網址" class="{field} flex-1 min-w-0 min-h-[44px] text-xs text-text-secondary" /></label>
                </div>
                {@render removeButton("刪除這個地點", () => entry.stops?.splice(i, 1))}
            </div>
        {/each}
    {/if}

    {#if entry.links?.length}
        {@render section("連結")}
        {#each entry.links as link, i (link)}
            <div class="flex items-start gap-1 py-1 border-b border-line last:border-b-0">
                <div class="flex-1 min-w-0">
                    <label class="flex items-center gap-2"><span class={subLabel}>文字</span><input aria-label="連結文字" bind:value={link.label} autocomplete="off" placeholder="例如 官網" class="{field} flex-1 min-w-0 min-h-[44px] text-xs text-text-primary" /></label>
                    <label class="flex items-center gap-2"><span class={subLabel}>網址</span><input aria-label="連結網址" bind:value={link.url} autocomplete="off" inputmode="url" placeholder="https://…" class="{field} flex-1 min-w-0 min-h-[44px] text-xs text-text-secondary" /></label>
                </div>
                {@render removeButton("刪除這個連結", () => entry.links?.splice(i, 1))}
            </div>
        {/each}
    {/if}

    {#if entry.alternatives?.length}
        {@render section("備案地點")}
        {#each entry.alternatives as alt, i (alt)}
            <div class="flex items-start gap-1 py-1 border-b border-line last:border-b-0">
                <div class="flex-1 min-w-0">
                    <label class="flex items-center gap-2"><span class={subLabel}>名稱</span><input aria-label="備案名稱" bind:value={alt.title} autocomplete="off" placeholder="例如 中央市場" class="{field} flex-1 min-w-0 min-h-[44px] text-xs text-text-primary" /></label>
                    <label class="flex items-center gap-2"><span class={subLabel}>當地名稱</span><input aria-label="備案當地名稱" bind:value={() => alt.localName ?? "", v => setText(alt, "localName", v)} autocomplete="off" placeholder="地圖搜尋用" class="{field} flex-1 min-w-0 min-h-[44px] text-xs text-text-secondary" /></label>
                    <label class="flex items-center gap-2"><span class={subLabel}>地圖連結</span><input aria-label="備案地圖連結" bind:value={() => alt.mapLink ?? "", v => setText(alt, "mapLink", v)} autocomplete="off" inputmode="url" placeholder="短網址" class="{field} flex-1 min-w-0 min-h-[44px] text-xs text-text-secondary" /></label>
                    <label class="flex items-center gap-2"><span class={subLabel}>備註</span><input aria-label="備案備註" bind:value={() => alt.note ?? "", v => setText(alt, "note", v)} autocomplete="off" placeholder="例如 排隊超過 30 分鐘就換" class="{field} flex-1 min-w-0 min-h-[44px] text-xs text-text-secondary" /></label>
                </div>
                {@render removeButton("刪除這個備案", () => entry.alternatives?.splice(i, 1))}
            </div>
        {/each}
    {/if}

    {#if entry.attachments?.length}
        {@render section("附件")}
        {#each entry.attachments as attachment, i (attachment)}
            <div class="flex items-center gap-1">
                <input aria-label="附件名稱" bind:value={attachment.label} autocomplete="off" class="{field} flex-1 min-w-0 min-h-[44px] text-xs text-text-secondary" />
                {@render removeButton("刪除這個附件", () => entry.attachments?.splice(i, 1))}
            </div>
        {/each}
    {/if}

    {#if error}
        <p role="alert" class="mt-2 flex items-start gap-1.5 text-xs text-danger">
            <TriangleAlert size={13} class="shrink-0 mt-0.5" aria-hidden="true" />{error}
        </p>
    {/if}

    <div class="flex flex-wrap gap-1.5 mt-3">
        {#if adding}
            {#if !showLocalName}
                <button type="button" onclick={() => addField(() => opened.push("localName"))} class={chip}><Plus size={12} aria-hidden="true" />當地名稱</button>
            {/if}
            {#if !showMapLink}
                <button type="button" onclick={() => addField(() => opened.push("mapLink"))} class={chip}><Plus size={12} aria-hidden="true" />地圖連結</button>
            {/if}
            <button type="button" onclick={() => addField(() => addTo("bullets", ""))} class={chip}><Plus size={12} aria-hidden="true" />條列</button>
            <button type="button" onclick={() => addField(() => addTo("stops", { name: "" }))} class={chip}><Plus size={12} aria-hidden="true" />地點</button>
            <button type="button" onclick={() => addField(() => addTo("links", { label: "", url: "" }))} class={chip}><Plus size={12} aria-hidden="true" />連結</button>
            <button type="button" onclick={() => addField(() => addTo("alternatives", { title: "" }))} class={chip}><Plus size={12} aria-hidden="true" />備案地點</button>
        {:else}
            <button type="button" onclick={() => (adding = true)} class={chip}><Plus size={12} aria-hidden="true" />新增欄位</button>
        {/if}
        <!-- Beside 新增欄位 rather than behind it: it stays put through the upload, and a ticket is the field most often added. -->
        <AttachmentUpload date={dayDate ?? dateOf(entry.start)} onUploaded={attachment => addTo("attachments", attachment)} class={chip} />
    </div>
</div>
