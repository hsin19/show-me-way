# AGENTS.md

This repository is a Svelte 5 travel itinerary PWA. Agents should treat local skills as the primary workflow layer and use Svelte MCP CLI commands only when a skill or task calls for them.

## Project Overview

- App: ShowMeWay, a YAML-driven travel itinerary helper PWA.
- Stack: Svelte 5 runes, TypeScript, Vite, Tailwind CSS v4, `vite-plugin-pwa`, `js-yaml`, Vitest.
- Package manager: `pnpm`.
- Mount entry: `src/main.ts` mounts the root component `src/App.svelte`.
- User-facing language is primarily Traditional Chinese. Keep UI copy and validation errors consistent with that tone.

### Key Modules (`src/lib/`)

- `api.ts` / `api-fetch.ts`: YAML load/save/validate/serialize logic, trip backups, and schema normalization.
- `profiles.ts`: Multiple trip profile management (active profile in `showmeway_user_yaml`, parked profiles in `showmeway_profiles`).
- `utils.ts`: Date/time calculation, map link generation, timeline event classification, `insertAtClamped`, and motion preference helpers.
- `gdrive.ts` / `gdrive.svelte.ts`: Google Drive sync via GIS token client and Drive API v3 (`drive.file` scope).
- `gemini.ts` / `gemini-models.svelte.ts`: Gemini AI chat & itinerary editing via Interactions API (`update_itinerary` function tool).
- `storage-cache.ts` / `storage-admin.ts`: Cache abstraction for weather/exchange rates, localStorage quota measurement, and scoped reset.
- `weather.ts` / `exchange.ts`: Open-Meteo weather forecast cache and exchange rate fetching/caching.
- `ledger.ts`: Currency conversion, deposit/wallet math, quick amount calculations, and CSV export logic.
- `share.ts`: Itinerary compression into URL fragments (`#s=`) using DEFLATE + Base64url.
- `markdown.ts` / `RichText.svelte`: AST-based safe inline Markdown parser and renderer (strictly no `{@html}`).
- `toast.svelte.ts` / `Toast.svelte`: App-global notification and undo service.
- `pwa-install.svelte.ts`: PWA installation prompt coordinator.
- `theme.svelte.ts`: Light / dark / system theme management.

### Key Components (`src/lib/components/`)

- `ItineraryStrip.svelte`: Composition root for the itinerary tab; manages day navigation and auto-scrolling to current events.
- `TripOverview.svelte`: Day 0 overview hero, phase helper card, hotel cards, and trip switcher drawer entry.
- `Timeline.svelte`: Daily timeline renderer (dynamically synthesizes checkout and overnight hotel nodes).
- `TabPager.svelte`: Shared horizontal chip pager with directional slide transitions and `.edge-fade` support.
- `ToolsTab.svelte`: Host for tool sub-tabs (Checklist, Ledger, PhraseDeck, SettingsPanel, AppSettings).
- `SettingsPanel.svelte`: Trip-level management (YAML editor, cloud backup/load, file export, backups).
- `AppSettings.svelte`: Global preferences (theme, Gemini API key, Google Drive connection, local storage usage).
- `EnlargedCardOverlay.svelte`: Fullscreen high-contrast card for taxi drivers or hotel/flight confirmation codes.
- `ChatPanel.svelte` / `DiffView.svelte`: AI assistant chat, diff inspection, and itinerary edit application.

## Core Invariants & Guardrails

1. **LocalStorage & Storage Scoping**:
   - Every localStorage key written by this app MUST start with `showmeway_` (or `exchange_rate_` for legacy Ledger).
   - **NEVER use `localStorage.clear()`**: ShowMeWay is deployed on GitHub Pages (`*.github.io`), sharing the origin with other user projects. Always use `storage-admin.ts` (`clearAppLocalStorage()`) for scoped deletion.
2. **Dynamic UI Nodes vs YAML Persistence**:
   - **Never author or persist「退房」or「回飯店休息」in YAML**: These timeline nodes are synthesized dynamically in `Timeline.svelte` from `trip.hotels`. Persisting them creates duplicate undeletable events.
   - `trip.start`, `trip.end`, `trip.departure`, and `days[].day` are **derived, never authored**. `normalizeTripData` calculates them automatically and `serializeToYaml` strips them upon saving.
