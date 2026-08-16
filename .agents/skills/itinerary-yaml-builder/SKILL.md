---
name: itinerary-yaml-builder
description: Turn freeform trip notes (scattered Traditional Chinese text, jotted plans, day-by-day descriptions) into a valid ShowMeWay itinerary YAML. MUST be used whenever the user wants to draft, build, organize, convert, or update their trip into the app's YAML format, or asks to add/edit days, hotels, todos, or packing items in the itinerary.
---

# Itinerary YAML Builder

Convert messy trip notes into a schema-valid `public/itinerary.local.yaml` for the ShowMeWay PWA.

The source of truth for structure is `public/showmeway-schema.json`. The quick reference below mirrors it — if the schema and this file ever disagree, re-read the schema and trust it.

## Workflow

1. **Ask for the output path first.** Inquire where the user wants to save the generated YAML file. Suggest `public/itinerary.local.yaml` as the default destination, but allow them to specify a custom target path (e.g. in `Downloads/` or another local path).
2. **Read existing data if applicable.** If the target output file already exists, read it. Decide with the user whether you are **merging** into the current trip or **replacing** it. Never silently discard existing days/hotels.
3. **Extract structured facts from the notes.** Pull out: trip name, start/end dates, departure flight time, hotels, and a per-day timeline. Ask the user only for missing fields that are *required* (see below) and cannot be inferred. Don't over-ask — infer sensible values for optional fields.
4. **Normalize.** Apply the conventions below (dates, ids, event `type`, time ranges, `localName`/`mapLink`).
5. **Write the YAML** to the chosen target path, with the schema modeline on line 1 (see Output rules).
6. **Verify** with the checks in the Verification section before reporting done.

## Schema quick reference

Top-level keys: `trip` (required), `days` (required), and optional `todo`, `packing`.

### trip (required: name, start, end, departure, hotels)

- `name` — string, trip title.
- `start` / `end` — `YYYY-MM-DD`.
- `departure` — outbound flight time, ISO 8601 **with timezone offset**, e.g. `2026-06-11T14:00:00+08:00` (drives the home-screen countdown).
- `lang` — optional language code (`ko` / `ja` / `en`). Selects the app's built-in survival phrases and taxi-driver prompt. Defaults to English (`en`) when omitted or unsupported. Phrases are no longer authored in YAML.
- `city` — optional destination city for the daily weather badge. **Prefer an English name** (e.g. `Tokyo`, `Seoul`) — only some Chinese names resolve (東京/京都 work; 首爾/大阪/釜山 miss or hit the wrong country). Ambiguous names take a two-letter country suffix (e.g. `Springfield, US`). Weather is simply hidden when unset (or an empty string). Preserve an existing `city` when merging/updating.
- `currency` — optional currency code (e.g. `JPY`, `KRW`, `USD`) driving the ledger's converter, default wallets and quick amounts. Defaults to TWD when omitted.
- `mapProvider` — optional `naver` | `google`; which map service place searches open in (Korea effectively requires `naver`). Defaults to Google Maps.
- `wallets[]` — optional custom wallet/card names for the ledger (e.g. `Suica`, `WOWPASS`); omit to use the currency's defaults.
- `hotels[]` — each requires `name`, `address` (local-language address for taxi drivers), `checkIn`, `checkOut` (both `YYYY-MM-DD`); optional `localName` (local-language hotel name, used as the map-search query), `mapLink` (direct map URL, preferred over searching `localName`) and `confirmation` (see timeline `confirmation` below — same shape).

### days[] (required: day, date, title, pace, timeline)

