import {
    describe,
    expect,
    it,
} from "vitest";
import { getLanguageConfig } from "./phrases";

describe("getLanguageConfig", () => {
    it("resolves a known trip.lang to its own deck", () => {
        expect(getLanguageConfig("ko").label).toBe("韓文");
        expect(getLanguageConfig("ja").label).toBe("日文");
        expect(getLanguageConfig("en").label).toBe("英文");
    });

    it("falls back to English for an unset or unknown lang instead of an empty deck", () => {
        const english = getLanguageConfig("en");
        expect(getLanguageConfig(undefined)).toBe(english);
        expect(getLanguageConfig("")).toBe(english);
        expect(getLanguageConfig("fr")).toBe(english);
    });

    it("every language carries a driver prompt and a usable deck", () => {
        for (const lang of ["ko", "ja", "en"]) {
            const config = getLanguageConfig(lang);
            expect(config.driverPrompt).not.toBe("");
            expect(config.phrases.length).toBeGreaterThan(0);
            for (const phrase of config.phrases) {
                expect(phrase.zh).not.toBe("");
                expect(phrase.text).not.toBe("");
            }
        }
    });
});
