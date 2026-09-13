# AGENTS.md

ShowMeWay (下面一way) is a YAML-driven travel itinerary PWA: Svelte 5 runes, TypeScript, Vite, Tailwind CSS v4, `vite-plugin-pwa`, `js-yaml`, valibot, Vitest, Playwright. Package manager is `pnpm`; `src/main.ts` mounts `src/App.svelte`. User-facing copy and validation errors are Traditional Chinese.

This file holds the rules an agent needs before touching anything. The reasoning behind a subsystem lives in that subsystem's module comment — read the file you are about to change, not this one, for the why.

## Layering (`src/lib/`)

The tree is cut on one axis, what kind of thing a file is: `domain/` computes, `infra/` talks to the outside, `stores/` holds state, `ui/` renders. It is deliberately not cut by feature, so Drive sync spans `infra/http/gdrive.ts`, `stores/gdrive.svelte.ts` and `ui/tools/settings/`.

- `domain/` is pure: no `fetch`, no svelte runtime, no browser global **at import time**. That qualifier is the rule — `domain/` is the answer to "can this be unit-tested". A synchronous `typeof window`-guarded query is legal; `prefersReducedMotion` (`utils.ts`) and the URL-fragment access in `share.ts` are the two that exist. A `domain/` test that has to stub `localStorage` is testing something that belongs in `infra/`.
- `infra/` is split by **failure mode**, not by API: `http/` dies offline (so `weather.ts` lives there even though it also writes localStorage), `storage/` is localStorage (synchronous, ours, quota-bound), `pwa/` is a device adapter. Ask what breaks a file, not what it calls.
- `stores/` are runes singletons. `trip.svelte.ts` and `gdrive.svelte.ts` are mostly orchestration, not state; each carries a module comment with its mental model.
- `ui/` is split by screen (`itinerary/`, `tools/`, `tools/settings/`, `ai/`) plus `shared/` for generic leaves, including shared UI `.ts` modules. `shared/` means generic, not merely "used twice": `ProfileManager` stays in `tools/settings/` although `TripOverview`'s drawer borrows it, and that is the only page-to-page import.
- Two cross-cutting exceptions: `showToast` is a global sink any layer calls directly, and `SettingsPanel.svelte` imports `tripStore` directly — only navigation comes in as props, because the host owns the active tab.

## Invariants

1. **localStorage.** Every key this app writes starts with `showmeway_`. Never `localStorage.clear()` — production is a GitHub Pages project site sharing its origin with other projects; use `clearAppLocalStorage()` in `storage-admin.ts`. Each key is declared once, in the module that owns it; code that needs someone else's keys asks that module for a `*Keys()` / `clear*()` function. The one literal outside a module is `showmeway_theme` in `index.html`'s pre-paint script.
2. **Derived, never authored.** `trip.start`, `trip.end`, `trip.departure` and `days[].day` are computed by `normalizeTripData` and stripped by `serializeToYaml`. `trip.id` is also minted there and never authored, but is **kept** on save — it is the trip's identity and what binds it to its Drive file. Never author or persist「退房」/「回飯店休息」timeline nodes; `Timeline.svelte` synthesizes them from `trip.hotels`.
3. **Whole-document writes.** Any write of `showmeway_user_yaml` outside `persist()` goes through `TripStore.landYaml`. Whatever swaps the active YAML must clear `settingsDraft.yaml`. Anything keyed by trip uses the `profileId` an import outcome reports, never an id captured before the call — an import moves the active slot.
4. **Share-link privacy.** The payload (`#s=`) and the key (`#h=<id>.<key>`) live in the URL fragment, never a query parameter. hop receives AES-GCM ciphertext and nothing else; the key is never sent to hop or logged. The one place the id, key and `editToken` leave the device together is the owner's own Drive file, as `appProperties` — never file content, and only so their other devices update the same link instead of minting a second one; that file already holds the trip in plaintext, so the pair tells Google nothing it could not already read. `sealShareToken` mints its own key and IV; `resealShareToken` (same key, fresh IV) exists only to update a link in place. The `editToken` may go back to hop and must never enter YAML that is exported, shared or sent to Gemini. hop is the app's only first-party upload: it stays behind an explicit user action, is disclosed in `public/privacy.html`, the README and the share toasts, and a failure to reach it must never clear the hash — the address bar holds the only copy of the key. `resolveShareLink` is the one place a share-link failure is classified. The recipient keeps the id and key of a link it imported, in `showmeway_trip_origins`, so the sender's later versions can be fetched without the URL being reopened — id and key only, never an `editToken`, which would hand a recipient authority over someone else's blob.
5. **Nothing transfers by itself.** There is no automatic upload or download anywhere: a local edit raises a prompt once editing settles, a background check reports what it found, and the transfer happens on the tap. A comparison against a sync record reads the bytes in `showmeway_user_yaml`, never `serializeToYaml(data)` — a pull stores what it downloaded, and re-serializing that would read as an edit nobody made.
6. **Drive sync.** A `pulled` result is recorded only after the bytes have landed (`commit` thunk). The share-link properties ride with every push and are adopted wherever a file's metadata reaches the slot bound to it; an absent property means "this device does not know", never a revoke, so only `pushShareLink` after a revoke clears it. `checkOnly` transfers nothing. A conflict changes nothing and waits for the user. The trip → file binding is a rebuildable cache. Direction is decided in `decideSyncAction`, rebinding in `buildRebindRecord`; both are pure and their docs hold the truth table.
7. **Rendering shared content.** Never `{@html}` in `RichText.svelte`; everything goes through the AST and the `sanitizeHref` / `sanitizeLinkHref` allowlists.
8. **AI edits.** `update_itinerary` returns the whole YAML; it passes `validateYaml` and a `DiffView` confirm before `applyAiEdit`. A new top-level section must be named in `buildSystemInstruction`'s edit rules or the model's omission wipes it; a new field rendered through `RichText` must be added to `buildSystemInstruction`'s rule 8 field list.