3. **Privacy & URL Handling**:
   - Share links MUST place the compressed payload in the **URL fragment (`#s=...`)**, NEVER in query parameters (`?s=...`), so itinerary data is never transmitted to GitHub Pages CDN access logs.
4. **Security & Content Rendering**:
   - **Never use `{@html}` in `RichText.svelte`**: Shared itineraries come from external sources. All links and formatting must be parsed into an AST and validated via `sanitizeHref` / `sanitizeLinkHref` allowlists.
5. **AI Itinerary Updates**:
   - The AI assistant outputs the full updated YAML via `update_itinerary`. Updates must always pass `validateYaml` and manual user confirmation via `DiffView` before calling `applyAiEdit`.

## Skills-First Svelte Workflow

When creating, editing, or analyzing `.svelte`, `.svelte.ts`, or `.svelte.js` files, use the local Svelte skills first:

- `.agents/skills/svelte-code-writer`
- `.agents/skills/svelte-core-bestpractices`

These skills define the preferred Svelte 5 workflow. Before finalizing Svelte component edits, run the project checks listed below.

## Commands

- Install dependencies: `pnpm install`
- Start dev server: `pnpm dev` (fixed port 8045; `vite preview` is 8046 — both `strictPort` in `vite.config.ts`). `localStorage` is keyed by host:port, so a saved trip only exists on those origins. On `EADDRINUSE`, free the port instead of passing `--port`: on a fresh origin the app silently falls back to the bundled template and looks like it lost the user's data.
- Verify everything: `pnpm run check`
- E2E tests: `pnpm run test:e2e` — also run by `check`, and standalone when you want only this layer. The `webServer` builds and serves dist via `vite preview` on port 8046; `pnpm install` does not download browsers, so run `pnpm exec playwright install chromium` once per machine.

`pnpm run check` is the one to run. It chains format, knip, lint, typecheck, unit tests, build and e2e and names the step that failed, so there is no reason to invoke those individually or to list them here. It is deliberately the same set `.github/workflows/check.yml` runs in CI — keep that equivalence when adding a check, or one of the two silently stops being the gate. **It repairs what it can rather than just reporting** — `dprint fmt`, `knip --fix`, `eslint --fix` — so expect a clean run to have edited your files. Four things its output will not tell you:

- Its first step is `dprint fmt`, which rewrites files across the repo, not just the ones you touched — on a tree carrying unformatted edits you did not author, it folds them into your diff, against the Git section's rule about preserving unrelated working-tree changes.
- `knip:fix` strips the `export` keyword off anything nothing imports — it never deletes the declaration, and it is pinned to `--fix-type exports,types` so it cannot edit package.json or remove files. It runs **before** `lint:fix` on purpose: `no-unused-vars` treats an `export` as public API and goes silent, so stripping the keyword first is what lets ESLint report a genuinely dead symbol in the same run. To keep an export knip would strip, tag it `/** @public */`.
- Because those two chain, a `check` run can both edit a file and then fail on it: knip removes the `export`, ESLint reports the now-file-local symbol as unused, and deleting it is yours to do. That is the intended flow, not a conflict.
- Its e2e step sets `E2E_SKIP_BUILD=1`, which makes Playwright's `webServer` serve the `dist/` the preceding `build` step just produced instead of building a second time (16s of the chain). The flag is safe **only** because it sits on the line after `build`; setting it anywhere else tests a stale `dist/`. `test:e2e` on its own leaves it unset and builds normally.

**CI does not run `check`, or any single script standing in for it.** `.github/workflows/check.yml` — the shared gate that both `pr.yml` and `deploy.yml` call, so a PR and a `main` push cannot be held to different bars — runs the non-writing counterparts as one named step each: `format:check`, `lint`, `typecheck`, `knip:ci`, `test:ci`, `build`. One step per check is the point: the Actions UI names the check that failed instead of showing one opaque red step, and `!cancelled()` on each lets a single run surface _every_ failure rather than stopping at the first, which is what the `jules-fix` job needs to repair a Dependabot PR in one pass. Adding a check to CI therefore means adding a step there, not editing a script.

