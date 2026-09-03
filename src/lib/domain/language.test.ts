import {
    describe,
    expect,
    it,
} from "vitest";
import { getLanguageConfig } from "./language";

describe("getLanguageConfig", () => {
    it("resolves a known trip.lang to its own driver prompt", () => {
        expect(getLanguageConfig("ko").driverPrompt).toContain("기사님");
        expect(getLanguageConfig("ja").driverPrompt).toContain("運転手さん");
        expect(getLanguageConfig("en").driverPrompt).toContain("Please take me");
    });

    it("falls back to English for an unset or unknown lang", () => {
        const english = getLanguageConfig("en");
        expect(getLanguageConfig(undefined)).toBe(english);
        expect(getLanguageConfig("")).toBe(english);
        expect(getLanguageConfig("fr")).toBe(english);
    });
});
