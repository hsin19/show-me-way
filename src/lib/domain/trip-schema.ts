import * as v from "valibot";

/*
 * The authored itinerary document -- what a YAML file may contain -- declared
 * once. Three things are derived from it so they cannot drift apart: the runtime
 * gate (`normalizeTripData` parses with `itinerarySchema`), the TypeScript types
 * (inferred at the bottom of this file) and the editor's JSON Schema
 * (`scripts/gen-schema.ts` converts it into `schema/showmeway-schema.json`).
 *
 * Only the *shape* lives here. What the app derives from that shape -- sorting
 * and numbering `days`, gap-filling, minting `trip.id`, `start`/`end`/
 * `departure` -- and the cross-field checks (duplicate dates, date span) stay in
 * `trip.ts`, where the invariants are documented.
 *
 * `v.description` doubles as the field's documentation: the editor shows it on
 * hover and the itinerary-yaml-builder skill reads the generated schema instead
 * of a hand-kept field table, so write it for an author, not a maintainer.
 * `v.metadata` carries editor-only hints (`deprecated`, `readOnly`, `maxLength`,
 * `enum`) that the app deliberately does not enforce -- a title over the length
 * hint wraps, it does not fail to load -- and the generator spreads them into
 * the JSON Schema verbatim.
 */

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const MARKDOWN_HINT = "支援行內 Markdown：[說明](https://…)、**粗體**、*斜體*、`等寬`";
const LOCAL_NAME_DESC = "地點的當地語言名稱，作為地圖搜尋關鍵字 (點擊按鈕開啟地圖/複製)";
const MAP_LINK_DESC = "地圖直接連結 (如 naver.me / maps.app.goo.gl 短網址)。有設定時會優先使用，比關鍵字搜尋更精準。";

function text(description: string) {
    return v.pipe(v.string(), v.description(description));
}

function isoDate(description: string) {
    return v.pipe(v.string(), v.regex(ISO_DATE_PATTERN), v.description(description));
}

/** A field `normalizeTripData` overwrites: accepted so old files keep loading, flagged so the editor stops people writing it. */
function deprecated<TSchema extends v.GenericSchema>(schema: TSchema, description: string) {
    return v.optional(v.pipe(schema, v.description(`[已過時 / Deprecated] ${description}`), v.metadata({ deprecated: true })));
}

const confirmationSchema = v.pipe(
    v.object({
        // A numeric `code:` is rejected rather than coerced: it already lost its leading zeros by the time we see it.
        code: text("訂位/訂房確認碼或訂單編號。純數字代碼請加引號 (例如 '012345')，避免被解析成數字而遺失前導零。"),
        name: v.optional(text("訂位人姓名 (選填)，建議與護照拼音一致。")),
        note: v.optional(text("補充備註 (選填)，例如「入住/報到時出示護照」。")),
    }),
    v.description("訂位/訂房確認資訊 (選填)。設定後卡片會顯示確認碼 chip，點一下複製，並可放大出示給櫃台。"),
);

const hotelSchema = v.object({
    name: text("飯店/旅宿名稱"),
    address: text("飯店外文地址 (供計程車司機觀看/複製)"),
    checkIn: isoDate("入住日期 (YYYY-MM-DD)"),
    checkOut: isoDate("退房日期 (YYYY-MM-DD)"),
    localName: v.optional(text(LOCAL_NAME_DESC)),
    mapLink: v.optional(text(MAP_LINK_DESC)),
    confirmation: v.optional(confirmationSchema),
});

const linkSchema = v.object({
    label: text("連結顯示文字"),
    url: text("連結網址：http(s)、mailto:、tel:、sms:、geo: 或裸網域 (會自動補 https://)。其他 scheme 不會顯示連結"),
});

// No `note` on purpose, so a stop stays one row; commentary goes in the event's `desc` / `bullets`.
const stopSchema = v.object({
    name: text("地點顯示名稱 (通常是中文，例如「特雷維噴泉」)"),
    localName: v.optional(text("地點的當地語言名稱 (選填，例如 'Fontana di Trevi')，可放大出示問路，也作為地圖搜尋關鍵字。沒有這個欄位 (也沒有 mapLink) 的話該站不會有地圖按鈕，所以建議填。")),
    mapLink: v.optional(text("地圖直接連結 (選填，如 maps.app.goo.gl 短網址)。有設定時會優先使用，比關鍵字搜尋更精準。")),
});

