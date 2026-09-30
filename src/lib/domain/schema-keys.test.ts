import {
    describe,
    expect,
    it,
} from "vitest";
import {
    findUnexpectedKeys,
    type SchemaNode,
} from "./schema-keys";
import { parseYaml } from "./trip";
// The src tsconfig has no node types, so a Vite `?raw` import stands in for readFileSync.
// eslint-disable-next-line no-restricted-imports -- public/ fixture sits outside src/lib
import templateYaml from "../../../public/itinerary.yaml?raw";
// eslint-disable-next-line no-restricted-imports -- the generated schema sits outside src/lib
import generatedSchema from "../../../schema/showmeway-schema.json";

const SCHEMA: SchemaNode = {
    properties: {
        trip: { properties: { name: {} } },
        days: {
            items: { properties: { date: {}, timeline: { items: { properties: { title: {} } } } } },
        },
    },
};

describe("findUnexpectedKeys", () => {
    it("回報 schema 不認得的欄位，路徑含陣列索引", () => {
        const doc = { trip: { name: "t", nmae: "typo" }, days: [{ date: "2026-01-01", timeline: [{ title: "a" }, { title: "b", mapLnk: "x" }] }] };
        expect(findUnexpectedKeys(doc, SCHEMA)).toEqual(["trip.nmae", "days[0].timeline[1].mapLnk"]);
    });

    it("認得的欄位、空值與非物件的值都不回報", () => {
        expect(findUnexpectedKeys({ trip: { name: "t" }, days: [] }, SCHEMA)).toEqual([]);
        expect(findUnexpectedKeys("字串", SCHEMA)).toEqual([]);
        expect(findUnexpectedKeys(null, SCHEMA)).toEqual([]);
    });

    // 用真的 schema 與範本，這樣 schema 的形狀一變（例如改用 $ref）這支走訪就會跟著紅，
    // 不會變成什麼都認不得、或什麼都放行。
    it("範本行程沒有多餘欄位；手誤的欄位名稱會被抓到", () => {
        expect(findUnexpectedKeys(parseYaml(templateYaml), generatedSchema)).toEqual([]);
        expect(findUnexpectedKeys(parseYaml(templateYaml.replace("mapLink:", "mapLnk:")), generatedSchema))
            .toEqual(["trip.hotels[0].mapLnk"]);
    });
});
