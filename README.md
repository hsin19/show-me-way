# ShowMeWay 行程小助手 🧭

一個用 YAML 驅動的旅行行程隨身 PWA。把行程寫成一份 YAML，就能在手機上得到每日時間軸、行前清單、乘車助手與記帳換算，並可離線使用。

## 功能

- **行程時間軸**：依日期切換每日行程，事件分類（預訂 / 必訪 / 一般 / 備選），可一鍵開啟或複製 NAVER 地圖搜尋關鍵字。
- **行前準備**：待辦與打包清單，勾選狀態自動快取於裝置。
- **乘車助手**：飯店外文地址全螢幕放大給司機看，搭配實用常用語一鍵複製。
- **匯率與記帳**：雙向幣別換算、可自訂匯率，記錄儲值與消費並計算餘額。
- **出發倒數**：依班機時間顯示倒數，旅程中／結束自動切換狀態。
- **離線可用**：以 PWA 安裝到主畫面，資料存於本機 localStorage，不上傳伺服器。

## 技術

Svelte 5（runes）、TypeScript、Vite、Tailwind CSS v4、`vite-plugin-pwa`、`js-yaml`。

## 開發

```bash
pnpm install
pnpm dev       # 啟動開發伺服器
pnpm build     # 打包到 dist/
pnpm preview   # 預覽打包結果
pnpm check     # svelte-check + tsc 型別檢查
```

## 設定你的行程

行程資料來源優先順序：

1. 使用者在 App「設定」中貼上並儲存的 YAML（存於 localStorage）。
2. `public/itinerary.local.yaml`（個人用，已加入 `.gitignore`，不會進版控）。
3. `public/itinerary.yaml`（專案預設範本）。

編輯 YAML 時，檔案頂部已指向 [`showmeway-schema.json`](./showmeway-schema.json)，在 VS Code（搭配 YAML 擴充套件）中可獲得欄位自動補全與驗證。完整欄位定義請見該 schema。

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
    region: '經典商圈漫步'
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
