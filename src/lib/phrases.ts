import type { PhraseInfo } from "./api";

/**
 * Built-in, hard-coded survival phrases keyed by language code (`trip.lang`).
 * Phrases are no longer authored in the itinerary YAML — the trip only picks a
 * language, and the matching set (plus the localized taxi-driver prompt) is
 * resolved from here. Add a new language by adding an entry below.
 */
export interface LanguageConfig {
    /** Human-readable language name (zh-TW), e.g. used in labels. */
    label: string;
    /** Prompt shown on the fullscreen "show this to the driver" card. */
    driverPrompt: string;
    /** Label for the button that copies the hotel address. */
    copyAddressLabel: string;
    /** The survival phrase deck for this language. */
    phrases: PhraseInfo[];
}

export const LANGUAGES: Record<string, LanguageConfig> = {
    ko: {
        label: "韓文",
        driverPrompt: "기사님, 여기로 가주세요 (司機先生，請載我去這)：",
        copyAddressLabel: "複製韓文地址",
        phrases: [
            { zh: "您好", text: "안녕하세요", rom: "An-nyeong-ha-se-yo" },
            { zh: "謝謝", text: "감사합니다", rom: "Gam-sa-ham-ni-da" },
            { zh: "不好意思 (叫服務生)", text: "저기요", rom: "Jeo-gi-yo" },
            { zh: "請給我這個", text: "이거 주세요", rom: "I-geo ju-se-yo" },
            { zh: "多少錢？", text: "얼마예요?", rom: "Eol-ma-ye-yo?" },
            { zh: "請幫我結帳", text: "계산해 주세요", rom: "Gye-san-hae ju-se-yo" },
            { zh: "可以刷卡嗎？", text: "카드 되나요?", rom: "Ka-deu doe-na-yo?" },
            { zh: "不要太辣", text: "안 맵게 해주세요", rom: "An maep-ge hae-ju-se-yo" },
            { zh: "我要內用", text: "여기서 먹을게요", rom: "Yeo-gi-seo meo-geul-ge-yo" },
            { zh: "請給我水", text: "물 주세요", rom: "Mul ju-se-yo" },
            { zh: "有中文菜單嗎？", text: "중국어 메뉴판 있어요?", rom: "Jung-gug-eo me-nyu-pan is-seo-yo?" },
            { zh: "洗手間在哪裡？", text: "화장실이 어디예요?", rom: "Hwa-jang-sil-i eo-di-ye-yo?" },
            { zh: "可以幫我拍照嗎？", text: "사진 찍어 주실 수 있어요?", rom: "Sa-jin jji-geo ju-sil su iss-eo-yo?" },
        ],
    },
    ja: {
        label: "日文",
        driverPrompt: "運転手さん、ここまでお願いします (司機先生，請載我去這)：",
        copyAddressLabel: "複製日文地址",
        phrases: [
            { zh: "您好", text: "こんにちは", rom: "Kon-ni-chi-wa" },
            { zh: "謝謝", text: "ありがとうございます", rom: "A-ri-ga-to-go-za-i-ma-su" },
            { zh: "不好意思 (叫服務生)", text: "すみません", rom: "Su-mi-ma-sen" },
            { zh: "請給我這個", text: "これをください", rom: "Ko-re-o ku-da-sa-i" },
            { zh: "多少錢？", text: "いくらですか？", rom: "I-ku-ra-de-su-ka?" },
            { zh: "請幫我結帳", text: "お会計お願いします", rom: "O-kai-kei o-ne-gai-shi-ma-su" },
            { zh: "可以刷卡嗎？", text: "カードは使えますか？", rom: "Ka-do wa tsu-ka-e-ma-su-ka?" },
            { zh: "不要芥末", text: "わさび抜きでお願いします", rom: "Wa-sa-bi nu-ki de o-ne-gai-shi-ma-su" },
            { zh: "我要內用", text: "店内で食べます", rom: "Ten-nai de ta-be-ma-su" },
            { zh: "請給我水", text: "お水をください", rom: "O-mizu-o ku-da-sa-i" },
            { zh: "有中文菜單嗎？", text: "中国語のメニューはありますか？", rom: "Chu-go-ku-go no me-nyu wa a-ri-ma-su-ka?" },
            { zh: "洗手間在哪裡？", text: "トイレはどこですか？", rom: "To-i-re wa do-ko-de-su-ka?" },
            { zh: "可以幫我拍照嗎？", text: "写真を撮ってもらえますか？", rom: "Sha-shin o tot-te mo-ra-e-ma-su-ka?" },
        ],
    },
    en: {
        label: "英文",
        driverPrompt: "Please take me to this address (司機先生，請載我去這)：",
        copyAddressLabel: "複製英文地址",
        phrases: [
            { zh: "您好", text: "Hello", rom: "" },
            { zh: "謝謝", text: "Thank you", rom: "" },
            { zh: "不好意思 (叫服務生)", text: "Excuse me", rom: "" },
            { zh: "請給我這個", text: "Can I have this, please?", rom: "" },
            { zh: "多少錢？", text: "How much is it?", rom: "" },
            { zh: "請幫我結帳", text: "Check, please.", rom: "" },
            { zh: "可以刷卡嗎？", text: "Can I pay by card?", rom: "" },
            { zh: "我要內用", text: "For here, please.", rom: "" },
            { zh: "請給我水", text: "Water, please.", rom: "" },
            { zh: "有中文菜單嗎？", text: "Do you have a Chinese menu?", rom: "" },
            { zh: "洗手間在哪裡？", text: "Where is the restroom?", rom: "" },
            { zh: "地鐵站在哪裡？", text: "Where is the subway station?", rom: "" },
            { zh: "可以幫我拍照嗎？", text: "Could you take a photo for me?", rom: "" },
        ],
    },
};

/** Default language used when `trip.lang` is unset or not a supported code. */
export const DEFAULT_LANG = "en";

/**
 * Resolve a language config from a `trip.lang` code. Falls back to English
 * (`DEFAULT_LANG`) when the code is missing or unsupported, so the phrase deck
 * and taxi-driver prompt are always available.
 */
export function getLanguageConfig(lang: string | undefined): LanguageConfig {
    return (lang && LANGUAGES[lang]) || LANGUAGES[DEFAULT_LANG];
}
