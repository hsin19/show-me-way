import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from "vitest";
import {
    backupCurrentYaml,
    buildLedgerCsv,
    getYamlBackup,
    listYamlBackups,
    serializeToYaml,
    USER_YAML_KEY,
    validateYaml,
    YAML_BACKUPS_KEY,
} from "./api";

// Minimal valid itinerary wrapping the given `trip.hotels` YAML list body.
function tripYaml(hotelsYaml: string): string {
    return [
        "trip:",
        "  name: '測試行程'",
        "  start: '2026-06-11'",
        "  end: '2026-06-12'",
        "  departure: '2026-06-11T08:00:00+08:00'",
        `  hotels:${hotelsYaml}`,
        "days:",
        "  - day: 1",
        "    date: '2026-06-11'",
        "    region: '市區'",
        "    pace: '輕鬆'",
        "    timeline: []",
    ].join("\n");
}

const validHotel = [
    "",
    "    - name: '測試旅店'",
    "      address: '1-2-3 Test St'",
    "      checkIn: '2026-06-11'",
    "      checkOut: '2026-06-12'",
].join("\n");

describe("validateYaml — hotels 元素形狀", () => {
    it("拒絕空白列表項 (null 元素) 並指出項次", () => {
        expect(() => validateYaml(tripYaml("\n    -")))
            .toThrow("hotels 第 1 項必須是物件 (不可為空白列表項)");
        expect(() => validateYaml(tripYaml(`${validHotel}\n    -`)))
            .toThrow("hotels 第 2 項必須是物件 (不可為空白列表項)");
    });

    it("拒絕非物件的元素", () => {
        expect(() => validateYaml(tripYaml("\n    - '只有名字'")))
            .toThrow("hotels 第 1 項必須是物件 (不可為空白列表項)");
    });

    it("拒絕缺少必填欄位的元素", () => {
        const missingCheckOut = [
            "",
            "    - name: '測試旅店'",
            "      address: '1-2-3 Test St'",
            "      checkIn: '2026-06-11'",
        ].join("\n");
        expect(() => validateYaml(tripYaml(missingCheckOut)))
            .toThrow("hotels 第 1 項缺少 checkOut 屬性");
    });

    it("拒絕型別錯誤的必填欄位", () => {
        const numericName = [
            "",
            "    - name: 123",
            "      address: '1-2-3 Test St'",
            "      checkIn: '2026-06-11'",
            "      checkOut: '2026-06-12'",
        ].join("\n");
        expect(() => validateYaml(tripYaml(numericName)))
            .toThrow("hotels 第 1 項的 name 必須是文字");
    });

    it("把未加引號的日期 (js-yaml 解析成 Date) 還原為 YYYY-MM-DD 字串", () => {
        const unquotedDates = [
            "",
            "    - name: '測試旅店'",
            "      address: '1-2-3 Test St'",
            "      checkIn: 2026-06-11",
            "      checkOut: 2026-06-12",
        ].join("\n");
        const data = validateYaml(tripYaml(unquotedDates));
        expect(data.trip.hotels[0]).toMatchObject({
            checkIn: "2026-06-11",
            checkOut: "2026-06-12",
        });
    });

    it("接受欄位齊全的 hotels", () => {
        const data = validateYaml(tripYaml(validHotel));
        expect(data.trip.hotels).toHaveLength(1);
        expect(data.trip.hotels[0]).toMatchObject({
            name: "測試旅店",
            checkIn: "2026-06-11",
            checkOut: "2026-06-12",
        });
    });

    it("接受空的 hotels 列表", () => {
        expect(validateYaml(tripYaml(" []")).trip.hotels).toEqual([]);
    });
});

// Minimal valid itinerary wrapping the given day-1 `timeline` YAML list body.
function timelineYaml(body: string): string {
    return [
        "trip:",
        "  name: '測試行程'",
        "  start: '2026-06-11'",
        "  end: '2026-06-12'",
        "  departure: '2026-06-11T08:00:00+08:00'",
        `  hotels:${validHotel}`,
        "days:",
        "  - day: 1",
        "    date: '2026-06-11'",
        "    region: '市區'",
        "    pace: '輕鬆'",
        `    timeline:${body}`,
    ].join("\n");
}

