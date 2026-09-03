import {
    describe,
    expect,
    it,
} from "vitest";
import {
    serializeToYaml,
    validateYaml,
} from "./trip";

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
        "    title: '市區'",
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

    it("接受未加引號的日期 (js-yaml 的 YAML 1.2 core schema 讀成純文字，不是 Date)", () => {
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
        "    title: '市區'",
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
    "    title: '市區'",
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

    it("拒絕缺少 name / hotels 或 name 非文字的 trip 區塊", () => {
        expect(() => validateYaml(`trip:\n  hotels:${validHotel}\n${validDaysBlock}`))
            .toThrow("trip 區塊缺少 name (文字) 或 hotels 屬性");
        expect(() => validateYaml(`trip:\n  name: 123\n  hotels:${validHotel}\n${validDaysBlock}`))
            .toThrow("trip 區塊缺少 name (文字) 或 hotels 屬性");
        expect(() => validateYaml(`trip:\n  name: '測試行程'\n${validDaysBlock}`))
            .toThrow("trip 區塊缺少 name (文字) 或 hotels 屬性");
    });

    it("只剩註解 / modeline 的內容視為空，仍回報 zh-TW 訊息", () => {
        expect(() => validateYaml("# yaml-language-server: $schema=./showmeway-schema.json\n"))
            .toThrow("YAML 內容為空或格式不正確");
    });

    it("拒絕含多份文件的 YAML", () => {
        expect(() => validateYaml(`${validTripBlock}\ndays:\n  - day: 1\n---\ntrip: {}`))
            .toThrow("YAML 只能包含一份行程");
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

    it("支援舊版 region 並自動遷移為 title，序列化時刪除 region", () => {
        const legacyYaml = [
            validTripBlock,
            "days:",
            "  - day: 1",
            "    date: '2026-06-11'",
            "    region: '舊版區域'",
            "    pace: '輕鬆'",
            "    timeline: []",
        ].join("\n");
        const parsed = validateYaml(legacyYaml);
        expect(parsed.days[0].title).toBe("舊版區域");
        expect((parsed.days[0] as unknown as { region?: string; }).region).toBeUndefined();

        const serialized = serializeToYaml(parsed);
        expect(serialized).toContain("title: 舊版區域");
        expect(serialized).not.toContain("region:");
    });

    it("拒絕缺少 timeline 列表的 day", () => {
        const dayWithoutTimeline = [
            "days:",
            "  - day: 1",
            "    date: '2026-06-11'",
            "    title: '市區'",
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

    it("拒絕非文字的 trip.id", () => {
        expect(() => validateYaml([validTripBlock, "  id: 123", validDaysBlock].join("\n")))
            .toThrow("trip的 id 必須是文字");
    });

    it("保留既有的 trip.id，沒有時才產生一個，且存檔時不會被剝掉", () => {
        const authored = validateYaml([validTripBlock, "  id: 'trip-abc'", validDaysBlock].join("\n"));
        expect(authored.trip.id).toBe("trip-abc");
        // The identity is what re-binds a trip to its Drive file, so a save must not drop
        // it the way it drops start/end/departure.
        expect(serializeToYaml(authored)).toContain("trip-abc");
        expect(validateYaml(serializeToYaml(authored)).trip.id).toBe("trip-abc");

        const minted = validateYaml([validTripBlock, validDaysBlock].join("\n"));
        expect(minted.trip.id).toBeTruthy();
        // Minting on every load would orphan the trip's cloud copy on the next sync.
        expect(validateYaml(serializeToYaml(minted)).trip.id).toBe(minted.trip.id);
    });

    it("拒絕非文字的 trip.city 與 days[].city", () => {
        expect(() => validateYaml([validTripBlock, "  city: 123", validDaysBlock].join("\n")))
            .toThrow("trip.city 必須是文字 (例如 'Tokyo')");
        expect(() => validateYaml([validTripBlock, validDaysBlock, "    city: 123"].join("\n")))
            .toThrow("days 第 1 項的 city 必須是文字 (例如 'Tokyo')");
    });

    it("拒絕缺少 date 屬性或格式錯誤的 day", () => {
        const dayWithoutDate = [
            "days:",
            "  - title: '市區'",
            "    pace: '輕鬆'",
            "    timeline: []",
        ].join("\n");
        expect(() => validateYaml(`${validTripBlock}\n${dayWithoutDate}`))
            .toThrow("days 第 1 項缺少 date 屬性");

        const dayWithInvalidDate = [
            "days:",
            "  - date: 'not-a-date'",
            "    title: '市區'",
            "    pace: '輕鬆'",
            "    timeline: []",
        ].join("\n");
        expect(() => validateYaml(`${validTripBlock}\n${dayWithInvalidDate}`))
            .toThrow("days 第 1 項的 date 必須是 YYYY-MM-DD 日期格式");
    });

    it("pace 選填：省略時回退預設，非文字則拒絕", () => {
        const dayWithoutPace = [
            "days:",
            "  - date: '2026-06-11'",
            "    title: '市區'",
            "    timeline: []",
        ].join("\n");
        expect(validateYaml(`${validTripBlock}\n${dayWithoutPace}`).days[0].pace).toBe("自由安排行程");
        expect(() => validateYaml(`${validTripBlock}\n${dayWithoutPace.replace("    timeline: []", "    pace: 123\n    timeline: []")}`))
            .toThrow("days 第 1 項的 pace 必須是文字");
    });

    it("接受未加引號的 date (js-yaml 的 YAML 1.2 core schema 讀成純文字，不是 Date)", () => {
        const unquoted = [
            "days:",
            "  - date: 2026-06-11",
            "    title: '市區'",
            "    timeline: []",
        ].join("\n");
        expect(validateYaml(`${validTripBlock}\n${unquoted}`).days[0].date).toBe("2026-06-11");
    });

    it("自動推算 trip.start 與 trip.end，並依日期自動升冪排序與推算 day", () => {
        const unorderedYaml = [
            "trip:",
            "  name: '自動推算測試'",
            "  departure: '2026-10-01T08:00:00+08:00'",
            `  hotels:${validHotel}`,
            "days:",
            "  - date: '2026-10-03'",
            "    title: '第三天行程'",
            "    timeline: []",
            "  - date: '2026-10-01'",
            "    title: '第一天行程'",
            "    timeline: []",
        ].join("\n");
        const parsed = validateYaml(unorderedYaml);
        expect(parsed.trip.start).toBe("2026-10-01");
        expect(parsed.trip.end).toBe("2026-10-03");
        expect(parsed.days).toHaveLength(3);
        // Day 1
        expect(parsed.days[0].day).toBe(1);
        expect(parsed.days[0].date).toBe("2026-10-01");
        expect(parsed.days[0].title).toBe("第一天行程");
        // Day 2 (自動補齊)
        expect(parsed.days[1].day).toBe(2);
        expect(parsed.days[1].date).toBe("2026-10-02");
        expect(parsed.days[1].title).toBe("自由活動");
        expect(parsed.days[1].timeline).toEqual([]);
        // Day 3
        expect(parsed.days[2].day).toBe(3);
        expect(parsed.days[2].date).toBe("2026-10-03");
        expect(parsed.days[2].title).toBe("第三天行程");
    });

    it("自動由第一天的第一個事件時間推算 trip.departure，若無時間則回退至 00:00:00", () => {
        const withTimedEvent = [
            "trip:",
            "  name: '出發時間推算測試'",
            `  hotels:${validHotel}`,
            "days:",
            "  - date: '2026-10-01'",
            "    title: '第一天'",
            "    timeline:",
            "      - time: '08:30 - 10:00'",
            "        title: '集合出發'",
            "        type: booked",
        ].join("\n");
        const parsedTimed = validateYaml(withTimedEvent);
        expect(parsedTimed.trip.departure).toBe("2026-10-01T08:30:00");

        const withoutTimeEvent = [
            "trip:",
            "  name: '出發時間回退測試'",
            `  hotels:${validHotel}`,
            "days:",
            "  - date: '2026-10-01'",
            "    title: '第一天'",
            "    timeline: []",
        ].join("\n");
        const parsedUntimed = validateYaml(withoutTimeEvent);
        expect(parsedUntimed.trip.departure).toBe("2026-10-01T00:00:00");
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

const validStops = [
    "",
    "        stops:",
    "          - name: '西班牙階梯'",
    "            localName: 'Piazza di Spagna'",
    "          - name: '特雷維噴泉'",
    "            localName: 'Fontana di Trevi'",
    "            mapLink: 'https://maps.app.goo.gl/xyz'",
].join("\n");

describe("validateYaml — stops 形狀", () => {
    it("接受完整的地點清單", () => {
        const data = validateYaml(timelineYaml(bookedEvent + validStops));
        expect(data.days[0].timeline[0].stops).toEqual([
            { name: "西班牙階梯", localName: "Piazza di Spagna" },
            { name: "特雷維噴泉", localName: "Fontana di Trevi", mapLink: "https://maps.app.goo.gl/xyz" },
        ]);
    });

    it("接受只有 name 的地點 (只是不會有地圖按鈕)", () => {
        const data = validateYaml(timelineYaml(`${bookedEvent}\n        stops:\n          - name: '納沃納廣場'`));
        expect(data.days[0].timeline[0].stops).toEqual([{ name: "納沃納廣場" }]);
    });

    it("拒絕非列表的 stops", () => {
        expect(() => validateYaml(timelineYaml(`${bookedEvent}\n        stops: '萬神殿'`)))
            .toThrow("days 第 1 項的 timeline 第 1 項的 stops 必須是列表");
    });

    it("拒絕空白列表項並指出項次", () => {
        expect(() => validateYaml(timelineYaml(`${bookedEvent}\n        stops:\n          - name: '萬神殿'\n          -`)))
            .toThrow("days 第 1 項的 timeline 第 1 項的 stops 第 2 項必須是物件 (不可為空白列表項)");
    });

    it("拒絕缺少 name 的項目 (alternatives 用 title，stops 用 name)", () => {
        expect(() => validateYaml(timelineYaml(`${bookedEvent}\n        stops:\n          - localName: 'Pantheon'`)))
            .toThrow("days 第 1 項的 timeline 第 1 項的 stops 第 1 項缺少 name 屬性");
    });

    it("拒絕非文字的選填欄位", () => {
        expect(() => validateYaml(timelineYaml(`${bookedEvent}\n        stops:\n          - name: '萬神殿'\n            localName: 123`)))
            .toThrow("days 第 1 項的 timeline 第 1 項的 stops 第 1 項的 localName 必須是文字");
    });
});

describe("validateYaml — 行內 Markdown 欄位的形狀", () => {
    // 這些欄位交給 markdown.ts 渲染，非文字會被靜靜丟掉而不是報錯，
    // 所以驗證這一關要替作者攔下來。缺欄位仍然合法：一直都只是少一行字。
    const plainEvent = [
        "",
        "      - time: '08:00'",
        "        title: '✈️ 班機'",
        "        type: booked",
    ].join("\n");

    it("接受缺少 desc 的事件", () => {
        const data = validateYaml(timelineYaml(plainEvent));
        expect(data.days[0].timeline[0].desc).toBeUndefined();
    });

    it("拒絕非文字的 desc", () => {
        expect(() => validateYaml(timelineYaml(`${plainEvent}\n        desc: 2024`)))
            .toThrow("days 第 1 項的 timeline 第 1 項的 desc 必須是文字");
    });

    it("拒絕非列表的 bullets", () => {
        expect(() => validateYaml(timelineYaml(`${bookedEvent}\n        bullets: '提早 15 分鐘'`)))
            .toThrow("days 第 1 項的 timeline 第 1 項的 bullets 必須是列表");
    });

    it("拒絕非文字的 bullets 項目並指出項次", () => {
        expect(() => validateYaml(timelineYaml(`${bookedEvent}\n        bullets:\n          - '提早 15 分鐘'\n          - 42`)))
            .toThrow("days 第 1 項的 timeline 第 1 項的 bullets 第 2 項 必須是文字");
    });

    it("拒絕空白的 bullets 列表項", () => {
        expect(() => validateYaml(timelineYaml(`${bookedEvent}\n        bullets:\n          - '提早 15 分鐘'\n          -`)))
            .toThrow("days 第 1 項的 timeline 第 1 項的 bullets 第 2 項必須是文字 (不可為空白列表項)");
    });

    it("拒絕非文字的 localName 與 mapLink (渲染時會被靜靜丟掉)", () => {
        expect(() => validateYaml(timelineYaml(`${bookedEvent}\n        mapLink: 20240101`)))
            .toThrow("days 第 1 項的 timeline 第 1 項的 mapLink 必須是文字");
        expect(() => validateYaml(timelineYaml(`${bookedEvent}\n        localName: 123`)))
            .toThrow("days 第 1 項的 timeline 第 1 項的 localName 必須是文字");
    });

    it("拒絕非文字的 todo / packing text", () => {
        expect(() => validateYaml(`${timelineYaml(bookedEvent)}\ntodo:\n  - text: 123`))
            .toThrow("todo 第 1 項的 text 必須是文字");
        expect(() => validateYaml(`${timelineYaml(bookedEvent)}\npacking:\n  - text: [a, b]`))
            .toThrow("packing 第 1 項的 text 必須是文字");
    });
});

describe("validateYaml — links 形狀", () => {
    it("接受完整的連結清單", () => {
        const data = validateYaml(timelineYaml(`${bookedEvent}\n        links:\n          - label: '官網'\n            url: 'https://example.com'`));
        expect(data.days[0].timeline[0].links).toEqual([{ label: "官網", url: "https://example.com" }]);
    });

    it("拒絕非列表的 links", () => {
        expect(() => validateYaml(timelineYaml(`${bookedEvent}\n        links: 'https://example.com'`)))
            .toThrow("days 第 1 項的 timeline 第 1 項的 links 必須是列表");
    });

    it("拒絕缺少 url 或 label 的項目", () => {
        expect(() => validateYaml(timelineYaml(`${bookedEvent}\n        links:\n          - label: '官網'`)))
            .toThrow("days 第 1 項的 timeline 第 1 項的 links 第 1 項缺少 url 屬性");
        expect(() => validateYaml(timelineYaml(`${bookedEvent}\n        links:\n          - url: 'https://example.com'`)))
            .toThrow("days 第 1 項的 timeline 第 1 項的 links 第 1 項缺少 label 屬性");
    });

    it("拒絕非文字的 url", () => {
        expect(() => validateYaml(timelineYaml(`${bookedEvent}\n        links:\n          - label: '官網'\n            url: 20240101`)))
            .toThrow("days 第 1 項的 timeline 第 1 項的 links 第 1 項的 url 必須是文字");
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
    ].join("\n") + validAlternatives + validStops;

    const richYaml = [
        timelineYaml(richEvent),
        "todo:",
        "  - text: '換錢'",
        "    checked: true",
        "    id: 'legacy-1'",
        "packing:",
        "  - text: '充電器'",
    ].join("\n");

    it("剝除 runtime _id 與 legacy checklist id，且不輸出 trip.start、trip.end、trip.departure 與 day.day", () => {
        const data = validateYaml(richYaml);
        expect(data.days[0].timeline[0]._id).toBeTruthy();
        expect(data.todo[0]._id).toBeTruthy();
        expect(data.trip.start).toBe("2026-06-11");
        expect(data.trip.end).toBe("2026-06-11");
        expect(data.trip.departure).toBe("2026-06-11T08:00:00");
        expect(data.days[0].day).toBe(1);

        const yaml = serializeToYaml(data);
        expect(yaml).not.toContain("_id");
        expect(yaml).not.toContain("legacy-1");
        expect(yaml).not.toMatch(/^\s+start:/m);
        expect(yaml).not.toMatch(/^\s+end:/m);
        expect(yaml).not.toMatch(/^\s+departure:/m);
        expect(yaml).not.toMatch(/^\s+day:\s*\d+/m);
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

    it("status / confirmation / alternatives / stops 經 round-trip 不遺失", () => {
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
        expect(ev.stops).toEqual([
            { name: "西班牙階梯", localName: "Piazza di Spagna" },
            { name: "特雷維噴泉", localName: "Fontana di Trevi", mapLink: "https://maps.app.goo.gl/xyz" },
        ]);
        expect(data.todo[0]).toMatchObject({ text: "換錢", checked: true });
        expect(data.packing[0]).toMatchObject({ text: "充電器" });
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

describe("YAML alias bomb", () => {
    it("rejects excessive aliasing instead of expanding it (share links carry other people's YAML)", () => {
        const bomb = "anchor: &x '爆'\nlist: [" + Array(150).fill("*x").join(",") + "]";
        expect(() => validateYaml(bomb)).toThrow(/alias/i);
    });

    it("still allows a document with a few aliases", () => {
        // Not a trip shape, so it fails structure validation — the point is it
        // must get PAST the alias guard and fail on structure instead.
        const fewAliases = "anchor: &x 'ok'\nlist: [*x,*x,*x]";
        expect(() => validateYaml(fewAliases)).toThrow("YAML 缺少必要的結構");
    });
});

describe("validateYaml — schema 補上的形狀檢查", () => {
    it("事件缺少 time / title / type 時指出項次，而不是等到旅行當天才在時間軸炸掉", () => {
        expect(() => validateYaml(timelineYaml("\n      - title: '沒有時間'\n        type: standard")))
            .toThrow("days 第 1 項的 timeline 第 1 項缺少 time 屬性");
        expect(() => validateYaml(timelineYaml("\n      - time: '08:00'\n        type: standard")))
            .toThrow("days 第 1 項的 timeline 第 1 項缺少 title 屬性");
        expect(() => validateYaml(timelineYaml("\n      - time: '08:00'\n        title: '沒有類型'")))
            .toThrow("days 第 1 項的 timeline 第 1 項缺少 type 屬性");
    });

    it("拒絕數字的 time (未加引號的 800) 與未知的 type", () => {
        expect(() => validateYaml(timelineYaml("\n      - time: 800\n        title: '早餐'\n        type: standard")))
            .toThrow("days 第 1 項的 timeline 第 1 項的 time 必須是文字");
        expect(() => validateYaml(timelineYaml("\n      - time: '08:00'\n        title: '早餐'\n        type: banana")))
            .toThrow("days 第 1 項的 timeline 第 1 項的 type 必須是 'booked'、'must-go'、'standard' 或 'option'");
    });

    it("checked 必須是布林：YAML 1.2 把 no/off 讀成文字，勾選狀態會反轉", () => {
        expect(() => validateYaml([validTripBlock, validDaysBlock, "todo:", "  - text: '換錢'", "    checked: no"].join("\n")))
            .toThrow("todo 第 1 項的 checked 必須是 true 或 false");
    });

    it("expenses 每筆都要有 name / amount / type / date，且 amount 必須是數字", () => {
        const expense = (fields: string) => [validTripBlock, validDaysBlock, "expenses:", fields].join("\n");
        expect(() => validateYaml(expense("  - amount: 1200\n    type: Cash\n    date: '2026-06-11'")))
            .toThrow("expenses 第 1 項缺少 name 屬性");
        expect(() => validateYaml(expense("  - name: '午餐'\n    amount: '1200'\n    type: Cash\n    date: '2026-06-11'")))
            .toThrow("expenses 第 1 項的 amount 必須是數字");
        expect(() => validateYaml(expense("  - name: '午餐'\n    amount: 1200\n    date: '2026-06-11'")))
            .toThrow("expenses 第 1 項缺少 type 屬性");
    });

    it("hotels 的 checkIn / checkOut 必須是 YYYY-MM-DD，否則退房節點會靜靜消失", () => {
        const slashDates = validHotel.replace("checkIn: '2026-06-11'", "checkIn: '2026/06/11'");
        expect(() => validateYaml(tripYaml(slashDates)))
            .toThrow("hotels 第 1 項的 checkIn 必須是 YYYY-MM-DD 日期格式");
    });

    it("trip.wallets 去重：Ledger 以錢包名稱當 key，重複會在 production 拋錯", () => {
        const data = validateYaml([validTripBlock, "  wallets: [Suica, WOWPASS, Suica]", validDaysBlock].join("\n"));
        expect(data.trip.wallets).toEqual(["Suica", "WOWPASS"]);
    });

    it("trip.wallets 必須是文字列表，trip.mapProvider 只接受 naver / google", () => {
        expect(() => validateYaml([validTripBlock, "  wallets: Suica", validDaysBlock].join("\n")))
            .toThrow("trip.wallets 必須是文字列表");
        expect(() => validateYaml([validTripBlock, "  mapProvider: apple", validDaysBlock].join("\n")))
            .toThrow("trip.mapProvider 必須是 'naver' 或 'google'");
    });

    it("不認識的欄位在載入時被剝掉，所以存檔後不會再出現", () => {
        const data = validateYaml([validTripBlock, "  notes: '不在 schema 裡'", validDaysBlock.replace("    timeline: []", "    mapLnk: 'typo'\n    timeline: []")].join("\n"));
        expect((data.trip as unknown as { notes?: string; }).notes).toBeUndefined();
        expect((data.days[0] as unknown as { mapLnk?: string; }).mapLnk).toBeUndefined();
        expect(serializeToYaml(data)).not.toMatch(/notes|mapLnk/);
    });

    it("欄位值留空 (YAML 的 null) 一律視為未填：選填欄位過關，必填欄位回報缺少", () => {
        expect(validateYaml(timelineYaml("\n      - time: '08:00'\n        title: '早餐'\n        type: standard\n        desc:")).days[0].timeline[0].desc).toBeUndefined();
        expect(() => validateYaml(timelineYaml("\n      - time:\n        title: '早餐'\n        type: standard")))
            .toThrow("days 第 1 項的 timeline 第 1 項缺少 time 屬性");
    });
});

describe("validateYaml — 日期的語意檢查", () => {
    const days = (...entries: string[]) => [validTripBlock, "days:", ...entries].join("\n");
    const day = (date: string) => `  - date: '${date}'\n    title: '市區'\n    timeline: []`;

    it("拒絕通過格式卻不存在於月曆上的日期 (Date 會把 2026-02-30 滾成 3 月 2 日)", () => {
        expect(() => validateYaml(days(day("2026-02-30"))))
            .toThrow("days 第 1 項的 date 不是有效的日期 (2026-02-30)");
        expect(() => validateYaml(tripYaml(validHotel.replace("checkOut: '2026-06-12'", "checkOut: '2026-13-01'"))))
            .toThrow("hotels 第 1 項的 checkOut 不是有效的日期 (2026-13-01)");
    });

    it("拒絕兩天同一個日期，並以作者的順序指出兩個項次", () => {
        expect(() => validateYaml(days(day("2026-06-12"), day("2026-06-11"), day("2026-06-12"))))
            .toThrow("days 第 1 項與第 3 項的 date 重複 (2026-06-12)");
    });

    it("相鄰兩天相隔超過 90 天視為打錯 (少打一位年份會補出上萬個自由日並寫回 YAML)", () => {
        expect(() => validateYaml(days(day("2026-01-01"), day("2062-01-01"))))
            .toThrow("days 第 1 項 (2026-01-01) 與第 2 項 (2062-01-01) 相隔 13149 天，超過 90 天的上限，請確認日期是否打錯");
        expect(validateYaml(days(day("2026-01-01"), day("2026-04-01"))).days).toHaveLength(91);
    });
});