- `day` — integer, 1-based.
- `date` — `YYYY-MM-DD`.
- `title` — day headline / main area, e.g. `明洞 · 乙支路` or `京都一日遊`.
- `city` — optional; overrides `trip.city` for this day's weather lookup (multi-city trips), e.g. `Kyoto`. Prefer English names; a `, XX` country suffix disambiguates.
- `pace` — pace description, e.g. `慢活、需要早起`.
- `timeline[]` — each requires `time`, `title`, `type`, `desc`; optional `bullets`, `localName`, `mapLink`, `stops`, `links`, `alternatives`, `status`, `confirmation`.
  - `time` — `HH:MM` or a range `14:00 - 15:30`.
  - `title` — short label; emoji prefix is idiomatic (✈️ 🏨 🍜 🛍️ ☕ 🎁).
  - `type` — one of `booked` (預訂/橘), `must-go` (必訪/粉), `standard` (一般/藍), `option` (備選/紫).
  - `bullets[]` — optional string notes; inline Markdown is supported, see **Inline Markdown** below.
  - `localName` — optional place name in the destination's local language; used as the map-search query and for the enlarge-for-the-driver view.
  - `mapLink` — optional direct map URL (e.g. a `naver.me` / `maps.app.goo.gl` short link); preferred over searching `localName`.
  - `stops[]` — optional ordered places this event walks through `{ name, localName?, mapLink? }`, for a `A ➔ B ➔ C` style title. Each stop renders its own map + enlarge buttons, so **every** stop can be shown to a driver — unlike the event-level `localName`, of which there is only one. Always shown expanded (it is the event's main content, not a fallback). `name` is the display name (usually Chinese), `localName` the local-language name that drives the map search — **without `localName` or `mapLink` a stop has no map button**, so fill it in. There is no `note` field: put commentary in the event's `desc` / `bullets`. When an event has `stops`, don't also repeat one of them in the event-level `localName`.
  - `links[]` — optional extra labeled links `{ label, url }` for the *same* event (official site, a guide article); map URLs get a matching brand icon automatically. Use this when the URL deserves its own labeled chip; for a URL that belongs inside a sentence, write a Markdown link in the prose instead — see **Inline Markdown** below. `url` may be `http(s)`, `mailto:`, `tel:`, `sms:`, `geo:` or a bare domain — **anything else renders no chip at all**, so a restaurant's phone number goes here as `tel:+81312345678`, never a `line://` deep link. Never hand-write a `google.com/maps/search/...` URL here to list a place — that is what `stops` is for, and a hand-written Google URL also ignores the trip's `mapProvider` (e.g. Naver for Korea).
  - `alternatives[]` — optional pick-one backup places `{ title, localName?, mapLink?, note? }` (e.g. fallback restaurants), shown as a collapsed list at the event card's tail. `localName` is the local-language place name (enlargeable to ask directions, also the map-search query), `mapLink` a direct map URL (preferred over searching `localName`), `note` a switch-decision reminder (e.g. `排隊超過 30 分鐘就換`). **`stops` vs `links` vs `alternatives`:** `stops` = places this event actually visits, all of them; `links` = supplementary URLs of the same event; `alternatives` = candidate places to switch to, carrying local name + note for on-the-spot decisions — never stuff backup restaurants into `links`.
  - `status` — optional check-in state, `done` (已完成) or `skipped` (略過); unset means not visited yet. Normally written by the in-app check-in buttons — leave it out when drafting a new trip, and preserve existing values when merging/updating.
  - `confirmation` — optional reservation confirmation `{ code, name?, note? }`, typically on `booked` events (and on hotels): `code` is the booking/confirmation code (**always quote it** — an unquoted numeric code like `012345` loses its leading zero to YAML number parsing), `name` the reservation name (passport spelling), `note` a short reminder (e.g. `入住時出示護照`). Shown as a tap-to-copy chip with an enlarge-for-the-counter view.

### todo[] / packing[] (each item requires text; optional checked)

- `text` — the todo / packing item description. Inline Markdown is supported, so keep the application or booking page in the item itself: `辦妥簽證 / 免簽電子許可，[申請入口](https://...)`.
- `checked` — optional boolean, default false.
- Do not write an `id` (or `_id`) field. Items are identified by a runtime-only `_id` the app assigns in memory; checkbox state lives inline via `checked` and is persisted back to YAML.

## Conventions

- **Dates are plain `YYYY-MM-DD`** and are parsed in local time by the app — never add a time or `Z` to date fields. Only `trip.departure` carries a time + offset.
- **`days[].date` must fall within `trip.start`..`trip.end`** and `day` numbers should be sequential.
- **Never emit `_id`** on timeline events — it is a runtime-only field stripped on export.
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
  `# yaml-language-server: $schema=https://hsin19.github.io/show-me-way/showmeway-schema.json`
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

