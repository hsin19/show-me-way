# AGENTS.md

This repository is a Svelte 5 travel itinerary PWA. Agents should treat local skills as the primary workflow layer and use Svelte MCP CLI commands only when a skill or task calls for them.

## Project Overview

- App: ShowMeWay, a YAML-driven travel itinerary helper PWA.
- Stack: Svelte 5 runes, TypeScript, Vite, Tailwind CSS v4, `vite-plugin-pwa`, `js-yaml`, Vitest.
- Package manager: `pnpm`.
- Mount entry: `src/main.ts` mounts the root component `src/App.svelte`.
- Shared logic: `src/lib/api.ts`, `src/lib/utils.ts`.
- Components in `src/lib/components/`: `Timeline.svelte` (day event list), `DaySwitcher.svelte` (day navigation), `Checklist.svelte` (packing/todo lists), `Ledger.svelte` (expense tracking with exchange rate), `TaxiHelper.svelte` (taxi phrase helper).
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
- Build: `pnpm run build`
- Full verification: `pnpm run check`

`pnpm run check` runs format, lint, typecheck, tests, and build. Prefer it before handing off broader changes. For narrow changes, run the smallest relevant command first and report anything not run.

## Data Model

Itinerary data is YAML. Loading priority:

1. User YAML saved in `localStorage` under `showmeway_user_yaml`.
2. `public/itinerary.local.yaml` for personal local data. This should remain untracked.
3. `public/itinerary.yaml` as the default template.

The schema lives at `showmeway-schema.json`. Keep TypeScript interfaces in `src/lib/api.ts`, schema fields, and example YAML aligned when changing itinerary structure.

`serializeToYaml` strips runtime-only timeline event `_id` values and re-adds the YAML schema modeline. Do not persist `_id` into YAML fixtures or exports.

Other `localStorage` keys exist for component state: `exchange_rate` (`Ledger`) and per-list checklist state (`Checklist`). These are separate from itinerary YAML persistence.

## Svelte And UI Guidelines

- Use Svelte 5 runes for new component code: `$state`, `$derived`, `$derived.by`, `$effect` only when appropriate.
- Prefer event attributes such as `onclick` over legacy `on:click`.
- Use keyed `{#each}` blocks with stable keys. Do not use indexes as keys when item identity exists.
- Keep component state local unless there is a concrete need to share it.
- Use `@lucide/svelte` icons for interface actions when an icon exists.
- Keep mobile ergonomics in mind; this app is meant to be installed and used on a phone while traveling.
- Avoid introducing large visual redesigns while making functional changes unless explicitly requested.

## Formatting And Style

- Formatting is handled by dprint with 4-space indentation for TypeScript/Svelte-related files and 2-space indentation for YAML/JSON.
- TypeScript uses double quotes and semicolons.
- YAML prefers single quotes.
- Keep comments sparse and useful. Existing comments often explain date/time or YAML persistence behavior; preserve that clarity.

## Testing Notes

- Pure date/time helpers belong in `src/lib/utils.ts` and should have Vitest coverage in `src/lib/utils.test.ts`.
- Be careful with `YYYY-MM-DD` parsing. This project intentionally parses plain dates in local time to avoid UTC day shifts.
- When changing PWA, Vite, or asset behavior, verify with `pnpm run build`.

## Git And Generated Files

- Do not edit `dist/` for source changes.
- Do not commit personal itinerary data in `public/itinerary.local.yaml`.
- Avoid rewriting lockfiles unless dependencies or tool setup actually changed.
- Preserve unrelated user changes in the working tree.
- A `simple-git-hooks` pre-commit hook runs `lint-staged` (dprint on all staged files, `eslint --fix` on `*.{js,ts,svelte}`). Expect staged files to be reformatted on commit.