const bookedEvent = [
    "",
    "      - time: '08:00'",
    "        title: '✈️ 班機'",
    "        type: booked",
    "        desc: '出發'",
].join("\n");

describe("validateYaml — confirmation 形狀", () => {
    it("接受事件與飯店上完整的 confirmation", () => {
        const conf = [
            "",
            "        confirmation:",
            "          code: 'ABC123'",
            "          name: 'WANG XIAO MING'",
            "          note: '出示護照'",
        ].join("\n");
        const data = validateYaml(timelineYaml(bookedEvent + conf));
        expect(data.days[0].timeline[0].confirmation).toEqual({
            code: "ABC123",
            name: "WANG XIAO MING",
            note: "出示護照",
        });
    });

    it("接受只有 code 的 confirmation 與完全沒有 confirmation 的舊 YAML", () => {
        const codeOnly = "\n        confirmation:\n          code: 'X-1'";
        expect(validateYaml(timelineYaml(bookedEvent + codeOnly)).days[0].timeline[0].confirmation)
            .toEqual({ code: "X-1" });
        expect(validateYaml(timelineYaml(bookedEvent)).days[0].timeline[0].confirmation)
            .toBeUndefined();
    });

    it("拒絕非物件的 confirmation", () => {
        expect(() => validateYaml(timelineYaml(`${bookedEvent}\n        confirmation: 'ABC123'`)))
            .toThrow("days 第 1 項的 timeline 第 1 項的 confirmation 必須是物件");
    });

    it("拒絕缺少 code 的 confirmation", () => {
        expect(() => validateYaml(timelineYaml(`${bookedEvent}\n        confirmation:\n          name: 'WANG'`)))
            .toThrow("days 第 1 項的 timeline 第 1 項的 confirmation 缺少 code 屬性");
    });

    it("拒絕未加引號的數字 code (避免前導零遺失) 並提示修法", () => {
        expect(() => validateYaml(timelineYaml(`${bookedEvent}\n        confirmation:\n          code: 012345`)))
            .toThrow("confirmation 的 code 必須是文字 (數字代碼請加引號，例如 code: '012345')");
    });

    it("拒絕非文字的 name / note，並對飯店的 confirmation 指出項次", () => {
        const hotelConf = [
            "",
            "      confirmation:",
            "        code: 'BK-1'",
            "        name: 123",
        ].join("\n");
        expect(() => validateYaml(tripYaml(validHotel + hotelConf)))
            .toThrow("hotels 第 1 項的 confirmation 的 name 必須是文字");
    });
});

// Standalone trip / days blocks for structure-level cases the wrappers can't express.
const validTripBlock = [
    "trip:",
    "  name: '測試行程'",
    "  start: '2026-06-11'",
    "  end: '2026-06-12'",
    "  departure: '2026-06-11T08:00:00+08:00'",
    `  hotels:${validHotel}`,
].join("\n");

const validDaysBlock = [
    "days:",
    "  - day: 1",
    "    date: '2026-06-11'",
    "    region: '市區'",
    "    pace: '輕鬆'",
    "    timeline: []",
].join("\n");

