---
name: itinerary-yaml-builder
description: Turn freeform trip notes (scattered Traditional Chinese text, jotted plans, day-by-day descriptions) into a valid ShowMeWay itinerary YAML. MUST be used whenever the user wants to draft, build, organize, convert, or update their trip into the app's YAML format, or asks to add/edit days, hotels, todos, or packing items in the itinerary.
---

# Itinerary YAML Builder

Convert messy trip notes into a schema-valid `public/itinerary.local.yaml` for the ShowMeWay PWA.

**The field reference is `schema/showmeway-schema.json` — read it before writing.** It is generated from `src/lib/domain/trip-schema.ts`, the very definition the app validates with, so it is never stale: every field's type, whether it is required, its allowed values, and a `description` written for authors. Three markers matter: `deprecated: true` is a field the app computes and strips on save (never write it), `readOnly: true` is `trip.id` (copy verbatim when updating, leave out when creating), and `additionalProperties: false` on every object means a key the schema does not list is a typo the app will silently drop — do not invent fields.

## Workflow

1. **Ask for the output path first.** Inquire where the user wants to save the generated YAML file. Suggest `public/itinerary.local.yaml` as the default destination, but allow them to specify a custom target path (e.g. in `Downloads/` or another local path).
2. **Read existing data if applicable.** If the target output file already exists, read it. Decide with the user whether you are **merging** into the current trip or **replacing** it. Never silently discard existing days/hotels.
3. **Extract structured facts from the notes.** Pull out: trip name, hotels, and a per-day timeline (each day carries its own `date`). Trip start/end dates and the countdown target are derived from those dates — do not record them separately. Ask the user only for missing fields that are *required* (see below) and cannot be inferred. Don't over-ask — infer sensible values for optional fields.
4. **Normalize.** Apply the conventions below (dates, ids, event `type`, time ranges, `localName`/`mapLink`).
5. **Write the YAML** to the chosen target path, with the schema modeline on line 1 (see Output rules).
6. **Verify** with the checks in the Verification section before reporting done.

## Shape at a glance

Top-level keys: `trip` and `days` (required); `todo`, `packing` (optional); `expenses` (ledger records the app maintains — preserve when merging, never author).

- `trip` — requires `name`, `hotels[]`; optional `lang`, `city`, `currency`, `mapProvider`, `wallets[]`; app-owned `id`.
- `trip.hotels[]` — requires `name`, `address`, `checkIn`, `checkOut`; optional `localName`, `mapLink`, `confirmation`.
- `days[]` — requires `date`, `title`, `timeline[]`; optional `pace`, `city`. Order-insensitive: the app sorts by `date` and fills skipped dates in as free days.
- `days[].timeline[]` — requires `time`, `title`, `type`; optional `desc`, `bullets[]`, `localName`, `mapLink`, `stops[]`, `links[]`, `alternatives[]`, `confirmation`, `status`.
- `todo[]` / `packing[]` — `text`, optional `checked`.

What each field means, its examples, the `stops` vs `links` vs `alternatives` distinction and which fields accept Markdown are all in the schema's `description` strings — that is the reference, this list is only the skeleton.

## Conventions

- **Dates are plain `YYYY-MM-DD`** and are parsed in local time by the app — never add a time or `Z` to any date field, and quote them so YAML keeps them as text. Times of day live in `timeline[].time` as `HH:MM`.
- **`trip.start` / `trip.end` / `trip.departure` and `day` numbers are derived — never write them.** The app sorts `days` by `date`, numbers them, fills any skipped date in as a free day, takes the first and last dates as the trip range, and uses day 1's first event time as the home-screen countdown target. They are stripped on every save, so a hand-written value silently disappears. Entries in `days` may be listed in any order.
- **Never emit `_id`, and never write `id` on a todo/packing item** — both are runtime-only and stripped on save. `trip.id` is the opposite case: also app-generated, but persisted — never invent one, and never drop one that is already there.
- **`time` is `HH:MM` or a range `14:00 - 15:30`.** An unquoted `800` is a number and is rejected.
- **`title` idiom:** short, emoji prefix welcome (✈️ 🏨 🍜 🛍️ ☕ 🎁). The schema's `maxLength` on `days[].title` / `pace` is a layout hint for a 390px phone, not a hard limit.
- **`status` and `expenses` are the app's to write.** Leave `status` out when drafting a new trip; preserve existing `status`, `expenses`, `city`, `wallets` and `trip.id` when merging into an existing file.
- **`stops` need a `localName` or `mapLink` each** or the stop has no map button; when an event has `stops`, do not repeat one of them in the event-level `localName`. Never hand-write a `google.com/maps/search/...` URL in `links[]` to list a place — that is what `stops` is for, and a hand-written Google URL ignores the trip's `mapProvider` (Naver for Korea).
- **`links[].url` accepts `http(s)`, `mailto:`, `tel:`, `sms:`, `geo:` or a bare domain — anything else renders no chip**, so a restaurant's phone goes in as `tel:+81312345678`, never a `line://` deep link.
- **Language:** keep all user-facing copy (titles, desc, pace) in Traditional Chinese to match the app.
- **Event type defaults:** flights/tickets/reservations → `booked`; the day's headline attraction → `must-go`; routine moves/meals → `standard`; tentative or backup ideas → `option`.
- **Be honest about gaps.** If the notes don't give a time or address, leave a clearly-marked placeholder (e.g. `desc: '（待確認地址）'`) rather than inventing specifics like exact addresses or flight numbers.

