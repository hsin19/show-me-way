import {
    type DailyWeather,
    type DailyWeatherByDate,
    loadDailyWeather,
    resolveTripCity,
    staleAgeHours,
} from "../infra/api/weather";
import type { DayItinerary } from "../infra/storage/api";

export class WeatherStore {
    byCity = $state<Record<string, { byDate: DailyWeatherByDate; fetchedAt: number; }>>({});

    /** For a different trip, where the previous trip's cities are no longer relevant. */
    loadTrip(days: DayItinerary[], defaultCity?: string) {
        this.byCity = {};
        this.refresh(days, defaultCity);
    }

    /**
     * Keeps what is already on screen. Cache-first (3h TTL in lib/infra/api/weather.ts),
     * so calling it repeatedly costs nothing until the data is actually stale.
     */
    refresh(days: DayItinerary[], defaultCity?: string) {
        const cities: string[] = [];
        for (const day of days) {
            const city = resolveTripCity(day.city, defaultCity);
            if (city && !cities.includes(city)) cities.push(city);
        }
        for (const city of cities) {
            loadDailyWeather(city, (byDate, fetchedAt) => {
                this.byCity[city] = {
                    byDate: { ...this.byCity[city]?.byDate, ...byDate },
                    fetchedAt,
                };
            });
        }
    }

    /** Null past the 16-day forecast horizon, which hides the badge. */
    forDay(day: DayItinerary, defaultCity?: string): DailyWeather | null {
        const city = resolveTripCity(day.city, defaultCity);
        if (!city) return null;
        return this.byCity[city]?.byDate[day.date] ?? null;
    }

    /** Open-Meteo data is CC BY 4.0 — show the attribution whenever any badge does. */
    hasAttribution(days: DayItinerary[], defaultCity?: string): boolean {
        return days.some(d => this.forDay(d, defaultCity) !== null);
    }

    /** Stale age in hours across all cities present in the trip. */
    getStaleAgeHours(days: DayItinerary[], defaultCity: string | undefined, clockTime: number): number | null {
        let oldest: number | null = null;
        for (const day of days) {
            const city = resolveTripCity(day.city, defaultCity);
            if (!city) continue;
            const entry = this.byCity[city];
            if (!entry || !entry.byDate[day.date]) continue;
            if (oldest === null || entry.fetchedAt < oldest) oldest = entry.fetchedAt;
        }
        return staleAgeHours(oldest, clockTime);
    }
}

export const weatherStore = new WeatherStore();