const alternativeSchema = v.object({
    title: text("備選地點名稱"),
    localName: v.optional(text("地點的當地語言名稱 (選填)，可放大出示問路，也作為地圖搜尋關鍵字")),
    mapLink: v.optional(text(MAP_LINK_DESC)),
    note: v.optional(text(`換點決策備註 (選填)，例如「排隊超過 30 分鐘就換」。${MARKDOWN_HINT}`)),
});

const timelineEventSchema = v.object({
    time: text("時間區間，例如: 14:00 - 15:30"),
    title: text("行程或事件標題"),
    type: v.pipe(
        v.picklist(["booked", "must-go", "standard", "option"]),
        v.description("事件類型：booked(預訂/橘色), must-go(必訪/粉色), standard(一般/藍色), option(備選/紫色)"),
    ),
    // Optional on purpose -- an event without one renders a blank line rather than failing the load.
    desc: v.optional(text(`詳細說明描述，${MARKDOWN_HINT}`)),
    status: v.optional(v.pipe(
        v.picklist(["done", "skipped"]),
        v.description("打卡狀態 (選填)：done=已完成, skipped=略過。未設定表示尚未造訪。通常由 App 內的打卡按鈕寫入，並隨 YAML 與分享連結保留進度。"),
    )),
    bullets: v.optional(v.pipe(v.array(v.string()), v.description(`備註條列式項目，${MARKDOWN_HINT}（不支援 HTML）`))),
    localName: v.optional(text(LOCAL_NAME_DESC)),
    mapLink: v.optional(text(MAP_LINK_DESC)),
    confirmation: v.optional(confirmationSchema),
    stops: v.optional(v.pipe(
        v.array(stopSchema),
        v.description("本事件依序走訪的多個地點 (選填)，例如「西班牙階梯 ➔ 特雷維噴泉 ➔ 萬神殿」這種串聯行程。每站各自產生地圖與放大按鈕，所以每一站都能放大出示問路，不像事件層的 localName 只能有一個。在事件卡上直接展開顯示 (不折疊)，因為這是行程主體。若是「擇一前往」的備選地點請用 alternatives；若只是官網、攻略文等補充網址請用 links。"),
    )),
    links: v.optional(v.pipe(
        v.array(linkSchema),
        v.description("同一事件的補充連結 (選填)，例如官網、攻略文。地圖連結會自動顯示對應的品牌 icon。若要列出本事件走訪的多個地點請改用 stops (每站會有地圖與放大按鈕)；若是「擇一前往」的備選地點 (如備案餐廳) 請改用 alternatives。"),
    )),
    alternatives: v.optional(v.pipe(
        v.array(alternativeSchema),
        v.description("備選地點清單 (選填)，例如備案餐廳：每筆是一個候選地點，含當地語言店名 (可放大出示問路) 與備註 (如「排隊超過 30 分鐘就換」)，供現場換點決策。在事件卡尾端以折疊清單顯示。若只是同一事件的補充連結或多個點，請改用 links。"),
    )),
});

const daySchema = v.object({
    day: deprecated(v.pipe(v.number(), v.integer()), "不需填寫。App 會依 date 排序後自動編號。"),
    date: isoDate("當天日期 (YYYY-MM-DD)"),
    title: v.pipe(
        v.string(),
        v.description("當日行程大標題/主題，例如: 抵達 · 新宿、京都一日遊。建議 14 個全形字以內 (約 23 個半形字)：在 390px 寬的手機上，日程卡大標題超過就會折成兩行；總覽日期清單則會在 15 個全形字處截字。"),
        v.metadata({ maxLength: 24 }),
    ),
    // `normalizeTripData` migrates a legacy `region` into `title` before parsing, so this entry exists for the editor's sake only.
    region: deprecated(v.string(), "舊版區域屬性，請改用 title"),
    pace: v.optional(v.pipe(
        v.string(),
        v.description("今日行程節奏描述 (選填，預設為「自由安排行程」)，例如: 慢活、需要早起。建議 15 個全形字以內 (約 27 個半形字)。"),
        v.metadata({ maxLength: 30 }),
    )),
    city: v.optional(text("當日所在城市，覆蓋 trip.city 的天氣查詢 (選填，多城市行程用)。建議使用英文名稱 (例如: Kyoto)，可加兩碼國碼後綴消歧 (例如: 'Springfield, US')。留空字串視同未設定，回退至 trip.city。")),
    timeline: v.array(timelineEventSchema),
});