## Inline Markdown

Prose fields — `timeline[].desc`, `timeline[].bullets[]`, `alternatives[].note`, and `todo[]` / `packing[]` `text` — render a small inline-Markdown subset:

| Write | Renders as |
| --- | --- |
| `[申請入口](https://example.com)` | a link showing only `申請入口` |
| `**提早 2.5 小時**` | bold |
| `*大概*` | italic — poor for Chinese, use sparingly |
| `***最重要***` | bold + italic |
| `` `10"×6"×2"` `` | monospace, good for sizes / codes / flight numbers |
| `\*` `\[` `` \` `` | a literal delimiter |

Rules that matter when authoring:

- **A bare URL is NOT auto-linked** — `詳見 https://…` stays plain text. Always wrap it: `詳見 [官網](https://…)`.
- **Put the link inside the sentence**, not appended to the end. `只認 [官方售票](https://…)，常提前售罄` reads far better than `只認官方售票，常提前售罄。https://…`.
- **Only `http`, `https` and `mailto` targets become links**, plus a schemeless target that reads as a domain (`www.example.com/x`, `example.com:8443/x` — it gets `https://` prepended). Anything else — `javascript:`, `tel:`, a root-relative path, a bare word with no dot — is left as literal text on purpose. A phone number belongs in `links[]`, which does accept `tel:`.
- **Never write a size as `56*36*23`.** An unspaced `*` pair is emphasis (CommonMark reads it the same way), so that renders as `56` *36* `23` with the asterisks gone. Use `×` — `56×36×23` — or escape them: `56\*36\*23`. Same for `3*2 晚`.
- **No other Markdown works** — no headings, tables, block lists or raw HTML. `bullets[]` is already a list; do not prefix its items with `-` or `*`.
- **Quote the YAML value when it starts with `*` or `[`**, or YAML reads it as an alias/flow sequence: `- '**穿短褲**或…'`.
- These fields only. `confirmation.note`, `title`, `pace`, `stops[].name` and hotel fields render literally, so Markdown written there shows its own asterisks.

## Output rules

- Write to the chosen target file path.
- **Line 1 must be the schema modeline**, preserving whatever the file already uses. The repo default is:
  `# yaml-language-server: $schema=https://raw.githubusercontent.com/hsin19/show-me-way/main/schema/showmeway-schema.json`
- YAML style follows 2-space indentation and single quotes for strings. If the output path is inside the repository, format it using `pnpm exec dprint fmt <path>` after writing (or `pnpm run format`).

## Verification

Before reporting done, run the bundled validator (self-contained — `uv` installs its
deps from the inline PEP 723 block, no project setup needed) on the generated target file:

```bash
uv run .agents/skills/itinerary-yaml-builder/scripts/validate_itinerary.py <path_to_generated_yaml>
```

The script validates against `showmeway-schema.json` (either loaded locally, via the modeline `$schema` URL, or the deployed site fallback) and reports the exact path of any violation; it exits non-zero on failure.

Then also confirm by eye:

1. Show the user a short summary of days/hotels added or changed, and flag any placeholders left for them to fill.
2. Verify that there are no remaining Git merge conflicts or syntax typos in the YAML file.

