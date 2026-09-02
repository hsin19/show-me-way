# 下面一way (ShowMeWay) 行程小助手

[![codecov](https://codecov.io/gh/hsin19/show-me-way/branch/main/graph/badge.svg)](https://codecov.io/gh/hsin19/show-me-way)

一個用 YAML 驅動的旅行行程隨身 PWA。把行程寫成一份 YAML，就能在手機上得到每日時間軸、行前清單、乘車助手與記帳換算，並可離線使用。

## 功能

- **行程時間軸**：依日期切換每日行程，事件分類（預訂 / 必訪 / 一般 / 備選），可一鍵開啟或複製 NAVER 地圖搜尋關鍵字。
- **行前準備**：待辦與打包清單，勾選狀態自動快取於裝置。
- **乘車助手**：飯店外文地址全螢幕放大給司機看，搭配實用常用語一鍵複製。
- **匯率與記帳**：雙向幣別換算與記帳，自動依目的地語系切換貨幣單位（日圓、韓元、美元等）與對應電子錢包（Suica、WOWPASS 等）。
- **出發倒數**：依班機時間顯示倒數，旅程中／結束自動切換狀態。
- **雲端同步與備份**：可選擇連線 Google 雲端硬碟，一鍵備份與跨裝置同步行程。同步的是完整行程（含記帳明細），存放在你自己的 Drive。
- **離線可用**：以 PWA 安裝到主畫面，行程存於裝置的 localStorage。資料只在你主動操作時離開裝置：連線雲端硬碟同步、使用 AI 助手，或產生分享連結（行程先在瀏覽器加密，只有密文上傳到短連結服務，金鑰留在連結的 `#` 片段裡）。

## 技術

Svelte 5（runes）、TypeScript、Vite、Tailwind CSS v4、`vite-plugin-pwa`、`js-yaml`。

## 開發

```bash
pnpm install
pnpm dev       # 啟動開發伺服器
pnpm build     # 打包到 dist/
pnpm preview   # 預覽打包結果
pnpm check     # 完整檢查鏈（format、lint、型別、單元測試、build、e2e，會自動修復可修復項）
```

## 設定你的行程

行程資料來源優先順序：

1. 使用者在 App「設定」中貼上並儲存的 YAML（存於 localStorage）。
2. `public/itinerary.local.yaml`（個人用，已加入 `.gitignore`，不會進版控）。
3. `public/itinerary.yaml`（專案預設範本）。

編輯 YAML 時，檔案頂部已指向 [`showmeway-schema.json`](./schema/showmeway-schema.json)，在 VS Code（搭配 YAML 擴充套件）中可獲得欄位自動補全與驗證。完整欄位定義請見該 schema。

## 自行部署

雲端同步用的 Google OAuth client id 從 `VITE_GOOGLE_CLIENT_ID` 讀取，設定方式見 [`.env.example`](./.env.example)。

**fork 或換網域一定要自己申請一組**：沒設定時會退回程式碼裡內建的 id，而那個 id 綁定本專案的 authorized JavaScript origins，所以在別的來源登入會直接失敗，而且錯誤訊息看不出原因。

`BASE_PATH`（GitHub Pages 專案站的子路徑）與 `VITE_GIT_SHA`（顯示在「關於」的版本）由 `vite.config.ts` 從 shell 讀取、不吃 `.env`，要在 build 指令上帶入 —— `.github/workflows/deploy.yml` 就是這樣做的。

最小範例：

```yaml
trip:
  name: '我的探索之旅'
  start: '2026-10-01' # YYYY-MM-DD
  end: '2026-10-03'
  departure: '2026-10-01T08:00:00+08:00' # 班機起飛（ISO 8601，用於倒數）
  hotels:
    - name: '極簡設計精選飯店'
      station: '新宿站步行 3 分鐘'
      address: '東京都新宿區西新宿 1-1-1' # 外文地址，供司機觀看
      checkIn: '2026-10-01'
      checkOut: '2026-10-03'

days:
  - day: 1
    date: '2026-10-01'
    title: '經典商圈漫步'
    pace: '輕鬆漫遊'
    timeline:
      - time: '08:00'
        title: '✈️ 前往目的地'
        type: 'booked' # booked | must-go | standard | option
        desc: '出發！'

phrases:
  - zh: '謝謝'
    text: 'Arigato'
    rom: 'A-ri-ga-to'
```

`todo`、`packing`、`phrases` 等其餘區塊為選填，詳見 schema。