describe("validateYaml — 結構與其餘 zh-TW 驗證", () => {
    it("拒絕空內容與缺少 trip / days 的結構", () => {
        expect(() => validateYaml("")).toThrow("YAML 內容為空或格式不正確");
        expect(() => validateYaml("days: []"))
            .toThrow("YAML 缺少必要的結構 (trip 或 days 區塊)");
        expect(() => validateYaml("trip:\n  name: '測試行程'"))
            .toThrow("YAML 缺少必要的結構 (trip 或 days 區塊)");
    });

    it("拒絕空的 days 列表", () => {
        expect(() => validateYaml(`${validTripBlock}\ndays: []`))
            .toThrow("days 至少需要一天的行程");
    });

    it("拒絕 days 的空白列表項與非物件元素", () => {
        expect(() => validateYaml(`${validTripBlock}\ndays:\n  -`))
            .toThrow("days 第 1 項必須是物件 (不可為空白列表項)");
        expect(() => validateYaml(`${validTripBlock}\ndays:\n  - '只有字串'`))
            .toThrow("days 第 1 項必須是物件 (不可為空白列表項)");
    });

    it("拒絕缺少 timeline 列表的 day", () => {
        const dayWithoutTimeline = [
            "days:",
            "  - day: 1",
            "    date: '2026-06-11'",
            "    region: '市區'",
            "    pace: '輕鬆'",
        ].join("\n");
        expect(() => validateYaml(`${validTripBlock}\n${dayWithoutTimeline}`))
            .toThrow("days 第 1 項缺少 timeline 列表");
    });

    it("拒絕 timeline 的空白列表項與非物件元素", () => {
        expect(() => validateYaml(timelineYaml("\n      -")))
            .toThrow("days 第 1 項的 timeline 第 1 項必須是物件 (不可為空白列表項)");
        expect(() => validateYaml(timelineYaml(`${bookedEvent}\n      - '只有字串'`)))
            .toThrow("days 第 1 項的 timeline 第 2 項必須是物件 (不可為空白列表項)");
    });

    it("拒絕 todo / packing 的非物件元素並指出項次", () => {
        expect(() => validateYaml([validTripBlock, validDaysBlock, "todo:", "  -"].join("\n")))
            .toThrow("todo 第 1 項必須是物件 (例如 - text: '項目內容')");
        expect(() => validateYaml([validTripBlock, validDaysBlock, "packing:", "  - '只有字串'"].join("\n")))
            .toThrow("packing 第 1 項必須是物件 (例如 - text: '項目內容')");
    });

    it("拒絕非文字的 trip.city 與 days[].city", () => {
        expect(() => validateYaml([validTripBlock, "  city: 123", validDaysBlock].join("\n")))
            .toThrow("trip.city 必須是文字 (例如 'Tokyo')");
        expect(() => validateYaml([validTripBlock, validDaysBlock, "    city: 123"].join("\n")))
            .toThrow("days 第 1 項的 city 必須是文字 (例如 'Tokyo')");
    });
});

describe("validateYaml — status 打卡狀態", () => {
    it("接受 done / skipped，未設定維持 undefined", () => {
        expect(validateYaml(timelineYaml(`${bookedEvent}\n        status: done`)).days[0].timeline[0].status)
            .toBe("done");
        expect(validateYaml(timelineYaml(`${bookedEvent}\n        status: skipped`)).days[0].timeline[0].status)
            .toBe("skipped");
        expect(validateYaml(timelineYaml(bookedEvent)).days[0].timeline[0].status).toBeUndefined();
    });

    it("拒絕非法的 status 值", () => {
        expect(() => validateYaml(timelineYaml(`${bookedEvent}\n        status: visited`)))
            .toThrow("days 第 1 項的 timeline 第 1 項的 status 必須是 'done' 或 'skipped'");
    });
});

const validAlternatives = [
    "",
    "        alternatives:",
    "          - title: '備案餐廳'",
    "            localName: '백업식당'",
    "            mapLink: 'https://naver.me/abc'",
    "            note: '排隊超過 30 分鐘改來這裡'",
].join("\n");

describe("validateYaml — alternatives 形狀", () => {
    it("接受完整的備案清單", () => {
        const data = validateYaml(timelineYaml(bookedEvent + validAlternatives));
        expect(data.days[0].timeline[0].alternatives).toEqual([{
            title: "備案餐廳",
            localName: "백업식당",
            mapLink: "https://naver.me/abc",
            note: "排隊超過 30 分鐘改來這裡",
        }]);
    });

    it("拒絕非列表的 alternatives", () => {
        expect(() => validateYaml(timelineYaml(`${bookedEvent}\n        alternatives: '備案'`)))
            .toThrow("days 第 1 項的 timeline 第 1 項的 alternatives 必須是列表");
    });

    it("拒絕空白列表項並指出項次", () => {
        expect(() => validateYaml(timelineYaml(`${bookedEvent}\n        alternatives:\n          - title: '備案餐廳'\n          -`)))
            .toThrow("days 第 1 項的 timeline 第 1 項的 alternatives 第 2 項必須是物件 (不可為空白列表項)");
    });

    it("拒絕缺少 title 的項目", () => {
        expect(() => validateYaml(timelineYaml(`${bookedEvent}\n        alternatives:\n          - localName: '백업식당'`)))
            .toThrow("days 第 1 項的 timeline 第 1 項的 alternatives 第 1 項缺少 title 屬性");
    });

    it("拒絕非文字的選填欄位", () => {
        expect(() => validateYaml(timelineYaml(`${bookedEvent}\n        alternatives:\n          - title: '備案餐廳'\n            note: 123`)))
            .toThrow("days 第 1 項的 timeline 第 1 項的 alternatives 第 1 項的 note 必須是文字");
    });
});

