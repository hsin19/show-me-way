import {
    serializeToYaml,
    validateYaml,
} from "$lib/domain/trip";

// Minimal itinerary, in the exact bytes the app itself stores — its canonical form — so a
// seeded slot, a fake Drive file and a seeded sync record all hash what the app would
// write. Anything it would rewrite on save (a missing `trip.id`, derived fields, key
// order) makes every seeded sync record look locally dirty, which turns the Drive specs'
// carefully staged one-sided changes into conflicts. Dates are far-future on purpose: no
// day ever equals "today", so the app always lands on the day-0 overview and never shows
// time-dependent UI (countdown badges, aria-current chips). No trip.city — that keeps the
// weather fetch path dormant, so tests stay hermetic. Shared by the Playwright specs and
// the in-process app tests; both derive variants from it by string replacement, so the
// lines they target are the serializer's: 4-space `title:` under a day, 8-space `desc:`
// as an event's last key, `packing: []` last.
export const FIXTURE_YAML = serializeToYaml(validateYaml(`trip:
  name: 測試行程
  id: t-fixture
  hotels: []
days:
  - date: '2099-01-01'
    title: 測試區域一
    pace: 輕鬆漫遊
    timeline:
      - time: '09:00'
        title: 測試事件一
        type: standard
        desc: 第一天的測試事件
  - date: '2099-01-02'
    title: 測試區域二
    pace: 輕鬆漫遊
    timeline:
      - time: '10:00'
        title: 測試事件二
        type: standard
        desc: 第二天的測試事件
todo:
  - text: 測試待辦項目
`));
