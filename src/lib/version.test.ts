import {
    describe,
    expect,
    it,
} from "vitest";
import {
    APP_VERSION,
    formatBuildDate,
} from "./version";

describe("formatBuildDate", () => {
    it("formats as YYYY-MM-DD in local time", () => {
        const iso = new Date(2026, 6, 1).toISOString();
        expect(formatBuildDate(iso)).toBe("2026-07-01");
    });

    it("zero-pads single-digit months and days", () => {
        const iso = new Date(2026, 0, 5).toISOString();
        expect(formatBuildDate(iso)).toBe("2026-01-05");
    });

    it("keeps two-digit months and days as-is", () => {
        const iso = new Date(2026, 11, 25).toISOString();
        expect(formatBuildDate(iso)).toBe("2026-12-25");
    });

    it("defaults to the injected build time", () => {
        expect(formatBuildDate()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
});

describe("APP_VERSION", () => {
    it("is a non-empty injected string", () => {
        expect(typeof APP_VERSION).toBe("string");
        expect(APP_VERSION.length).toBeGreaterThan(0);
    });
});