describe("serializeToYaml 與 round-trip", () => {
    const richEvent = [
        "",
        "      - time: '08:00'",
        "        title: '✈️ 班機'",
        "        type: booked",
        "        desc: '出發'",
        "        status: done",
        "        confirmation:",
        "          code: '012345'",
    ].join("\n") + validAlternatives;

    const richYaml = [
        timelineYaml(richEvent),
        "todo:",
        "  - text: '換錢'",
        "    checked: true",
        "    id: 'legacy-1'",
        "packing:",
        "  - text: '充電器'",
    ].join("\n");

    it("剝除 runtime _id 與 legacy checklist id", () => {
        const data = validateYaml(richYaml);
        expect(data.days[0].timeline[0]._id).toBeTruthy();
        expect(data.todo[0]._id).toBeTruthy();
        const yaml = serializeToYaml(data);
        expect(yaml).not.toContain("_id");
        expect(yaml).not.toContain("legacy-1");
    });

    it("輸出以 schema modeline 開頭", () => {
        const yaml = serializeToYaml(validateYaml(richYaml));
        expect(yaml.startsWith("# yaml-language-server: $schema=")).toBe(true);
        expect(yaml).toContain("showmeway-schema.json");
    });

    it("round-trip：兩次序列化字串相等", () => {
        // validateYaml 會重新注入 _id，故比對序列化字串而非 deepEqual。
        const first = serializeToYaml(validateYaml(richYaml));
        const second = serializeToYaml(validateYaml(first));
        expect(second).toBe(first);
    });

    it("status / confirmation / alternatives 經 round-trip 不遺失", () => {
        const data = validateYaml(serializeToYaml(validateYaml(richYaml)));
        const ev = data.days[0].timeline[0];
        expect(ev.status).toBe("done");
        expect(ev.confirmation).toEqual({ code: "012345" });
        expect(ev.alternatives).toEqual([{
            title: "備案餐廳",
            localName: "백업식당",
            mapLink: "https://naver.me/abc",
            note: "排隊超過 30 分鐘改來這裡",
        }]);
        expect(data.todo[0]).toMatchObject({ text: "換錢", checked: true });
        expect(data.packing[0]).toMatchObject({ text: "充電器" });
    });
});

function createLocalStorageStub() {
    const store = new Map<string, string>();
    return {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => void store.set(key, value),
        removeItem: (key: string) => void store.delete(key),
        clear: () => store.clear(),
        _store: store,
    };
}

