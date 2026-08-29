import type { DayItinerary } from "$lib/domain/trip";
import {
    describe,
    expect,
    it,
} from "vitest";
import { WeatherStore } from "./weather.svelte";

describe("WeatherStore", () => {
    it("initializes with empty weather map", () => {
        const store = new WeatherStore();
        expect(store.byCity).toEqual({});
        expect(store.hasAttribution([])).toBe(false);
    });

    it("returns null for days when no weather is loaded", () => {
        const store = new WeatherStore();
        const day: DayItinerary = {
            day: 1,
            date: "2025-01-01",
            pace: "輕鬆",
            timeline: [],
            title: "Day 1",
        };
        expect(store.forDay(day)).toBeNull();
        expect(store.getStaleAgeHours([day], undefined, Date.now())).toBeNull();
    });
});