const checklistItemSchema = v.object({
    // Optional for the same reason as an event's `desc`.
    text: v.optional(text(`項目文字，${MARKDOWN_HINT}`)),
    checked: v.optional(v.pipe(v.boolean(), v.description("是否已勾選 (選填，預設 false)。App 會隨勾選狀態寫回這個欄位。"))),
});

const tripSchema = v.object({
    name: v.pipe(v.string(), v.minLength(1), v.description("行程名稱")),
    id: v.optional(v.pipe(
        v.string(),
        v.description("[自動產生 / 請勿手動編輯] App 產生的行程識別碼，會跟著匯出檔、分享連結與雲端備份走，用來認出「同一趟行程」。手動修改或刪除會讓這趟行程與它的雲端檔案失去關聯。"),
        v.metadata({ readOnly: true }),
    )),
    start: deprecated(v.string(), "不需填寫。App 會自動取 days 中最早的 date 作為出發日期。"),
    end: deprecated(v.string(), "不需填寫。App 會自動取 days 中最晚的 date 作為回程日期。"),
    departure: deprecated(v.string(), "不需填寫。App 會自動以第一天的第一個行程時間作為首頁倒數計時的目標。"),
    // Any string loads -- `language.ts` falls back to English for a code it does not know -- so the enum is an editor hint, not a gate.
    lang: v.optional(v.pipe(
        v.string(),
        v.description("目的地語言代碼，決定放大給計程車司機看的卡片標題語言 (ko=韓文, ja=日文, en=英文)。未設定或不支援時預設為英文 (en)。"),
        v.metadata({ enum: ["ko", "ja", "en"] }),
    )),
    mapProvider: v.optional(v.pipe(
        v.picklist(["naver", "google"]),
        v.description("地圖搜尋使用的服務 (選填)。韓國因地圖法規建議設 naver，未設定時預設使用 Google Maps。"),
    )),
    city: v.optional(text("目的地城市，用於查詢每日天氣預報 (選填，未設定或留空字串時不顯示天氣)。建議使用英文名稱 (例如: Tokyo, Seoul, Osaka)；中文名稱僅部分可查 (東京、京都可，首爾、大阪、釜山等查不到或比對錯國家)。同名城市可加兩碼國碼後綴消歧 (例如: 'Springfield, US')。可在個別 day 以 city 覆蓋 (多城市行程)。")),
    hotels: v.array(hotelSchema),
});

/** The whole authored document. Parse with `abortEarly` and hand the first issue to `describeIssue` for the user-facing message. */
export const itinerarySchema = v.object({
    trip: tripSchema,
    days: v.pipe(v.array(daySchema), v.minLength(1), v.description("每日行程細節列表 (順序不敏感，系統會自動按日期排序並補齊中間空白天)")),
    todo: v.optional(v.pipe(v.array(checklistItemSchema), v.description("行前待辦清單"))),
    packing: v.optional(v.pipe(v.array(checklistItemSchema), v.description("隨身行李與打包清單"))),
});

export type ItineraryDocument = v.InferOutput<typeof itinerarySchema>;
export type ConfirmationInfo = v.InferOutput<typeof confirmationSchema>;
export type HotelInfo = v.InferOutput<typeof hotelSchema>;

export interface TimelineEvent extends v.InferOutput<typeof timelineEventSchema> {
    /** Runtime-only `{#each}` key and edit handle; `serializeToYaml` strips it, so it never reaches saved YAML. */
    _id?: string;
}

export interface ChecklistItem extends v.InferOutput<typeof checklistItemSchema> {
    /** Runtime-only, like `TimelineEvent._id`. */
    _id?: string;
}
