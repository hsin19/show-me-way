import {
    describe,
    expect,
    it,
} from "vitest";
import { weatherCodeInfo } from "./weather";

describe("weatherCodeInfo", () => {
    it("maps the main WMO codes to icons and zh-TW labels", () => {
        expect(weatherCodeInfo(0)).toEqual({ icon: "sun", label: "晴朗" });
        expect(weatherCodeInfo(2)).toEqual({ icon: "cloud-sun", label: "多雲時晴" });
        expect(weatherCodeInfo(3)).toEqual({ icon: "cloud", label: "陰天" });
        expect(weatherCodeInfo(45).icon).toBe("fog");
        expect(weatherCodeInfo(55).icon).toBe("drizzle");
        expect(weatherCodeInfo(63)).toEqual({ icon: "rain", label: "中雨" });
        expect(weatherCodeInfo(75)).toEqual({ icon: "snow", label: "大雪" });
        expect(weatherCodeInfo(82)).toEqual({ icon: "rain", label: "強陣雨" });
        expect(weatherCodeInfo(95).icon).toBe("thunder");
        expect(weatherCodeInfo(99).icon).toBe("thunder");
    });

    it("falls back to a cloud for unknown codes", () => {
        expect(weatherCodeInfo(42).icon).toBe("cloud");
        expect(weatherCodeInfo(-1).icon).toBe("cloud");
    });
});