## Data model

Itinerary data is YAML, loaded in this order: `showmeway_user_yaml`, then `public/itinerary.local.yaml` (personal, untracked), then `public/itinerary.yaml`. A share link on launch resolves into source 1 through `importSharedTrip` rather than adding a source; the same function serves a link pasted into the editor.

The authored shape is one valibot schema, `src/lib/domain/trip-schema.ts`; the runtime gate, the TypeScript types and the editor's `schema/showmeway-schema.json` all derive from it. The JSON is generated by `pnpm run schema:gen` and committed — never hand-edit it. Adding a field means: the schema with a `v.description` written for an author (the itinerary-yaml-builder skill reads the generated JSON instead of keeping a field table), a case in `trip.test.ts`, and the example `public/itinerary.yaml`. Changing a derivation rule (numbering, gap-filling, date range) also has to reach `.agents/skills/itinerary-yaml-builder/scripts/validate_itinerary.py`, which re-implements those checks in Python; run it on both public YAML files afterwards.

Saving is canonicalization, not a round-trip: unknown keys at any depth are dropped, key order becomes schema order, and every save path re-serializes. The generated JSON's `additionalProperties: false` is what shows an unknown key in the editor.

Multiple trips: the active one stays in `showmeway_user_yaml`, the others are parked as snapshots in `showmeway_profiles` with `showmeway_active_profile` naming the active id (`infra/storage/profiles.ts`). The backup ring `showmeway_yaml_backups` (max 5) is snapshotted before every destructive overwrite and is the only undo.

Where YAML leaves the device — the share link, Drive sync and the Gemini grounding context — every path ships the whole trip, because nothing per-person lives in the YAML today. A new personal field has to make that audience split explicitly.

## Svelte and UI

- Svelte 5 runes only (`$state`, `$derived`, `$derived.by`; `$effect` when nothing else fits), event attributes (`onclick`), keyed `{#each}` with real identity, state kept local unless shared for a reason. Follow `.agents/skills/svelte-code-writer` and `svelte-core-bestpractices` when editing `.svelte` / `.svelte.ts` files.
- Icons come from `@lucide/svelte` via the per-icon deep path (`@lucide/svelte/icons/calendar`). The barrel import passes every check but drags the whole icon set through the compiler.
- Built for a phone in hand while traveling; keep 44px targets and mobile ergonomics. No visual redesigns inside functional changes.
- `src/app.css`'s `standalone` variant and `App.svelte`'s `h-dvh standalone:h-screen` exist for the installed iOS PWA; the comment there explains why. No browser tab or Playwright run reproduces the bug they fix.

## Design tokens

All color lives in `src/app.css`: the `@theme` block is the dark palette, `:root[data-theme="light"]` redeclares every theme-dependent token (all but `scrim`). A new color needs both entries — nothing checks. Components contain zero literal colors: no hex, no raw Tailwind palette, no `white/N` / `black/N`; opacity modifiers on tokens are fine. `accent-contrast` is the foreground on solid `accent`; `card-border` is the default border for cards, inputs and quiet chrome; `tint-*`, `line-*`, `well*` are the stacked-surface ramps. `data-theme` on `<html>` is the only switch; `theme.svelte.ts` and the inline script in `index.html` resolve it identically and must stay in sync. Changing `bg-main` also means `theme-color` in `index.html`, the manifest colors in `vite.config.ts` and `:root`'s `color-scheme`.

