---
name: itinerary-yaml-builder
description: Turn freeform trip notes (scattered Traditional Chinese text, jotted plans, day-by-day descriptions) into a valid ShowMeWay itinerary YAML. MUST be used whenever the user wants to draft, build, organize, convert, or update their trip into the app's YAML format, or asks to add/edit days, hotels, todos, packing items, or phrases in the itinerary.
---

# Itinerary YAML Builder

Convert messy trip notes into a schema-valid `public/itinerary.local.yaml` for the ShowMeWay PWA.

The source of truth for structure is `showmeway-schema.json` at the repo root. The quick reference below mirrors it — if the schema and this file ever disagree, re-read the schema and trust it.

## Workflow

1. **Ask for the output path first.** Inquire where the user wants to save the generated YAML file. Suggest `public/itinerary.local.yaml` as the default destination, but allow them to specify a custom target path (e.g. in `Downloads/` or another local path).
2. **Read existing data if applicable.** If the target output file already exists, read it. Decide with the user whether you are **merging** into the current trip or **replacing** it. Never silently discard existing days/hotels.
3. **Extract structured facts from the notes.** Pull out: trip name, start/end dates, departure flight time, hotels, and a per-day timeline. Ask the user only for missing fields that are *required* (see below) and cannot be inferred. Don't over-ask — infer sensible values for optional fields.
4. **Normalize.** Apply the conventions below (dates, ids, event `type`, time ranges, `naverSearch`).
5. **Write the YAML** to the chosen target path, with the schema modeline on line 1 (see Output rules).
6. **Verify** with the checks in the Verification section before reporting done.

## Schema quick reference

Top-level keys: `trip` (required), `days` (required), and optional `todo`, `packing`, `phrases`.

### trip (required: name, start, end, departure, hotels)

- `name` — string, trip title.
- `start` / `end` — `YYYY-MM-DD`.
- `departure` — outbound flight time, ISO 8601 **with timezone offset**, e.g. `2026-06-11T14:00:00+08:00` (drives the home-screen countdown).
- `hotels[]` — each requires `name`, `station` (nearest metro + walking distance), `address` (local-language address for taxi drivers), `checkIn`, `checkOut` (both `YYYY-MM-DD`).

### days[] (required: day, date, region, pace, timeline)

- `day` — integer, 1-based.
- `date` — `YYYY-MM-DD`.
- `region` — main area, e.g. `明洞 · 乙支路`.
- `pace` — pace description, e.g. `慢活、需要早起`.
- `transport` — optional; omit to default to 步行 & 捷運.
- `timeline[]` — each requires `time`, `title`, `type`, `desc`; optional `bullets`, `naverSearch`.
  - `time` — `HH:MM` or a range `14:00 - 15:30`.
  - `title` — short label; emoji prefix is idiomatic (✈️ 🏨 🍜 🛍️ ☕ 🎁).
  - `type` — one of `booked` (預訂/橘), `must-go` (必訪/粉), `standard` (一般/藍), `option` (備選/紫).
  - `bullets[]` — optional string notes (may contain HTML like `<i>`).
  - `naverSearch` — optional NAVER Map search keyword for that spot.

### todo[] / packing[] (each item requires text; optional checked)

- `text` — the todo / packing item description.
- `checked` — optional boolean, default false.
- Do not write an `id` (or `_id`) field. Items are identified by a runtime-only `_id` the app assigns in memory; checkbox state lives inline via `checked` and is persisted back to YAML.

### phrases[] (each requires zh, text, rom)

- `zh` — Chinese meaning, `text` — foreign original (Korean/Japanese), `rom` — pronunciation/romanization.

## Conventions

- **Dates are plain `YYYY-MM-DD`** and are parsed in local time by the app — never add a time or `Z` to date fields. Only `trip.departure` carries a time + offset.
- **`days[].date` must fall within `trip.start`..`trip.end`** and `day` numbers should be sequential.
- **Never emit `_id`** on timeline events — it is a runtime-only field stripped on export.
- **Language:** keep all user-facing copy (titles, desc, region, pace) in Traditional Chinese to match the app.
- **Event type defaults:** flights/tickets/reservations → `booked`; the day's headline attraction → `must-go`; routine moves/meals → `standard`; tentative or backup ideas → `option`.
- **Be honest about gaps.** If the notes don't give a time or address, leave a clearly-marked placeholder (e.g. `desc: '（待確認地址）'`) rather than inventing specifics like exact addresses or flight numbers.

## Output rules

- Write to the chosen target file path.
- **Line 1 must be the schema modeline**, preserving whatever the file already uses. The repo default is:
  `# yaml-language-server: $schema=https://raw.githubusercontent.com/hsin19/show-me-way/refs/heads/main/showmeway-schema.json`
- YAML style follows 2-space indentation and single quotes for strings. If the output path is inside the repository, format it using `pnpm exec dprint fmt <path>` after writing (or `pnpm run format`).

## Verification

Before reporting done, run the bundled validator (self-contained — `uv` installs its
deps from the inline PEP 723 block, no project setup needed) on the generated target file:

```bash
uv run .agents/skills/itinerary-yaml-builder/scripts/validate_itinerary.py <path_to_generated_yaml>
```

The script validates against `showmeway-schema.json` (either loaded locally, via the modeline `$schema` URL, or default raw GitHub fallback) and reports the exact path of any violation; it exits non-zero on failure.

Then also confirm by eye:

1. Show the user a short summary of days/hotels added or changed, and flag any placeholders left for them to fill.
2. Verify that there are no remaining Git merge conflicts or syntax typos in the YAML file.