`pnpm run ci` is checks-through-to-build in one command: `check` minus the repairing (`format:check`/`lint`/`knip:ci` instead of their writing counterparts) and minus e2e. **Despite the name, GitHub Actions does not run it** — `check.yml` spells those steps out instead, deliberately, so the Actions UI can name the one that failed. Its actual consumer is the build command of the **Cloudflare Pages** project built from this repo, which wants a single non-repairing command and has no browsers. It runs plain `test`, not `test:ci`, because nothing there consumes a coverage or JUnit report and `test:ci`'s `github-actions` reporter would only litter that build log. That caller lives outside the repo where no grep will find it, so the script has zero in-repo callers and still is not dead — do not remove it, and do not "simplify" `check.yml` into a call to it.

`test:ci` is `test` plus a v8 coverage report over `src/lib/**/*.ts`, a JUnit file (both uploaded to Codecov) and the `github-actions` reporter — vitest only auto-enables that last one when NO reporter is configured, so passing `--reporter=junit` silently costs you the inline annotations on failing tests unless it is listed too. `knip:ci` drops the dependency checks: those flip when an upstream package restructures its own dependencies, which must not gate a Dependabot bump. See `knip.jsonc`. e2e is a second **job** in `check.yml`, not a step in the check job: it runs in parallel with the rest, and a failure names `e2e` rather than hiding inside a long step list.

## Data Model

Itinerary data is YAML. Loading priority:

1. User YAML saved in `localStorage` under `showmeway_user_yaml`.
2. `public/itinerary.local.yaml` for personal local data. This should remain untracked.
3. `public/itinerary.yaml` as the default template.

A `#s=<token>` share link short-circuits that list: `App.svelte`'s `onMount` runs `maybeImportSharedItinerary()` before the first load, so the shared YAML is written into `showmeway_user_yaml` (source 1) rather than being a fourth source — via `createProfile`, which parks the current trip as a profile instead of overwriting it, and only after a confirm unless there is no existing trip. The hash is always stripped afterwards, including on decline or decode failure, so a refresh cannot re-prompt.

The schema lives at `public/showmeway-schema.json` (served with the site so the modeline `$schema` URL resolves). It is editor-only — nothing validates against it at runtime — so a new itinerary field has to land in five places at once: the interface in `src/lib/api.ts`, its shape check in `normalizeTripData` (the only real gate; list-of-object fields reuse `validateEntryList`, and any optional text field reuses `validateOptionalString` — prose and hrefs both degrade a non-string to nothing on screen, so validation is the only place the author hears about it. Absent stays legal for those: `desc` and a checklist `text` have always rendered as a blank line, and tightening that would newly reject trips that load today — which is also why `TimelineEvent.desc` and `ChecklistItem.text` are declared optional) with a case in `src/lib/api.test.ts`, the schema itself, the example `public/itinerary.yaml`, and the field reference in `.agents/skills/itinerary-yaml-builder/SKILL.md` — that skill is what authors users' YAML, so a field it omits is a field nobody ever writes. `stops` (f728a17) is the worked example.

`serializeToYaml` strips runtime-only `_id` values (timeline events, checklist items, and expense records, plus any legacy `id`) and re-adds the YAML schema modeline. Do not persist `_id` into YAML fixtures or exports. It clones via `JSON.parse(JSON.stringify(...))` deliberately — `structuredClone` throws on the `$state` proxy it is handed, and swapping it in passes every unit test (those pass plain objects) while breaking every save in the browser. Saving is canonicalization, not a round-trip: the js-yaml dump preserves array order but not comments or hand-authored key order, and `validateYaml` rebuilds a fixed top-level shape (`trip`/`days`/`todo`/`packing`/`expenses`), so any other top-level key is silently dropped on the next save. This is not new with any one editor — every save path re-serializes, including a checklist toggle.

`trip.start`, `trip.end`, `trip.departure` and `days[].day` are **derived, never authored**: `normalizeTripData` sorts `days` by `date`, numbers them, fills a skipped date in as a 自由活動 free day, takes the first/last dates as the range, and derives `departure` from day 1's first event time (offset-free local time — the countdown targets the first event, not a flight). `serializeToYaml` strips all four, so a hand-written value survives exactly until the next save. They stay **required** on `TripData["trip"]` because a loaded trip always has them; the schema keeps them as `deprecated` so old files do not light up in an editor. That invariant — `departure` always sits on `start` — is what makes `getCountdownText`'s "already left" case unreachable, hence absent.

