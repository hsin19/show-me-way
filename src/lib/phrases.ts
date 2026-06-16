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
            // 基本
            { zh: "您好", text: "안녕하세요", rom: "An-nyeong-ha-se-yo", cat: "basic" },
            { zh: "謝謝", text: "감사합니다", rom: "Gam-sa-ham-ni-da", cat: "basic" },
            { zh: "對不起", text: "죄송합니다", rom: "Joe-song-ham-ni-da", cat: "basic" },
            { zh: "我聽不懂韓文", text: "한국어를 잘 못해요", rom: "Han-gug-eo-reul jal mot-hae-yo", cat: "basic" },
            { zh: "洗手間在哪裡？", text: "화장실이 어디예요?", rom: "Hwa-jang-sil-i eo-di-ye-yo?", cat: "basic" },
            { zh: "可以幫我拍照嗎？", text: "사진 찍어 주실 수 있어요?", rom: "Sa-jin jji-geo ju-sil su iss-eo-yo?", cat: "basic" },
            // 交通
            { zh: "請到這個地址", text: "이 주소로 가주세요", rom: "I ju-so-ro ga-ju-se-yo", cat: "transport" },
            { zh: "請在這裡停車", text: "여기서 세워 주세요", rom: "Yeo-gi-seo se-wo ju-se-yo", cat: "transport" },
            { zh: "地鐵站在哪裡？", text: "지하철역이 어디예요?", rom: "Ji-ha-cheol-yeok-i eo-di-ye-yo?", cat: "transport" },
            { zh: "到機場多少錢？", text: "공항까지 얼마예요?", rom: "Gong-hang-kka-ji eol-ma-ye-yo?", cat: "transport" },
            { zh: "請打開後車廂", text: "트렁크 좀 열어 주세요", rom: "Teu-reong-keu jom yeol-eo ju-se-yo", cat: "transport" },
            // 點餐
            { zh: "不好意思 (叫服務生)", text: "저기요", rom: "Jeo-gi-yo", cat: "dining" },
            { zh: "請給我這個", text: "이거 주세요", rom: "I-geo ju-se-yo", cat: "dining" },
            { zh: "有中文菜單嗎？", text: "중국어 메뉴판 있어요?", rom: "Jung-gug-eo me-nyu-pan is-seo-yo?", cat: "dining" },
            { zh: "不要太辣", text: "안 맵게 해주세요", rom: "An maep-ge hae-ju-se-yo", cat: "dining" },
            { zh: "我要內用", text: "여기서 먹을게요", rom: "Yeo-gi-seo meo-geul-ge-yo", cat: "dining" },
            { zh: "我要外帶", text: "포장해 주세요", rom: "Po-jang-hae ju-se-yo", cat: "dining" },
            { zh: "請給我水", text: "물 주세요", rom: "Mul ju-se-yo", cat: "dining" },
            { zh: "請幫我結帳", text: "계산해 주세요", rom: "Gye-san-hae ju-se-yo", cat: "dining" },
            // 購物
            { zh: "多少錢？", text: "얼마예요?", rom: "Eol-ma-ye-yo?", cat: "shopping" },
            { zh: "可以刷卡嗎？", text: "카드 되나요?", rom: "Ka-deu doe-na-yo?", cat: "shopping" },
            { zh: "可以便宜一點嗎？", text: "좀 깎아 주세요", rom: "Jom kka-kka ju-se-yo", cat: "shopping" },
            { zh: "可以退稅嗎？", text: "택스 리펀 되나요?", rom: "Taek-seu ri-peon doe-na-yo?", cat: "shopping" },
            { zh: "有其他顏色嗎？", text: "다른 색깔 있어요?", rom: "Da-reun saek-kkal iss-eo-yo?", cat: "shopping" },
            // 求助
            { zh: "請幫幫我", text: "도와주세요", rom: "Do-wa-ju-se-yo", cat: "help" },
            { zh: "請叫救護車", text: "구급차를 불러 주세요", rom: "Gu-geup-cha-reul bul-leo ju-se-yo", cat: "help" },
            { zh: "請叫警察", text: "경찰을 불러 주세요", rom: "Gyeong-chal-eul bul-leo ju-se-yo", cat: "help" },
            { zh: "我對這個過敏", text: "이거 알레르기 있어요", rom: "I-geo al-le-reu-gi iss-eo-yo", cat: "help" },
            { zh: "我的東西掉了", text: "물건을 잃어버렸어요", rom: "Mul-geon-eul i-reo-beo-ryeo-sseo-yo", cat: "help" },
            { zh: "我迷路了", text: "길을 잃었어요", rom: "Gi-reul i-reo-sseo-yo", cat: "help" },
        ],
    },
    ja: {
        label: "日文",
        driverPrompt: "運転手さん、ここまでお願いします (司機先生，請載我去這)：",
        copyAddressLabel: "複製日文地址",
        phrases: [
            // 基本
            { zh: "您好", text: "こんにちは", rom: "Kon-ni-chi-wa", cat: "basic" },
            { zh: "謝謝", text: "ありがとうございます", rom: "A-ri-ga-to-go-za-i-ma-su", cat: "basic" },
            { zh: "對不起", text: "ごめんなさい", rom: "Go-men-na-sa-i", cat: "basic" },
            { zh: "我聽不懂日文", text: "日本語がわかりません", rom: "Ni-hon-go ga wa-ka-ri-ma-sen", cat: "basic" },
            { zh: "洗手間在哪裡？", text: "トイレはどこですか？", rom: "To-i-re wa do-ko-de-su-ka?", cat: "basic" },
            { zh: "可以幫我拍照嗎？", text: "写真を撮ってもらえますか？", rom: "Sha-shin o tot-te mo-ra-e-ma-su-ka?", cat: "basic" },
            // 交通
            { zh: "請到這個地址", text: "この住所までお願いします", rom: "Ko-no ju-sho ma-de o-ne-gai-shi-ma-su", cat: "transport" },
            { zh: "請在這裡停車", text: "ここで止めてください", rom: "Ko-ko de to-me-te ku-da-sa-i", cat: "transport" },
            { zh: "地鐵站在哪裡？", text: "地下鉄の駅はどこですか？", rom: "Chi-ka-te-tsu no e-ki wa do-ko-de-su-ka?", cat: "transport" },
            { zh: "到機場多少錢？", text: "空港までいくらですか？", rom: "Ku-ko ma-de i-ku-ra-de-su-ka?", cat: "transport" },
            { zh: "請打開後車廂", text: "トランクを開けてください", rom: "To-ran-ku o a-ke-te ku-da-sa-i", cat: "transport" },
            // 點餐
            { zh: "不好意思 (叫服務生)", text: "すみません", rom: "Su-mi-ma-sen", cat: "dining" },
            { zh: "請給我這個", text: "これをください", rom: "Ko-re-o ku-da-sa-i", cat: "dining" },
            { zh: "有中文菜單嗎？", text: "中国語のメニューはありますか？", rom: "Chu-go-ku-go no me-nyu wa a-ri-ma-su-ka?", cat: "dining" },
            { zh: "不要芥末", text: "わさび抜きでお願いします", rom: "Wa-sa-bi nu-ki de o-ne-gai-shi-ma-su", cat: "dining" },
            { zh: "我要內用", text: "店内で食べます", rom: "Ten-nai de ta-be-ma-su", cat: "dining" },
            { zh: "我要外帶", text: "持ち帰りでお願いします", rom: "Mo-chi-ka-e-ri de o-ne-gai-shi-ma-su", cat: "dining" },
            { zh: "請給我水", text: "お水をください", rom: "O-mizu-o ku-da-sa-i", cat: "dining" },
            { zh: "請幫我結帳", text: "お会計お願いします", rom: "O-kai-kei o-ne-gai-shi-ma-su", cat: "dining" },
            // 購物
            { zh: "多少錢？", text: "いくらですか？", rom: "I-ku-ra-de-su-ka?", cat: "shopping" },
            { zh: "可以刷卡嗎？", text: "カードは使えますか？", rom: "Ka-do wa tsu-ka-e-ma-su-ka?", cat: "shopping" },
            { zh: "可以便宜一點嗎？", text: "安くしてもらえますか？", rom: "Ya-su-ku shi-te mo-ra-e-ma-su-ka?", cat: "shopping" },
            { zh: "可以退稅嗎？", text: "免税できますか？", rom: "Men-zei de-ki-ma-su-ka?", cat: "shopping" },
            { zh: "有其他顏色嗎？", text: "他の色はありますか？", rom: "Ho-ka no i-ro wa a-ri-ma-su-ka?", cat: "shopping" },
            // 求助
            { zh: "請幫幫我", text: "助けてください", rom: "Ta-su-ke-te ku-da-sa-i", cat: "help" },
            { zh: "請叫救護車", text: "救急車を呼んでください", rom: "Kyu-kyu-sha o yon-de ku-da-sa-i", cat: "help" },
            { zh: "請叫警察", text: "警察を呼んでください", rom: "Kei-sa-tsu o yon-de ku-da-sa-i", cat: "help" },
            { zh: "我對這個過敏", text: "これにアレルギーがあります", rom: "Ko-re ni a-re-ru-gi ga a-ri-ma-su", cat: "help" },
            { zh: "我的東西掉了", text: "物をなくしました", rom: "Mo-no o na-ku-shi-ma-shi-ta", cat: "help" },
            { zh: "我迷路了", text: "道に迷いました", rom: "Mi-chi ni ma-yo-i-ma-shi-ta", cat: "help" },
        ],
    },
    en: {
        label: "英文",
        driverPrompt: "Please take me to this address (司機先生，請載我去這)：",
        copyAddressLabel: "複製英文地址",
        phrases: [
            // 基本
            { zh: "您好", text: "Hello", rom: "", cat: "basic" },
            { zh: "謝謝", text: "Thank you", rom: "", cat: "basic" },
            { zh: "對不起", text: "I'm sorry.", rom: "", cat: "basic" },
            { zh: "請說慢一點", text: "Could you speak slowly, please?", rom: "", cat: "basic" },
            { zh: "洗手間在哪裡？", text: "Where is the restroom?", rom: "", cat: "basic" },
            { zh: "可以幫我拍照嗎？", text: "Could you take a photo for me?", rom: "", cat: "basic" },
            // 交通
            { zh: "請到這個地址", text: "Please take me to this address.", rom: "", cat: "transport" },
            { zh: "請在這裡停車", text: "Please stop here.", rom: "", cat: "transport" },
            { zh: "地鐵站在哪裡？", text: "Where is the subway station?", rom: "", cat: "transport" },
            { zh: "到機場多少錢？", text: "How much is it to the airport?", rom: "", cat: "transport" },
            { zh: "請打開後車廂", text: "Could you open the trunk, please?", rom: "", cat: "transport" },
            // 點餐
            { zh: "不好意思 (叫服務生)", text: "Excuse me", rom: "", cat: "dining" },
            { zh: "請給我這個", text: "Can I have this, please?", rom: "", cat: "dining" },
            { zh: "有中文菜單嗎？", text: "Do you have a Chinese menu?", rom: "", cat: "dining" },
            { zh: "有什麼推薦的？", text: "What do you recommend?", rom: "", cat: "dining" },
            { zh: "我要內用", text: "For here, please.", rom: "", cat: "dining" },
            { zh: "我要外帶", text: "To go, please.", rom: "", cat: "dining" },
            { zh: "請給我水", text: "Water, please.", rom: "", cat: "dining" },
            { zh: "請幫我結帳", text: "Check, please.", rom: "", cat: "dining" },
            // 購物
            { zh: "多少錢？", text: "How much is it?", rom: "", cat: "shopping" },
            { zh: "可以刷卡嗎？", text: "Can I pay by card?", rom: "", cat: "shopping" },
            { zh: "可以便宜一點嗎？", text: "Could you give me a discount?", rom: "", cat: "shopping" },
            { zh: "可以退稅嗎？", text: "Can I get a tax refund?", rom: "", cat: "shopping" },
            { zh: "有其他顏色嗎？", text: "Do you have this in another color?", rom: "", cat: "shopping" },
            // 求助
            { zh: "請幫幫我", text: "Please help me.", rom: "", cat: "help" },
            { zh: "請叫救護車", text: "Please call an ambulance.", rom: "", cat: "help" },
            { zh: "請叫警察", text: "Please call the police.", rom: "", cat: "help" },
            { zh: "我對這個過敏", text: "I'm allergic to this.", rom: "", cat: "help" },
            { zh: "我的東西掉了", text: "I lost my belongings.", rom: "", cat: "help" },
            { zh: "我迷路了", text: "I'm lost.", rom: "", cat: "help" },
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
