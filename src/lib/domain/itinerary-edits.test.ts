import { FIXTURE_YAML } from "$lib/testing/fixture-trip";
import {
    describe,
    expect,
    it,
} from "vitest";
import { applyItineraryEdits } from "./itinerary-edits";
import {
    serializeToYaml,
    validateYaml,
} from "./trip";

const DAY_1 = "2099-01-01";
const DAY_2 = "2099-01-02";

/** FIXTURE_YAML with day 1's event carrying what an edit must not lose: a check-in and an attachment. */
const BASE = serializeToYaml(validateYaml(FIXTURE_YAML.replace(
    "        desc: 第一天的測試事件",
    [
        "        start: '2099-01-01T09:00'",
        "        desc: 第一天的測試事件",
        "        status: done",
        "        attachments:",
        "          - label: 電子票",
        "            fileId: f-ticket",
    ].join("\n"),
)));

function titles(yaml: string, date: string): string[] {
    return validateYaml(yaml).days.find(day => day.date === date)!.timeline.map(event => event.title);
}

describe("applyItineraryEdits", () => {
    it("changes only the fields an update names: null removes one, the check-in and the attachment stay", () => {
        const out = applyItineraryEdits(BASE, [{ op: "update_event", date: DAY_1, title: "測試事件一", yaml: "time: 09:30 - 11:00\ndesc: null" }]);

        const event = validateYaml(out).days[0]!.timeline[0]!;
        expect(event.time).toBe("09:30 - 11:00");
        expect(event.desc).toBeUndefined();
        expect(event.status).toBe("done");
        expect(event.attachments).toEqual([{ label: "電子票", fileId: "f-ticket" }]);
    });

    it("places a new event by its time, or after the event it names", () => {
        const byTime = applyItineraryEdits(BASE, [{ op: "add_event", date: DAY_1, yaml: "time: '08:00'\ntitle: 早餐" }]);
        expect(titles(byTime, DAY_1)).toEqual(["早餐", "測試事件一"]);

        const named = applyItineraryEdits(BASE, [{ op: "add_event", date: DAY_1, after: "測試事件一", yaml: { time: "08:00", title: "早餐" } }]);
        expect(titles(named, DAY_1)).toEqual(["測試事件一", "早餐"]);
    });

    it("moves an event to another day with its start, so it does not fail validation there", () => {
        const out = applyItineraryEdits(BASE, [{ op: "move_event", date: DAY_1, title: "測試事件一", toDate: DAY_2 }]);

        const trip = validateYaml(out);
        expect(trip.days[0]!.timeline).toEqual([]);
        // 09:00 sorts ahead of day 2's 10:00 event.
        expect(trip.days[1]!.timeline.map(event => [event.title, event.start])).toEqual([["測試事件一", "2099-01-02T09:00"], ["測試事件二", undefined]]);
        expect(trip.days[1]!.timeline[0]!.attachments).toHaveLength(1);
    });

    it("finds checklist items by their exact text, and applies edits in order", () => {
        const out = applyItineraryEdits(BASE, [
            { op: "add_item", list: "todo", text: "換日幣" },
            { op: "update_item", list: "todo", text: "換日幣", yaml: "checked: true" },
            { op: "remove_item", list: "todo", text: "測試待辦項目" },
            { op: "add_item", list: "packing", yaml: "text: 轉接頭" },
        ]);

        const trip = validateYaml(out);
        expect(trip.todo.map(({ text, checked }) => ({ text, checked }))).toEqual([{ text: "換日幣", checked: true }]);
        expect(trip.packing.map(item => item.text)).toEqual(["轉接頭"]);
    });

    it("finds an entry by an opening only it has, so a long todo need not be copied back whole", () => {
        const out = applyItineraryEdits(BASE, [{ op: "update_item", list: "todo", text: "測試待辦", yaml: "checked: true" }]);
        expect(validateYaml(out).todo[0]).toMatchObject({ text: "測試待辦項目", checked: true });

        expect(() => applyItineraryEdits(BASE, [{ op: "remove_event", date: DAY_1, title: "測試事件二" }])).toThrow("2099-01-01 找不到「測試事件二」");
        const twoAlike = applyItineraryEdits(BASE, [{ op: "add_event", date: DAY_1, yaml: "time: '12:00'\ntitle: 測試事件三" }]);
        expect(() => applyItineraryEdits(twoAlike, [{ op: "remove_event", date: DAY_1, title: "測試事件" }])).toThrow("2099-01-01 有 2 個以「測試事件」開頭的，對不到是哪一個");
    });

    it("refuses a field the schema does not know, which validation would drop without a word", () => {
        // What gemma-4-31b-it sent when asked to tick every todo.
        expect(() => applyItineraryEdits(BASE, [{ op: "update_item", list: "todo", text: "測試待辦項目", yaml: "update_text: '✅ 測試待辦項目'" }]))
            .toThrow("不認得「update_text」這個欄位（可用的有 text、checked）");
    });

    it("refuses a batch that changes nothing, rather than offering an empty diff to apply", () => {
        expect(() => applyItineraryEdits(BASE, [{ op: "update_item", list: "todo", text: "測試待辦項目", yaml: "checked: false" }]))
            .toThrow("這些修改沒有改到行程的任何地方");
    });

    it("refuses the whole batch when one edit misses, naming which", () => {
        expect(() =>
            applyItineraryEdits(BASE, [
                { op: "remove_event", date: DAY_1, title: "測試事件一" },
                { op: "remove_event", date: DAY_2, title: "不存在" },
            ])
        ).toThrow("第 2 項修改（刪除事件）沒辦法套用：2099-01-02 找不到「不存在」");
        expect(() => applyItineraryEdits(BASE, [{ op: "rewrite_everything" }])).toThrow("不認得「rewrite_everything」這種修改");
        expect(() => applyItineraryEdits(BASE, [{ op: "update_trip", yaml: "id: t-other" }])).toThrow("id 不能用這項修改改");
    });

    it("reports a result that fails validation in validateYaml's words", () => {
        expect(() => applyItineraryEdits(BASE, [{ op: "update_event", date: DAY_1, title: "測試事件一", yaml: "start: '2099-03-01T09:00'" }]))
            .toThrow("days 第 1 項的 timeline 第 1 項的 start (2099-03-01T09:00) 要在當天 (2099-01-01) 或隔天");
    });

    it("returns the app's canonical form, unquoted dates in a fragment included", () => {
        const out = applyItineraryEdits(BASE, [{ op: "add_day", yaml: "date: 2099-01-03\ntitle: 第三天" }]);

        expect(serializeToYaml(validateYaml(out))).toBe(out);
        expect(validateYaml(out).days.map(day => day.date)).toEqual([DAY_1, DAY_2, "2099-01-03"]);
    });
});