AI chat edits are the one whole-document write the user never authors: the model calls `update_itinerary` with the **complete** updated YAML, `ChatPanel` validates it and gates it behind a `DiffView` confirm, and `applyAiEdit` in `App.svelte` revalidates, calls `backupCurrentYaml` (the only undo), then assigns `tripData` in place — not via `loadTripData`, which would unmount the AI tab and lose its conversation. Because the model re-authors the whole file while `normalizeTripData` defaults `todo`/`packing`/`expenses` to `[]`, a section the model forgets to echo back validates clean and is silently wiped; a new top-level section has to be named in `buildSystemInstruction`'s edit rules, not just added to `TripData`. It is also the only path that regenerates every `_id` without remounting, so anything keyed by `_id` (a pending undo, say) goes stale in place.

Trip profiles (multiple trips): the active trip stays in `showmeway_user_yaml`; the other trips are parked as YAML snapshots in `showmeway_profiles`, with `showmeway_active_profile` holding the active id (see the profile helpers in `src/lib/api.ts`). Switching swaps the chosen snapshot with the active one — a separate, user-managed list (never auto-evicted, unlike the backup ring). The switcher UI is `ProfileManager`, hosted both at the top of 行程管理 and in TripOverview's hero drawer; switching navigates back to the 行程 tab. Only the itinerary YAML travels with a profile. Any caller that swaps the active YAML must also clear `settingsDraft.yaml` — a draft left from the previous trip outranks the persisted YAML in the editor and would be saved over the newly active trip.

Where the YAML leaves the device the split is by audience, not by medium: only `shareCurrentTrip` (the overview's 分享行程 link) serializes with `expenses: []`; the cross-device transfer link (labelled 含記帳), the file export, and the Gemini grounding context (`buildItineraryContext` is just `serializeToYaml(tripData)`) all ship the full trip. The two share paths are near-identical `buildShareUrl(serializeToYaml(...))` calls in `App.svelte` differing only by that spread, and no test asserts the difference — do not dedupe them, and make the same choice explicitly for any new personal field.

Other `localStorage` keys exist outside the itinerary YAML: `exchange_rate_<currency>` (`Ledger`'s working rate — despite `MANUAL_RATE_KEY_PREFIX`'s name, the user's manual override and the last auto-fetched rate share this one key, so a resolved fetch overwrites the manual value on the next load), `showmeway_exchange_rates_<base>` (rate cache in `src/lib/exchange.ts`), `showmeway_yaml_backups` (auto-snapshots of the user YAML taken before each destructive overwrite — newest first, max 5; see `backupCurrentYaml` in `src/lib/api.ts`), `showmeway_geocode_v1_<city>` / `showmeway_weather_<city>` (weather cache in `src/lib/weather.ts`; geocode entries carry a 30-day TTL — no longer permanent — and forecasts a 3h TTL), `showmeway_gemini_api_key` / `showmeway_gemini_model` / `showmeway_gemini_model_filter` (the user's own Gemini API key, the chat model they picked from the dynamically fetched list, and whether that list is filtered to clean release names or left unfiltered — `default` / `all`, absent means `default`; managed by `src/lib/gemini.ts` / `AppSettings.svelte` / `ChatPanel.svelte`, never written into the itinerary YAML and not carried with a profile), `showmeway_theme` (light/dark preference, `src/lib/theme.svelte.ts` — app-level, so it is absent until the user picks one and never travels with a profile), and `showmeway_pwa_install_dismissed` (a timestamp; `src/lib/pwa-install.svelte.ts` stops re-raising the install offer for 7 days after it. Absent until the offer is first declined or ignored, and app-level — an install is a property of the device, not of a trip. `e2e/tests/fixtures.ts` pre-stamps it so the 3.5s toast never lands mid-test). Checklist checked-state AND ledger expense records (`TripData.expenses`) live inside the itinerary YAML itself; the legacy `todo_state` / `packing_state` / `ledger_expenses` keys are migrated once into the YAML and removed by `App.svelte` — do not reintroduce them.

That list is not maintained as an inventory — it explains the keys whose _behaviour_ is surprising, not every key that exists. For what is actually stored right now, read `storage-admin.ts`'s prefix sweep or open 本機儲存與快取 in App 設定; a new key needs no entry here unless something about it would mislead a reader (Google Drive's, for instance, are ordinary per-trip records and get none).

