/**
 * Per-language copy is code, not itinerary data: a trip only picks a `lang` and the
 * rest resolves from here. A new language also needs its code in the `lang` metadata
 * enum in `src/lib/domain/trip-schema.ts`.
 */
export interface LanguageConfig {
    /** Heading on the fullscreen card held up to a taxi driver. */
    driverPrompt: string;
}

const LANGUAGES = {
    ko: { driverPrompt: "기사님, 여기로 가주세요 (司機先生，請載我去這)：" },
    ja: { driverPrompt: "運転手さん、ここまでお願いします (司機先生，請載我去這)：" },
    en: { driverPrompt: "Please take me to this address (司機先生，請載我去這)：" },
} satisfies Record<string, LanguageConfig>;

/** Always returns a config — an unset or unknown `trip.lang` falls back to English rather than leaving the driver card without a heading. */
export function getLanguageConfig(lang: string | undefined): LanguageConfig {
    const known: Record<string, LanguageConfig | undefined> = LANGUAGES;
    return (lang && known[lang]) || LANGUAGES.en;
}