## Formatting and style

- dprint (`.dprint.jsonc`): 4-space TS/Svelte, 2-space YAML/JSON, `lineWidth` 1000, imports sorted and multi-specifier imports forced one-per-line. Double quotes, semicolons. `public/itinerary*.yaml` are excluded from dprint and must match what `serializeToYaml` emits by hand: single quotes, no folding.
- Comments explain **why**, never what. Section headers, banners, restated signatures and step narration are noise. Write one for a quirk being worked around, an ordering an edit would silently break, a rejected approach, a magic number's source.
- Doc comments describe the interface — what a caller is bound by — not the implementation; no `@param` restating names. A comment must age with its code: an edit that moves what a comment names updates or deletes the comment.

## Commands

- `pnpm dev` on port 8045, `vite preview` on 8046, both `strictPort`. localStorage is per origin, so a saved trip exists only there; on `EADDRINUSE` free the port instead of passing `--port`.
- `pnpm run check` is the gate: schema generation, format, knip, lint, typecheck, unit tests, build, e2e, in that order, naming the step that failed. It **repairs** — `schema:gen`, `dprint fmt`, `knip --fix` (strips dead `export` keywords; tag `/** @public */` to keep one), `eslint --fix` — so a clean run edits files, including unrelated unformatted ones. knip runs before eslint on purpose: stripping `export` lets `no-unused-vars` report the symbol, and deleting it is yours to do. Its e2e step reuses the `dist/` the preceding build produced (`E2E_SKIP_BUILD=1`); `test:e2e` alone builds. Run `pnpm exec playwright install chromium webkit` once per machine.
- CI (`.github/workflows/check.yml`, called by `pr.yml` and `deploy.yml`) runs the non-writing counterparts as one named step each, so a new check is a new step there. `pnpm run ci` is the same set as one non-repairing command minus e2e; its consumer is the Cloudflare Pages build outside this repo — it has no in-repo callers and is not dead.

## Testing

- Vitest runs in `environment: "node"`, `include: ["src/**/*.test.ts"]`: no component-test layer, `.svelte` files are covered only by Playwright. Logic that needs unit coverage lives in a `src/lib/` module with a sibling `*.test.ts`; `.svelte.ts` rune modules count. No module may touch `window` / `localStorage` / `fetch` at import time; stub inside tests with `vi.stubGlobal`, using the shared stubs in `src/lib/testing/stubs.ts` (excluded from coverage). `__APP_VERSION__` / `__BUILD_TIME__` are undefined under vitest; guard reads as `version.ts` does. A test named `*.spec.ts` or placed outside `src/` never runs.
- Dates are `YYYY-MM-DD` parsed in local time on purpose; date helpers live in `domain/utils.ts` with tests beside them. PWA, Vite and asset behavior break only at build time, so `check` (which builds) is what catches them.
- Playwright (`e2e/tests/`, `playwright.config.ts`) tests the built app hermetically: `fixtures.ts` aborts every non-localhost request, service workers are blocked, and specs seed `showmeway_user_yaml` with a far-future fixture. Mock a network feature with `page.route` inside the test, as `chat.spec.ts` does for Gemini, rather than loosening the fixture. The seed only writes when the key is absent because it re-runs on reload.
- Two projects, `mobile-chromium` (Pixel 7) and `mobile-webkit` (iPhone 13); no desktop. WebKit is the engine the installed PWA actually runs on, so a spec has to pass there too — clipboard permissions do not exist in WebKit, which is why specs go through `captureClipboard` instead of `grantPermissions`. `reducedMotion: "reduce"` and `timezoneId` in the config are load-bearing for the geometry and date assertions. `today.spec.ts` deliberately uses the real Asia/Taipei date.
- UI assertions use exact zh-TW strings including fullwidth punctuation, and validation-error text is asserted in unit tests too — grep the whole repo before changing user-visible copy.

## Git and generated files

- `dist/` is gitignored build output. Production is served from `/show-me-way/` (`BASE_PATH` in `deploy.yml`) while dev, preview and e2e run at `/`, so reference bundled `public/` assets relatively (`./itinerary.yaml`); a leading slash 404s only in production.
- Never commit `public/itinerary.local.yaml`. Avoid rewriting the lockfile unless dependencies actually changed. Preserve unrelated working-tree changes.
- The pre-commit hook runs `lint-staged`: dprint on staged files, `eslint --fix` on `*.{js,ts,svelte}`, and `schema:gen` when `trip-schema.ts` is staged (it stages the regenerated JSON itself). Expect staged files to be reformatted.