Each of those keys is declared exactly once in TypeScript, in the module that owns it (`YAML_BACKUPS_KEY` in `api.ts`, `MANUAL_RATE_KEY_PREFIX` in `ledger.ts`, `GEMINI_*_STORAGE` in `gemini.ts`, `THEME_KEY` in `theme.svelte.ts`, the cache prefixes privately inside `weather.ts` / `exchange.ts`); the one literal outside a module is `showmeway_theme` in `index.html`'s pre-paint script, which runs before any import can — rename it in both places. Code that needs to enumerate or clear someone else's keys asks that module for a `*Keys()` / `clear*()` function instead of restating the string — see `storage-admin.ts`.

## Svelte And UI Guidelines

- Use Svelte 5 runes for new component code: `$state`, `$derived`, `$derived.by`, `$effect` only when appropriate.
- Prefer event attributes such as `onclick` over legacy `on:click`.
- Use keyed `{#each}` blocks with stable keys. Do not use indexes as keys when item identity exists.
- Keep component state local unless there is a concrete need to share it.
- Use `@lucide/svelte` icons for interface actions when an icon exists, always via the per-icon deep path (`import Calendar from "@lucide/svelte/icons/calendar";`) — every icon import in the repo does. The barrel form passes lint, typecheck and build and tree-shakes to a byte-identical bundle, so nothing in `pnpm run check` flags it, but it drags the whole icon set through the Svelte compiler (module graph 301 → 3931) and slows the dev server and every build.
- Keep mobile ergonomics in mind; this app is meant to be installed and used on a phone while traveling.
- `src/app.css`'s `standalone` variant (`@media (display-mode: standalone)`) exists solely for the app shell's `h-dvh standalone:h-screen` in `App.svelte`. It looks redundant and is not: WebKit computes `dvh` with phantom browser chrome on an installed-PWA cold start, while `100vh` is exact there. Removing either half — or the seemingly unused variant — breaks the installed iOS PWA, and no browser tab or Playwright run can reproduce it.
- Avoid introducing large visual redesigns while making functional changes unless explicitly requested.

## Design Tokens And Color

All color lives in `src/app.css`, where each token carries a comment on its role: the `@theme` block holds the dark palette and generates the Tailwind utilities; `:root[data-theme="light"]` redeclares every token whose meaning is theme-dependent (all but `scrim`), un-layered so it outranks Tailwind's `@layer theme`. A new color needs both entries or it silently renders its dark value on paper — nothing checks that the two lists match. Components must contain **zero** literal colors — no hex, no raw Tailwind palette (`slate-700`), and no `white/N` / `black/N`: `bg-white/5` would hardcode "lighter = add white", which inverts on a light background.

`data-theme` on `<html>` is the only switch. `src/lib/theme.svelte.ts` owns the preference (`system` / `dark` / `light`, default `system`) and keeps every `theme-color` meta in step; an inline classic script in `index.html` resolves the same thing before first paint, because a module script would flash the wrong theme. **Those two copies of the resolution logic must stay in sync** — `e2e/tests/theme.spec.ts` is what catches it if they drift. That spec guards more than the pair: it also recomputes contrast for eleven token/backdrop pairs in **both** themes and fails anything under 4.5:1 — including `accent` on its own `bg-accent/15` chip fill — so a palette edit has to clear AA before it lands. It also pins `--color-scrim` to its opaque built form, because the driver-facing blackout must not follow the theme.

Opacity modifiers on tokens are fine (`bg-accent/15`, `hover:border-positive/50`): they `color-mix` a `var(--color-*)`, so they still flip with the theme. Only `white`/`black` literals are banned.