describe("backupCurrentYaml / listYamlBackups / getYamlBackup", () => {
    let storage: ReturnType<typeof createLocalStorageStub>;

    beforeEach(() => {
        vi.useFakeTimers();
        storage = createLocalStorageStub();
        vi.stubGlobal("localStorage", storage);
        vi.spyOn(console, "warn").mockImplementation(() => {});
    });
    afterEach(() => {
        vi.unstubAllGlobals();
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it("does nothing when there is no current YAML to snapshot", () => {
        backupCurrentYaml();
        expect(listYamlBackups()).toEqual([]);
    });

    it("snapshots newest-first and looks one up by timestamp", () => {
        vi.setSystemTime(new Date("2026-06-11T00:00:00Z"));
        storage.setItem(USER_YAML_KEY, "trip: A");
        backupCurrentYaml();
        vi.setSystemTime(new Date("2026-06-12T00:00:00Z"));
        storage.setItem(USER_YAML_KEY, "trip: B");
        backupCurrentYaml();

        const backups = listYamlBackups();
        expect(backups.map(b => b.yaml)).toEqual(["trip: B", "trip: A"]);
        expect(getYamlBackup(backups[0].savedAt)).toBe("trip: B");
        expect(getYamlBackup("no-such-stamp")).toBeNull();
    });

    it("skips a snapshot identical to the latest", () => {
        storage.setItem(USER_YAML_KEY, "trip: same");
        backupCurrentYaml();
        vi.setSystemTime(new Date("2026-06-12T00:00:00Z"));
        backupCurrentYaml(); // USER_YAML_KEY unchanged
        expect(listYamlBackups()).toHaveLength(1);
    });

    it("keeps only the newest 5 (ring buffer)", () => {
        for (let i = 0; i < 7; i++) {
            vi.setSystemTime(new Date(2026, 5, 11, 0, i)); // distinct minutes
            storage.setItem(USER_YAML_KEY, `trip: ${i}`);
            backupCurrentYaml();
        }
        const backups = listYamlBackups();
        expect(backups).toHaveLength(5);
        expect(backups[0].yaml).toBe("trip: 6"); // newest
        expect(backups.at(-1)!.yaml).toBe("trip: 2"); // oldest two evicted
    });

    it("only warns (never throws) when the backup write fails", () => {
        storage.setItem(USER_YAML_KEY, "trip: A");
        storage.setItem = () => {
            throw new DOMException("QuotaExceededError");
        };
        expect(() => backupCurrentYaml()).not.toThrow();
    });

    it("treats a corrupt backups blob as empty", () => {
        storage.setItem(YAML_BACKUPS_KEY, "{not json");
        expect(listYamlBackups()).toEqual([]);
        storage.setItem(YAML_BACKUPS_KEY, JSON.stringify([{ savedAt: 1, yaml: null }, "x"]));
        expect(listYamlBackups()).toEqual([]); // malformed entries filtered out
    });
});

describe("expenses — YAML round-trip", () => {
    const withExpenses = tripYaml(validHotel) + "\n" + [
        "expenses:",
        "  - name: '晚餐'",
        "    amount: 1200",
        "    type: 'Cash'",
        "    date: '2026-06-11'",
    ].join("\n");

    it("defaults to an empty list when absent", () => {
        expect(validateYaml(tripYaml(validHotel)).expenses).toEqual([]);
    });

    it("parses records and assigns a runtime _id", () => {
        const data = validateYaml(withExpenses);
        expect(data.expenses).toHaveLength(1);
        expect(data.expenses[0].name).toBe("晚餐");
        expect(data.expenses[0].amount).toBe(1200);
        expect(typeof data.expenses[0]._id).toBe("string");
    });

    it("strips _id on serialization but keeps the record", () => {
        const yaml = serializeToYaml(validateYaml(withExpenses));
        expect(yaml).toContain("expenses:");
        expect(yaml).toContain("晚餐");
        expect(yaml).not.toContain("_id");
    });

    it("rejects a non-object expense entry with a zh-TW message", () => {
        expect(() => validateYaml(tripYaml(validHotel) + "\nexpenses:\n  - 'x'"))
            .toThrow("expenses 第 1 項必須是物件");
    });
});

describe("buildLedgerCsv", () => {
    it("returns null with no records", () => {
        expect(buildLedgerCsv([])).toBeNull();
    });

    it("emits a BOM, zh-TW header, type labels and escaped fields", () => {
        const csv = buildLedgerCsv([
            { date: "2026-06-11", name: "晚餐", amount: 1200, type: "Cash" },
            { date: "2026-06-11", name: "WOWPASS 加值", amount: 50000, type: "Deposit-WOWPASS" },
            { date: "2026-06-12", name: "紀念品, 含稅", amount: 3000, type: "WOWPASS" },
        ])!;
        expect(csv.charCodeAt(0)).toBe(0xFEFF);
        const lines = csv.slice(1).trimEnd().split("\r\n");
        expect(lines[0]).toBe("日期,項目,金額,類別");
        expect(lines[1]).toBe("2026-06-11,晚餐,1200,現金支付");
        expect(lines[2]).toBe("2026-06-11,WOWPASS 加值,50000,WOWPASS 加值");
        // A comma inside a field forces quoting.
        expect(lines[3]).toBe('2026-06-12,"紀念品, 含稅",3000,WOWPASS 支付');
    });
});
