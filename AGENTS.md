# AGENTS.md

This repository is a Svelte 5 travel itinerary PWA. Agents should treat local skills as the primary workflow layer and use Svelte MCP CLI commands only when a skill or task calls for them.

## Project Overview

- App: ShowMeWay, a YAML-driven travel itinerary helper PWA.
- Stack: Svelte 5 runes, TypeScript, Vite, Tailwind CSS v4, `vite-plugin-pwa`, `js-yaml`, Vitest.
- Package manager: `pnpm`.
- Mount entry: `src/main.ts` mounts the root component `src/App.svelte`.
- Shared logic in `src/lib/`: `api.ts` (YAML load/save/validate), `utils.ts` (date/map helpers, incl. `insertAtClamped` for delete-undo reinsertion and `prefersReducedMotion` — the one place components ask about reduced motion, since app.css's media query cannot reach Svelte's JS transitions or programmatic smooth scrolling), `exchange.ts` (exchange-rate cache), `weather.ts` (Open-Meteo daily forecast cache), `storage-cache.ts` (leaf cache helpers shared by exchange/weather: `readCachedJson`/`writeCachedJson`/`isFresh` — mem-mirror + quota-guarded write + clock-rollback-aware TTL — plus `cachedKeysWithPrefix`/`removeCachedKeys`, which each cache owner uses to enumerate and drop its own entries without hand-rolling the localStorage index loop), `storage-admin.ts` (what the 本機儲存 section of App 設定 runs on. Composes the _other_ direction from `storage-cache.ts`: it asks each owner which keys it currently occupies (`weatherCacheKeys`/`exchangeCacheKeys`/`yamlBackupKeys`) and delegates removal back to it (`clearWeatherCache`/`clearExchangeCache`/`clearYamlBackups`), so no key string is restated here. Sizes in UTF-16 code units, because that is how browsers bill the quota. Its hard reset sweeps the `showmeway_` prefix plus Ledger's `exchange_rate_` keys and the legacy ones — **never `localStorage.clear()`**: the deployed site is a GitHub Pages project site, so the origin is shared with every other project on the account), `share.ts` (compressed share links), `edge-fade.ts` (the `edgeFade` Svelte attachment behind `.edge-fade`: sets `--fade-start`/`--fade-end` so only an end with content past it fades, re-checking on scroll and on a ResizeObserver over both the scrollport and its content. Every horizontally scrolling row uses it — TabPager's chip header and PhraseDeck's category filter — so they fade identically), `phrases.ts` (built-in phrase sets), `ledger.ts` (Ledger pure math: quick-amount rounding ladder, Deposit-prefix totals/wallet balances, currency config, conversion rounding; plus `parseLegacyExpenses` migration coercion), `wakelock.ts` (screen wake lock while driver-facing overlays are open; silently no-ops where unsupported, e.g. iOS standalone PWAs before 18.4), `toast.svelte.ts` (app-global toast + clipboard service: module-level rune store exporting the `toast` read-only view + `showToast`/`runToastAction`/`copyToClipboard` — components call it directly, so there is no `onToast`/`onCopy` prop threading. Several toasts coexist: `toast.items` is oldest-first, each carries its own expiry timer so a later notice cannot cut an undo window short on the clock, and the stack caps at 3 by dropping the oldest — so an undo CAN still be crowded out by three later notices. `runToastAction`/`dismissToast` take the toast's id. `persist: true` opts out of expiry and out of the cap, and gets a ✕ — the PWA update notice uses it, which is why there is no UpdatePrompt component any more; it pairs it with `dedupeKey: "sw-update"`, because `onNeedRefresh` fires once per newly waiting service worker and two deploys in one session would otherwise leave two immortal notices stacked. `onDismiss` fires only on an actual end-of-life — ✕, expiry, cap eviction — never when the action button runs and never when a same-`dedupeKey` toast replaces it; both of those go through the private `removeToast`, and the install prompt's cool-off depends on that distinction), `pwa-install.svelte.ts` (the "you can install this" offer: captures `beforeinstallprompt` into `$state` — hence `.svelte.ts`, so App 設定's install button can appear the moment the event lands, and disappear once the event is spent — plus iOS/standalone detection and one `download` toast raised 3.5s after boot. That timer is the path for every browser that never fires the event (iOS Safari, Firefox, plain HTTP); on Chromium the event handler asks first and a `toastShown` flag stops the timer re-asking. Deliberately NOT gated on the user having a trip: an installed iOS PWA gets its own storage partition, so prompting after they have data would leave two copies to reconcile. Declining or ignoring it writes a 7-day cool-off key), `gemini.ts` (AI itinerary chat: Gemini API key + model storage helpers, a `listGeminiModels` that fetches the key's chat-capable models for the picker, and a `fetch`-based `sendChatMessage` over Google's Interactions API (`POST /v1beta/interactions`, `x-goog-api-key` header, stateless `store:false`) that grounds the chosen model on the serialized itinerary YAML; unlike the caches it throws on failure so the UI can report it. `pickDefaultModel` is the one place that decides which model a user with no stored preference gets: never `list[0]`, because the descending id sort puts every `gemma-*` ahead of every `gemini-*` and compares size suffixes as strings, so `-9b` beats `-31b`), `gemini-models.svelte.ts` (`createModelPicker`, the rune-backed fetch/select/persist state behind BOTH the App 設定 model picker and ChatPanel's header select — they share one `showmeway_gemini_model` key, so whichever screen the user opens first writes the default and the decision cannot live in two places; exposes `list`/`loading`/`error`/bindable `selected`/`activeModel`/`retry()`/`reset()`).
- Components in `src/lib/components/`: `Timeline.svelte` (day event list), `TripOverview.svelte` (day-0 panel, pure trip content: hero with the 分享行程 CTA — the trip-level counterpart of Timeline's 分享今日行程 — phase-aware helper card: pre-trip prep progress / tonight's hotel / post-trip spend summary, day list, and hotels; management actions live on the 行程管理 page instead), `DayChip.svelte` (one chip in the day strip: the pinned 總覽 variant plus a day variant with the 今天 marker — the row itself belongs to TabPager), `TabPager.svelte` (shared chip header + one-panel pager, the layout under BOTH ItineraryStrip and ToolsTab: `keys` drives the chip row AND the panel order so they cannot drift; owns the row layout, horizontal scrolling, keeping the current chip in view, the `.edge-fade` mask, the directional slide transition and swipe/wheel paging, plus `[data-swipe-ignore]` opt-out. `pinnedCount` renders a leading run of chips outside the scroller — used for the itinerary's 總覽 chip — and callers supply only per-chip content via the `chip` snippet), `ToolsTab.svelte` (the 工具 tab: sub-tab pages 準備/記帳/常用語/行程管理/App 設定 as snippets — the chip row itself is TabPager's, ToolsTab only supplies each chip's button; without a loaded trip only 行程管理 and App 設定 stay available), `Checklist.svelte` (packing/todo lists, on the 準備 page), `Ledger.svelte` (expense tracking with exchange rate incl. the CSV export entry, on the 記帳 page), `PhraseDeck.svelte` (survival-phrase deck, on the 常用語 page; its category filter row is the same scrolling/fading chip row as TabPager's header), `SettingsPanel.svelte` (the 行程管理 page: trip-profile switcher + YAML editor + backups + export — a page, NOT a modal; unsaved edits survive tab switches via `src/lib/settings-draft.svelte.ts`, save/restore/reset/switch navigate back to 行程), `AppSettings.svelte` (the App 設定 page: app-level preferences — the light/dark/system theme picker, the AI 助手設定 section (the sole entry point for the Gemini API key, plus the model picker and its `default`/`all` filter scope — listing the models doubles as key validation, because the Gemini API has no separate verify endpoint, so the rejection is rendered instead of swallowed and the badge reports what that call said rather than merely that a key is stored), the 本機儲存 section on top of `storage-admin.ts` (per-category usage + clear, and the scoped hard reset), and 關於 App with the build version from `version.ts`. Distinct from 行程管理, which is trip-level; nothing here travels with a profile. Two rules the layout encodes: anything irreversible (clearing the backup ring, the hard reset) goes through an inline confirm bar rather than firing on the first tap, and the PWA's CacheStorage is deliberately NOT manageable here — deleting the precache breaks offline launch without refilling itself, and the update path already belongs to the persistent `sw-update` toast), `HotelCards.svelte` (hotel/driver cards with the 當前入住 highlight, rendered on the overview), `WeatherBadge.svelte` (daily weather badge), `ChatPanel.svelte` (AI itinerary chat tab; keeps the conversation in memory only — and only while mounted, since leaving the tab unmounts it. It never takes the Gemini key itself: without one it shows an empty state pointing at App 設定, and with one the header's gear links to the same place, both via the `onOpenAppSettings` prop. A failed model listing replaces the whole tab with a blocking error state carrying 前往 App 設定 + 重試, rather than a banner over a live composer: that call is the only key validation there is (same reasoning as App 設定's badge — neither screen may swallow it) and it hits the same host as the chat, so if it failed, sending would fail too), `Toast.svelte` (the toast stack — see `toast.svelte.ts`; also carries the PWA update notice, so there is no separate update banner component); brand map icons live in `src/lib/components/icons/`. The bottom nav has exactly three tabs — 行程/工具/AI; the overview's phase card deep-links into 工具 sub-pages (準備/記帳). Tools never open as sheets/modals — the only remaining overlays are `EnlargedCardOverlay` and `Toast`.
- User-facing language is primarily Traditional Chinese. Keep UI copy and validation errors consistent with that tone.

## Skills-First Svelte Workflow

When creating, editing, or analyzing `.svelte`, `.svelte.ts`, or `.svelte.js` files, use the local Svelte skills first:

- `.agents/skills/svelte-code-writer`
- `.agents/skills/svelte-core-bestpractices`

These skills define the preferred Svelte 5 workflow. Before finalizing Svelte component edits, run the project checks listed below.

## Commands

- Install dependencies: `pnpm install`
- Start dev server: `pnpm dev`
- Format: `pnpm run format`
- Check formatting only: `pnpm run format:check`
- Lint: `pnpm run lint`
- Typecheck: `pnpm run typecheck`
- Test: `pnpm run test`
- E2E tests: `pnpm run test:e2e` (Playwright smoke; builds and serves dist via `vite preview` on port 8046)
- Build: `pnpm run build`
- Full verification: `pnpm run check`

`pnpm run check` runs format, lint, typecheck, tests, and build (e2e is not included — run it separately; CI runs it as its own job). Prefer it before handing off broader changes. For narrow changes, run the smallest relevant command first and report anything not run.

## Data Model

Itinerary data is YAML. Loading priority:

1. User YAML saved in `localStorage` under `showmeway_user_yaml`.
2. `public/itinerary.local.yaml` for personal local data. This should remain untracked.
3. `public/itinerary.yaml` as the default template.

The schema lives at `public/showmeway-schema.json` (served with the site so the modeline `$schema` URL resolves). Keep TypeScript interfaces in `src/lib/api.ts`, schema fields, and example YAML aligned when changing itinerary structure.

`serializeToYaml` strips runtime-only `_id` values (timeline events, checklist items, and expense records, plus any legacy `id`) and re-adds the YAML schema modeline. Do not persist `_id` into YAML fixtures or exports.

Trip profiles (multiple trips): the active trip stays in `showmeway_user_yaml`; the other trips are parked as YAML snapshots in `showmeway_profiles`, with `showmeway_active_profile` holding the active id (see the profile helpers in `src/lib/api.ts`). Switching swaps the chosen snapshot with the active one — a separate, user-managed list (never auto-evicted, unlike the backup ring). The switcher UI lives at the top of the 行程管理 page (`SettingsPanel`); switching navigates back to the 行程 tab. Only the itinerary YAML travels with a profile.

Other `localStorage` keys exist outside the itinerary YAML: `exchange_rate_<currency>` (manual rate, `Ledger`), `showmeway_exchange_rates_<base>` (rate cache in `src/lib/exchange.ts`), `showmeway_yaml_backups` (auto-snapshots of the user YAML taken before each destructive overwrite — newest first, max 5; see `backupCurrentYaml` in `src/lib/api.ts`), `showmeway_geocode_v1_<city>` / `showmeway_weather_<city>` (weather cache in `src/lib/weather.ts`; geocode entries carry a 30-day TTL — no longer permanent — and forecasts a 3h TTL), `showmeway_gemini_api_key` / `showmeway_gemini_model` / `showmeway_gemini_model_filter` (the user's own Gemini API key, the chat model they picked from the dynamically fetched list, and whether that list is filtered to clean release names or left unfiltered — `default` / `all`, absent means `default`; managed by `src/lib/gemini.ts` / `AppSettings.svelte` / `ChatPanel.svelte`, never written into the itinerary YAML and not carried with a profile), `showmeway_theme` (light/dark preference, `src/lib/theme.svelte.ts` — app-level, so it is absent until the user picks one and never travels with a profile), and `showmeway_pwa_install_dismissed` (a timestamp; `src/lib/pwa-install.svelte.ts` stops re-raising the install offer for 7 days after it. Absent until the offer is first declined or ignored, and app-level — an install is a property of the device, not of a trip. `e2e/tests/fixtures.ts` pre-stamps it so the 3.5s toast never lands mid-test). Checklist checked-state AND ledger expense records (`TripData.expenses`) live inside the itinerary YAML itself; the legacy `todo_state` / `packing_state` / `ledger_expenses` keys are migrated once into the YAML and removed by `App.svelte` — do not reintroduce them.

Each of those keys is declared exactly once, in the module that owns it (`YAML_BACKUPS_KEY` in `api.ts`, `MANUAL_RATE_KEY_PREFIX` in `ledger.ts`, `GEMINI_*_STORAGE` in `gemini.ts`, `THEME_KEY` in `theme.svelte.ts`, the cache prefixes privately inside `weather.ts` / `exchange.ts`). Code that needs to enumerate or clear someone else's keys asks that module for a `*Keys()` / `clear*()` function instead of restating the string — see `storage-admin.ts`.

## Svelte And UI Guidelines

- Use Svelte 5 runes for new component code: `$state`, `$derived`, `$derived.by`, `$effect` only when appropriate.
- Prefer event attributes such as `onclick` over legacy `on:click`.
- Use keyed `{#each}` blocks with stable keys. Do not use indexes as keys when item identity exists.
- Keep component state local unless there is a concrete need to share it.
- Use `@lucide/svelte` icons for interface actions when an icon exists.
- Keep mobile ergonomics in mind; this app is meant to be installed and used on a phone while traveling.
- Avoid introducing large visual redesigns while making functional changes unless explicitly requested.

## Design Tokens And Color

All color lives in the `@theme` block of `src/app.css`, where each token carries a comment on its role. Components must contain **zero** literal colors — no hex, no raw Tailwind palette (`slate-700`), and no `white/N` / `black/N`. The app ships both a dark and a light theme, and `bg-white/5` would hardcode "lighter = add white", which inverts on a light background.

`data-theme` on `<html>` is the only switch: `app.css` overrides the tokens under `:root[data-theme="light"]` (un-layered, so it outranks Tailwind's `@layer theme`). `src/lib/theme.svelte.ts` owns the preference (`system` / `dark` / `light`, default `system`) and keeps every `theme-color` meta in step; an inline classic script in `index.html` resolves the same thing before first paint, because a module script would flash the wrong theme. **Those two copies of the resolution logic must stay in sync** — `e2e/tests/theme.spec.ts` is what catches it if they drift.

Opacity modifiers on tokens are fine (`bg-accent/15`, `hover:border-positive/50`): they `color-mix` a `var(--color-*)`, so they still flip with the theme. Only `white`/`black` literals are banned.

Besides the semantic colors (`accent`, `booked`/`must`/`option`, `positive`/`danger`, `bg-main`, `card-bg`, `text-*`) there are translucent ramps for surfaces stacked on other surfaces: `tint-1/2/3` (lift), `line-faint`/`line`/`line-raised`/`line-emphasis` (edges), `well`/`well-deep` (recess), plus `scrim`, `lift`, and `.panel`'s `--panel-shadow`.

Changing `bg-main` also means updating `<meta name="theme-color">` in `index.html`, the manifest colors in `vite.config.ts`, and `:root`'s `color-scheme`.

## Formatting And Style

- Formatting is handled by dprint with 4-space indentation for TypeScript/Svelte-related files and 2-space indentation for YAML/JSON.
- TypeScript uses double quotes and semicolons.
- YAML prefers single quotes.
- Keep comments sparse and useful. Existing comments often explain date/time or YAML persistence behavior; preserve that clarity.

## Testing Notes

- Pure date/time helpers belong in `src/lib/utils.ts` and should have Vitest coverage in `src/lib/utils.test.ts`.
- Ledger pure calculations belong in `src/lib/ledger.ts` (covered by `src/lib/ledger.test.ts`); `Ledger.svelte` is a controlled component — expense records come in as the `expenses` prop (owned by `App.svelte`, persisted in the itinerary YAML) and add/delete/reset go back through callbacks. It keeps only its own input `$state` plus the manual exchange-rate localStorage, and wraps the pure functions in `$derived`.
- Be careful with `YYYY-MM-DD` parsing. This project intentionally parses plain dates in local time to avoid UTC day shifts.
- When changing PWA, Vite, or asset behavior, verify with `pnpm run build`.
- Playwright e2e smoke lives in `e2e/tests/` (config `playwright.config.ts`): it tests the built app via `vite preview`, hermetically — `fixtures.ts` aborts every non-localhost request, service workers are blocked (`serviceWorkers: "block"`, otherwise the PWA SW bypasses `page.route`), and tests seed `showmeway_user_yaml` with a far-future fixture (no `city`/`currency`, so weather/exchange never fire). The seed init-script only writes when the key is absent — it re-runs on `page.reload()`, and an unconditional write would wipe state the app just persisted. UI assertions use exact zh-TW strings incl. fullwidth punctuation (`｜`, `—`). Changing user-visible copy may require updating `e2e/tests/smoke.spec.ts`. One suite deliberately depends on the real clock: `today.spec.ts` builds its trip around today's Asia/Taipei date (matching `timezoneId`) because `syncToToday` can only be exercised when a day actually is today — the far-future fixture leaves that path uncovered. Its day offsets are applied to that calendar date through UTC, never with `setDate`, or a runner whose own zone observes DST would collapse two days onto one Taipei date. It still uses the same network-blocking fixture, so only the dates are non-hermetic. Tests reach TabPager's chip row through `[data-pager-scroller]`, not through Tailwind class names.

## Git And Generated Files

- Do not edit `dist/` for source changes.
- Do not commit personal itinerary data in `public/itinerary.local.yaml`.
- Avoid rewriting lockfiles unless dependencies or tool setup actually changed.
- Preserve unrelated user changes in the working tree.
- A `simple-git-hooks` pre-commit hook runs `lint-staged` (dprint on all staged files, `eslint --fix` on `*.{js,ts,svelte}`). Expect staged files to be reformatted on commit.