Besides the semantic colors (`accent`, `booked`/`must`/`option`, `positive`/`danger`, `bg-main`, `card-bg`, `text-*`) there are translucent ramps for surfaces stacked on other surfaces: `tint-1/2/3` (lift), `line-faint`/`line`/`line-raised`/`line-emphasis` (edges), `well`/`well-deep` (recess), plus `scrim`, `lift`, and `.panel`'s `--panel-shadow`. Two more are conventions rather than choices: `accent-contrast` is the foreground on every solid `accent` fill (it is what replaces the banned `white` literal), and `card-border` is the default border for cards, inputs, and quiet chrome — so a new control takes `border-card-border`, not one of the `line-*` ramps.

Changing `bg-main` also means updating `<meta name="theme-color">` in `index.html`, the manifest colors in `vite.config.ts`, and `:root`'s `color-scheme`.

## Formatting And Style

- Formatting is handled by dprint (config `.dprint.jsonc`) with 4-space indentation for TypeScript/Svelte-related files and 2-space indentation for YAML/JSON. Imports get rewritten every time: declarations and named specifiers sort case-insensitively, and any import with two or more specifiers is forced one-per-line, so hand-ordering them is wasted work. `lineWidth` is 1000 — long single lines are normal here, and dprint neither breaks them nor unwraps expressions you wrapped by hand.
- TypeScript uses double quotes and semicolons.
- YAML prefers single quotes — but `public/itinerary.yaml` and `public/itinerary.local.yaml` are in dprint's `excludes`, and dprint honors that even for an explicitly passed path, so `format`, `format:check`, and the pre-commit hook all silently skip them. Match the fixture's existing style by hand; it is what `serializeToYaml` emits — single quotes, no line folding.
- Comments explain **why**, never **what**. A comment that restates the code it sits on is noise, and usually a sign the code should have been named better instead — rename the function or extract the expression rather than captioning it. Write one when the reason is not recoverable from reading the code: a browser or API quirk being worked around, an ordering or invariant a future edit would silently break, an approach that was tried and rejected, a magic number's source. Section headers (`// --- helpers ---`), banner comments over an obvious block, restating the signature above a function, and narrating each step of a sequence all count as noise — delete them.
- Doc comments (`/** … */`) describe the **interface**, not the implementation: what the export is for and what a caller is bound by (throws vs. returns null, a required call order, a mutation, a unit, a caveat). How it achieves that — the algorithm, the workaround, the reason for a particular branch — is a body comment; a caller reading the doc should not learn things that a rewrite of the body would invalidate. Write one only where the name does not already carry the contract, and never restate parameter names as `@param`.
- A comment must age with the code it explains. If a comment names a file, function, or behavior, an edit that moves any of those has to update or delete it — a confidently wrong comment costs more than none.

## Testing Notes

