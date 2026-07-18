import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from "vitest";
import {
    fetchDefaultYamlText,
    fetchItinerary,
    USER_YAML_KEY,
    validateYaml,
} from "./api";
// The bundled default template, read as raw text (the src tsconfig has no node
// types, so a Vite `?raw` import stands in for readFileSync here).
import defaultTemplateYaml from "../../public/itinerary.yaml?raw";

// Minimal valid itinerary used as the fetched / stored YAML body.
const minimalYaml = [
    "trip:",
    "  name: '測試行程'",
    "  start: '2026-06-11'",
    "  end: '2026-06-12'",
    "  departure: '2026-06-11T08:00:00+08:00'",
    "  hotels: []",
    "days:",
    "  - day: 1",
    "    date: '2026-06-11'",
    "    region: '市區'",
    "    pace: '輕鬆'",
    "    timeline: []",
].join("\n");

// What the Vite dev server / SW answers for a MISSING public file: the SPA
// fallback index.html with a 200 status — never a 404.
const SPA_FALLBACK_HTML = "<!doctype html>\n<html><head><title>ShowMeWay</title></head><body></body></html>";

const LOCAL_URL = "./itinerary.local.yaml";
const BUNDLED_URL = "./itinerary.yaml";

function createLocalStorageStub() {
    const store = new Map<string, string>();
    return {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => void store.set(key, value),
        removeItem: (key: string) => void store.delete(key),
        clear: () => store.clear(),
    };
}

/** Stub global fetch so each candidate URL resolves per the given plan. */
function stubFetch(plan: Record<string, () => Promise<Response>>) {
    const mock = vi.fn((url: string) => {
        const handler = plan[url];
        if (!handler) throw new Error(`Unexpected fetch: ${url}`);
        return handler();
    });
    vi.stubGlobal("fetch", mock);
    return mock;
}

const okYaml = (body: string) => () => Promise.resolve(new Response(body, { status: 200 }));
const okHtml = (body: string) => () => Promise.resolve(new Response(body, { status: 200, headers: { "content-type": "text/html" } }));
const notOk = (code: number) => () => Promise.resolve(new Response("nope", { status: code }));
const networkError = () => Promise.reject(new TypeError("Failed to fetch"));

describe("fetchDefaultYamlText — 候選檔案 fallback", () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it("local 回應 200 的 SPA fallback HTML 時，視為不存在並改抓 bundled", async () => {
        const mock = stubFetch({
            [LOCAL_URL]: okHtml(SPA_FALLBACK_HTML),
            [BUNDLED_URL]: okYaml(minimalYaml),
        });
        await expect(fetchDefaultYamlText()).resolves.toBe(minimalYaml);
        expect(mock).toHaveBeenCalledTimes(2);
        expect(mock.mock.calls.map(c => c[0])).toEqual([LOCAL_URL, BUNDLED_URL]);
    });

    it("local 為真正的 YAML 時直接回傳，不再抓 bundled", async () => {
        const localYaml = "trip:\n  name: '本機行程'";
        const mock = stubFetch({
            [LOCAL_URL]: okYaml(localYaml),
        });
        await expect(fetchDefaultYamlText()).resolves.toBe(localYaml);
        expect(mock).toHaveBeenCalledTimes(1);
    });

    it("local 抓取失敗 (離線 / 網路錯誤) 時 fallback 到 bundled", async () => {
        stubFetch({
            [LOCAL_URL]: networkError,
            [BUNDLED_URL]: okYaml(minimalYaml),
        });
        await expect(fetchDefaultYamlText()).resolves.toBe(minimalYaml);
    });

    it("local 回應非 OK 狀態時 fallback 到 bundled", async () => {
        stubFetch({
            [LOCAL_URL]: notOk(404),
            [BUNDLED_URL]: okYaml(minimalYaml),
        });
        await expect(fetchDefaultYamlText()).resolves.toBe(minimalYaml);
    });

    it("開頭有空白的 HTML 仍被判定為 HTML 而 fallback", async () => {
        stubFetch({
            [LOCAL_URL]: okYaml("\n  " + SPA_FALLBACK_HTML),
            [BUNDLED_URL]: okYaml(minimalYaml),
        });
        await expect(fetchDefaultYamlText()).resolves.toBe(minimalYaml);
    });

    it("兩個候選都拿不到 (404 / HTML) 時擲出錯誤", async () => {
        stubFetch({
            [LOCAL_URL]: notOk(404),
            [BUNDLED_URL]: okHtml(SPA_FALLBACK_HTML),
        });
        await expect(fetchDefaultYamlText()).rejects.toThrow(
            "Neither itinerary.local.yaml nor itinerary.yaml was found.",
        );
    });
});

describe("fetchItinerary — localStorage 優先於網路", () => {
    let storage: ReturnType<typeof createLocalStorageStub>;

    beforeEach(() => {
        storage = createLocalStorageStub();
        vi.stubGlobal("localStorage", storage);
        vi.spyOn(console, "error").mockImplementation(() => {});
    });
    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it("有使用者 YAML 時直接解析，完全不打網路", async () => {
        const mock = stubFetch({});
        storage.setItem(USER_YAML_KEY, minimalYaml);
        const data = await fetchItinerary();
        expect(data.trip.name).toBe("測試行程");
        expect(mock).not.toHaveBeenCalled();
    });

    it("沒有使用者 YAML 時 fallback 到抓取的預設檔", async () => {
        stubFetch({
            [LOCAL_URL]: okYaml(minimalYaml),
        });
        const data = await fetchItinerary();
        expect(data.trip.name).toBe("測試行程");
    });

    it("使用者 YAML 驗證失敗時重擲 zh-TW 錯誤", async () => {
        stubFetch({});
        storage.setItem(USER_YAML_KEY, "days: []");
        await expect(fetchItinerary()).rejects.toThrow("YAML 缺少必要的結構 (trip 或 days 區塊)");
    });

    it("空字串的使用者 YAML 視同不存在，fallback 到抓取 (|| 語意)", async () => {
        const mock = stubFetch({
            [LOCAL_URL]: okYaml(minimalYaml),
        });
        storage.setItem(USER_YAML_KEY, "");
        const data = await fetchItinerary();
        expect(data.trip.name).toBe("測試行程");
        expect(mock).toHaveBeenCalled();
    });
});

describe("預設範本 public/itinerary.yaml", () => {
    it("通過 validateYaml 且 trip.name 為範本名稱", () => {
        const data = validateYaml(defaultTemplateYaml);
        expect(data.trip.name).toBe("我的探索之旅 (範本)");
        expect(data.days.length).toBeGreaterThan(0);
    });
});
