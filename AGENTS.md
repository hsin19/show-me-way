# AGENTS.md

This repository is a Svelte 5 travel itinerary PWA. Agents should treat local skills as the primary workflow layer and use Svelte MCP CLI commands only when a skill or task calls for them.

## Project Overview

- App: ShowMeWay, a YAML-driven travel itinerary helper PWA.
- Stack: Svelte 5 runes, TypeScript, Vite, Tailwind CSS v4, `vite-plugin-pwa`, `js-yaml`, Vitest.
- Package manager: `pnpm`.
- Mount entry: `src/main.ts` mounts the root component `src/App.svelte`.
- Shared logic in `src/lib/`: `api.ts` (YAML load/save/validate), `utils.ts` (date/map helpers, incl. `insertAtClamped` for delete-undo reinsertion), `exchange.ts` (exchange-rate cache), `weather.ts` (Open-Meteo daily forecast cache), `storage-cache.ts` (leaf cache helpers shared by exchange/weather: `readCachedJson`/`writeCachedJson`/`isFresh` — mem-mirror + quota-guarded write + clock-rollback-aware TTL), `share.ts` (compressed share links), `phrases.ts` (built-in phrase sets), `ledger.ts` (Ledger pure math: quick-amount rounding ladder, Deposit-prefix totals/wallet balances, currency config, conversion rounding; plus `parseLegacyExpenses` migration coercion), `wakelock.ts` (screen wake lock while driver-facing overlays are open; silently no-ops where unsupported, e.g. iOS standalone PWAs before 18.4), `toast.svelte.ts` (app-global toast + clipboard service: module-level rune store exporting the `toast` read-only view + `showToast`/`runToastAction`/`copyToClipboard` — components call it directly, so there is no `onToast`/`onCopy` prop threading), `gemini.ts` (AI itinerary chat: Gemini API key + model storage helpers, a `listGeminiModels` that fetches the key's chat-capable models for the picker, and a `fetch`-based `sendChatMessage` over Google's Interactions API (`POST /v1beta/interactions`, `x-goog-api-key` header, stateless `store:false`) that grounds the chosen model on the serialized itinerary YAML; unlike the caches it throws on failure so the UI can report it).
- Components in `src/lib/components/`: `Timeline.svelte` (day event list), `TripOverview.svelte` (day-0 panel, pure trip content: hero with the 分享行程 CTA — the trip-level counterpart of Timeline's 分享今日行程 — phase-aware helper card: pre-trip prep progress / tonight's hotel / post-trip spend summary, day list, and hotels; management actions live on the 行程管理 page instead), `DaySwitcher.svelte` (day navigation), `TabPager.svelte` (shared sticky-chip header + one-panel pager: directional slide transition, swipe/wheel paging, `[data-swipe-ignore]` opt-out for horizontally scrolling children — the layout under BOTH ItineraryStrip and ToolsTab), `ToolsTab.svelte` (the 工具 tab: sticky sub-tab chips 準備/記帳/常用語/行程管理 rendering snippet pages; without a loaded trip only 行程管理 stays available), `Checklist.svelte` (packing/todo lists, on the 準備 page), `Ledger.svelte` (expense tracking with exchange rate incl. the CSV export entry, on the 記帳 page), `PhraseDeck.svelte` (survival-phrase deck, on the 常用語 page), `SettingsPanel.svelte` (the 行程管理 page: trip-profile switcher + YAML editor + backups + export — a page, NOT a modal; unsaved edits survive tab switches via `src/lib/settings-draft.svelte.ts`, save/restore/reset/switch navigate back to 行程), `HotelCards.svelte` (hotel/driver cards with the 當前入住 highlight, rendered on the overview), `WeatherBadge.svelte` (daily weather badge), `ChatPanel.svelte` (AI itinerary chat tab; prompts for the Gemini key on first use and keeps the conversation in memory only); brand map icons live in `src/lib/components/icons/`. The bottom nav has exactly three tabs — 行程/工具/AI; the overview's phase card deep-links into 工具 sub-pages (準備/記帳). Tools never open as sheets/modals — the only remaining overlays are `EnlargedCardOverlay`, `UpdatePrompt`, and `Toast`.
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

Other `localStorage` keys exist outside the itinerary YAML: `exchange_rate_<currency>` (manual rate, `Ledger`), `showmeway_exchange_rates_<base>` (rate cache in `src/lib/exchange.ts`), `showmeway_yaml_backups` (auto-snapshots of the user YAML taken before each destructive overwrite — newest first, max 5; see `backupCurrentYaml` in `src/lib/api.ts`), `showmeway_geocode_v1_<city>` / `showmeway_weather_<city>` (weather cache in `src/lib/weather.ts`; geocode entries carry a 30-day TTL — no longer permanent — and forecasts a 3h TTL), and `showmeway_gemini_api_key` / `showmeway_gemini_model` (the user's own Gemini API key and the chat model they picked from the dynamically fetched list; managed solely by `src/lib/gemini.ts` / `ChatPanel.svelte`, never written into the itinerary YAML and not carried with a profile). Checklist checked-state AND ledger expense records (`TripData.expenses`) live inside the itinerary YAML itself; the legacy `todo_state` / `packing_state` / `ledger_expenses` keys are migrated once into the YAML and removed by `App.svelte` — do not reintroduce them.

## Svelte And UI Guidelines

- Use Svelte 5 runes for new component code: `$state`, `$derived`, `$derived.by`, `$effect` only when appropriate.
- Prefer event attributes such as `onclick` over legacy `on:click`.
- Use keyed `{#each}` blocks with stable keys. Do not use indexes as keys when item identity exists.
- Keep component state local unless there is a concrete need to share it.
- Use `@lucide/svelte` icons for interface actions when an icon exists.
- Keep mobile ergonomics in mind; this app is meant to be installed and used on a phone while traveling.
- Avoid introducing large visual redesigns while making functional changes unless explicitly requested.

## Design Tokens And Color

All color lives in the `@theme` block of `src/app.css`, where each token carries a comment on its role. Components must contain **zero** literal colors — no hex, no raw Tailwind palette (`slate-700`), and no `white/N` / `black/N`. A light theme is planned, and `bg-white/5` hardcodes "lighter = add white", which inverts on a light background.

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
- Playwright e2e smoke lives in `e2e/tests/` (config `playwright.config.ts`): it tests the built app via `vite preview`, hermetically — `fixtures.ts` aborts every non-localhost request, service workers are blocked (`serviceWorkers: "block"`, otherwise the PWA SW bypasses `page.route`), and tests seed `showmeway_user_yaml` with a far-future fixture (no `city`/`currency`, so weather/exchange never fire). The seed init-script only writes when the key is absent — it re-runs on `page.reload()`, and an unconditional write would wipe state the app just persisted. UI assertions use exact zh-TW strings incl. fullwidth punctuation (`｜`, `—`). Changing user-visible copy may require updating `e2e/tests/smoke.spec.ts`.

## Git And Generated Files

- Do not edit `dist/` for source changes.
- Do not commit personal itinerary data in `public/itinerary.local.yaml`.
- Avoid rewriting lockfiles unless dependencies or tool setup actually changed.
- Preserve unrelated user changes in the working tree.
- A `simple-git-hooks` pre-commit hook runs `lint-staged` (dprint on all staged files, `eslint --fix` on `*.{js,ts,svelte}`). Expect staged files to be reformatted on commit.