- Vitest runs in `environment: "node"` with `include: ["src/**/*.test.ts"]` (`vitest.config.ts`) — no jsdom, no `@testing-library`, hence **no component-test layer**: `.svelte` components are covered only end-to-end by Playwright. Logic that needs unit coverage must live in a `src/lib/` module with a sibling `*.test.ts`; `.svelte.ts` rune modules count, and are why the config still loads the svelte plugin. No browser globals exist there, so no module may touch `window` / `localStorage` / `fetch` at import time — reach them inside functions only, and stub with `vi.stubGlobal` in tests. A test named `*.spec.ts`, or placed outside `src/`, silently never runs.
- `vitest.config.ts` is standalone, so `vite.config.ts`'s `define` block is absent: `__APP_VERSION__` / `__BUILD_TIME__` are declared in `src/vite-env.d.ts`, which keeps typecheck and build clean while an unguarded read is a `ReferenceError` under `pnpm run test` — guard with `typeof … !== "undefined"` the way `version.ts` does.
- Module-level state outlives each test in a file. `toast.svelte.test.ts` drains pending timers and dismisses survivors in `afterEach`; `pwa-install.svelte.test.ts` rebuilds the module graph per test with `vi.resetModules()` + `await import(...)` because its session latches are deliberately unresettable — and it re-imports `toast.svelte` from that same fresh graph, or assertions read a different store instance than the code under test writes to.
- Pure date/time helpers belong in `src/lib/utils.ts` and should have Vitest coverage in `src/lib/utils.test.ts`.
- Ledger pure calculations belong in `src/lib/ledger.ts` (covered by `src/lib/ledger.test.ts`); `Ledger.svelte` is a controlled component — expense records come in as the `expenses` prop (owned by `App.svelte`, persisted in the itinerary YAML) and add/delete/reset go back through callbacks. It keeps only its own input `$state` plus the manual exchange-rate localStorage, and wraps the pure functions in `$derived`.
- Be careful with `YYYY-MM-DD` parsing. This project intentionally parses plain dates in local time to avoid UTC day shifts.
- PWA, Vite and asset behavior break at build time and nowhere else — no unit test reaches them — so `pnpm run check` (which builds) is the only thing that catches a regression there.
- Playwright e2e lives in `e2e/tests/` (11 specs, config `playwright.config.ts`) and is more than `smoke.spec.ts`: since nothing inside a `.svelte` file or `App.svelte` has unit coverage, it is the only layer catching UI wiring, and the sole coverage for the App.svelte-resident flows (the one-time legacy-key migration, `applyAiEdit`, share-link import, profile switching). It is what makes `check` worth its wall-clock on a UI change; the unit suite cannot reach any of it. It tests the built app via `vite preview`, hermetically — `fixtures.ts` aborts every non-localhost request, service workers are blocked (`serviceWorkers: "block"`, otherwise the PWA SW bypasses `page.route`), and tests seed `showmeway_user_yaml` with a far-future fixture (no `city`/`currency`, so weather/exchange never fire). The seed init-script only writes when the key is absent — it re-runs on `page.reload()`, and an unconditional write would wipe state the app just persisted.
- That abort is not a dead end for network-dependent features: a `page.route` registered inside a test outranks the context-level block, so mock there rather than loosening `fixtures.ts` — `chat.spec.ts` does it for Gemini's `/v1beta/models` and `/v1beta/interactions`. A models mock must return a single page: `listGeminiModels` follows `nextPageToken`, so a fixed response echoing one pages forever.
- Playwright runs a single project, `mobile-chromium` on `devices["Pixel 7"]` — no desktop and no WebKit project, so the Safari-specific workarounds in the code are untested. `smoke.spec.ts` and `today.spec.ts` narrow to 390px on purpose so the chip row overflows and the scroll-into-view assertions are not vacuous, and `contextOptions: { reducedMotion: "reduce" }` is load-bearing for those same tests — TabPager smooth-scrolls the active chip into view, so the geometry assertions would race without it. Do not drop either to chase a scroll flake.
- UI assertions use exact zh-TW strings incl. fullwidth punctuation (`｜`, `—`). Changing user-visible copy usually breaks several test files, not one: every spec asserts real strings through role/label locators, and validation-error text is asserted in `src/lib/api.test.ts` / `api-fetch.test.ts` as well — grep the whole repo for the old string.
- One suite deliberately depends on the real clock: `today.spec.ts` builds its trip around today's Asia/Taipei date (matching `timezoneId`) because `syncToToday` can only be exercised when a day actually is today — the far-future fixture leaves that path uncovered. Its day offsets are applied to that calendar date through UTC, never with `setDate`, or a runner whose own zone observes DST would collapse two days onto one Taipei date. It still uses the same network-blocking fixture, so only the dates are non-hermetic. Tests reach TabPager's chip row through `[data-pager-scroller]`, not through Tailwind class names.

## Git And Generated Files

- `dist/` is gitignored build output — never hand-edit it. `.github/workflows/deploy.yml` builds `main` and publishes it to GitHub Pages with `BASE_PATH=<repo name>`, so production is served from `/show-me-way/` while `pnpm dev`, `vite preview`, and the e2e suite all run at `/`. Fetch or link bundled `public/` assets **relatively** (`./itinerary.yaml`, as `fetchDefaultYamlText` does) — a leading slash passes every local check and 404s only on the deployed site.
- Do not commit personal itinerary data in `public/itinerary.local.yaml`.
- Avoid rewriting lockfiles unless dependencies or tool setup actually changed.
- Preserve unrelated user changes in the working tree.
- A `simple-git-hooks` pre-commit hook runs `lint-staged` (dprint on all staged files, `eslint --fix` on `*.{js,ts,svelte}`). Expect staged files to be reformatted on commit.
