import {
    expect,
    FIXTURE_YAML,
    seedItinerary,
    test,
} from "./fixtures";

// Inline Markdown in itinerary prose (src/lib/markdown.ts, rendered by
// RichText.svelte). The parsing rules have unit coverage; what only e2e can
// show is that the markup reaches the DOM as real elements, that a hostile
// href never becomes a live link, and that a link inside a checklist row does
// not toggle the row on the way out.
const MD_YAML = FIXTURE_YAML
    .replace(
        "        desc: 第一天的測試事件",
        [
            "        desc: '第一天的測試事件，詳見[官方售票頁](https://example.com/tickets)與 **粗體提醒**'",
            "        bullets:",
            "          - '包包限制 `12\"×12\"`，*斜體*說明'",
            "          - '[惡意連結](javascript:alert(1)) 不可點'",
        ].join("\n"),
    )
    .replace(
        "  - text: 測試待辦項目",
        [
            "  - text: '測試待辦項目 [線上表單](https://example.com/todo-form)'",
            "  - text: 純文字待辦",
        ].join("\n"),
    );

test("行程敘述的 Markdown 連結只顯示標籤，粗體成為真正的 strong", async ({ page }) => {
    await seedItinerary(page, MD_YAML);
    await page.goto("/");
    await page.locator("button[data-day]").first().click();

    const link = page.getByRole("link", { name: "官方售票頁" });
    await expect(link).toHaveAttribute("href", "https://example.com/tickets");
    await expect(link).toHaveAttribute("target", "_blank");
    await expect(link).toHaveAttribute("rel", "noopener noreferrer");

    // 網址本身不出現在畫面上 —— 這是改用 Markdown 的重點。
    await expect(page.getByText("https://example.com/tickets")).toHaveCount(0);

    await expect(page.locator("strong", { hasText: "粗體提醒" })).toBeVisible();
    await expect(page.locator("code", { hasText: '12"×12"' })).toBeVisible();
    await expect(page.locator("em", { hasText: "斜體" })).toBeVisible();
});

test("javascript: 連結不會成為可點連結，整段維持字面文字", async ({ page }) => {
    await seedItinerary(page, MD_YAML);
    await page.goto("/");
    await page.locator("button[data-day]").first().click();

    await expect(page.getByRole("link", { name: "惡意連結" })).toHaveCount(0);
    await expect(page.getByText("[惡意連結](javascript:alert(1)) 不可點")).toBeVisible();
});

test("裸網址不再自動變成連結", async ({ page }) => {
    const bare = FIXTURE_YAML.replace(
        "        desc: 第一天的測試事件",
        "        desc: '第一天的測試事件 https://example.com/bare'",
    );
    await seedItinerary(page, bare);
    await page.goto("/");
    await page.locator("button[data-day]").first().click();

    await expect(page.getByText("第一天的測試事件 https://example.com/bare")).toBeVisible();
    await expect(page.getByRole("link", { name: /example\.com/ })).toHaveCount(0);
});

test("待辦項目的連結可點，且點下去不會把項目勾掉", async ({ page }) => {
    // fixtures.ts 會 abort 所有非 localhost 請求，被點開的分頁就停在一個中止的
    // 導覽上。必須註冊在 context 上（不是 page 上）—— popup 是另一個 page，只繼承
    // context 的 route；後註冊的優先，所以這裡的 200 蓋過 fixture 的 abort，
    // popup 才一定會成形，失敗時才會是斷言失敗而不是逾時。
    await page.context().route("**/todo-form", route => route.fulfill({ status: 200, contentType: "text/html", body: "<p>form</p>" }));
    await seedItinerary(page, MD_YAML);
    await page.goto("/");
    await page.locator("nav").getByRole("button", { name: "工具", exact: true }).click();

    const item = page.getByRole("checkbox", { name: "測試待辦項目 線上表單" });
    await expect(item).not.toBeChecked();

    const link = page.getByRole("link", { name: "線上表單" });
    await expect(link).toHaveAttribute("href", "https://example.com/todo-form");

    // 整列是一個 <label>，點任何地方都會轉給 checkbox —— 連結必須擋下這個轉發，
    // 否則點開參考網址的同時就把待辦事項勾掉了。
    const popup = page.context().waitForEvent("page");
    await link.click();
    await (await popup).close();
    await expect(item).not.toBeChecked();

    // 點文字仍然要能勾選：手機上整列就是那個點擊區域，不能為了放連結而犧牲。
    // 用純文字項目驗證，避免點擊落在連結上。
    const plain = page.getByRole("checkbox", { name: "純文字待辦" });
    await page.getByText("純文字待辦", { exact: true }).click();
    await expect(plain).toBeChecked();
});

test("links 與 mapLink 的 javascript: 目標不會進到 DOM", async ({ page }) => {
    // 這兩個 href 跟 Markdown 連結來自同一份匯入的 YAML，所以走同一道
    // sanitizeHref：links 的整顆 chip 消失，mapLink 則退回 localName 搜尋。
    const hostile = FIXTURE_YAML.replace(
        "        desc: 第一天的測試事件",
        [
            "        desc: 第一天的測試事件",
            "        localName: テスト場所",
            "        mapLink: 'javascript:alert(1)'",
            "        links:",
            "          - label: 惡意チップ",
            "            url: 'javascript:alert(2)'",
            "          - label: 正常官網",
            "            url: 'https://example.com/ok'",
        ].join("\n"),
    );
    await seedItinerary(page, hostile);
    await page.goto("/");
    await page.locator("button[data-day]").first().click();

    await expect(page.getByRole("link", { name: "惡意チップ" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "正常官網" })).toHaveAttribute("href", "https://example.com/ok");
    await expect(page.locator("a[href^='javascript:']")).toHaveCount(0);
    // Map chip 仍在，只是改用 localName 搜尋，而不是那個被拒絕的 mapLink。
    await expect(page.getByRole("link", { name: "Map" })).toHaveAttribute("href", /^https:\/\/www\.google\.com\/maps\/search/);
});

test("links 的 tel: 仍可用（改用白名單後不能把電話 chip 弄不見）", async ({ page }) => {
    const withTel = FIXTURE_YAML.replace(
        "        desc: 第一天的測試事件",
        [
            "        desc: 第一天的測試事件",
            "        links:",
            "          - label: 訂位電話",
            "            url: 'tel:+81312345678'",
        ].join("\n"),
    );
    await seedItinerary(page, withTel);
    await page.goto("/");
    await page.locator("button[data-day]").first().click();

    await expect(page.getByRole("link", { name: "訂位電話" })).toHaveAttribute("href", "tel:+81312345678");
});

test("links 缺少 url 時在載入這關就被擋下，而不是渲染時炸掉", async ({ page }) => {
    // 開機路徑把訊息收斂成一句通用文案（確切訊息由 api.test.ts 斷言），這裡要證的
    // 是「擋在 validateYaml，不是讓 undefined 走到 sanitizeLinkHref」。
    const errors: string[] = [];
    page.on("pageerror", e => errors.push(e.message));
    const broken = FIXTURE_YAML.replace(
        "        desc: 第一天的測試事件",
        [
            "        desc: 第一天的測試事件",
            "        links:",
            "          - label: 官網",
        ].join("\n"),
    );
    await seedItinerary(page, broken);
    await page.goto("/");

    await expect(page.getByText("無法載入或解析行程資料。請開啟設定確認 YAML 語法。")).toBeVisible();
    expect(errors).toEqual([]);
});

test("事件缺少 desc、待辦缺少 text 時只是空白，不會讓整頁掛掉", async ({ page }) => {
    // 兩個欄位在 normalizeTripData 都是選填，缺了只該少一行字。改用 parser 之後
    // 一旦拋錯就會連整個日程面板／準備頁一起帶走。
    const errors: string[] = [];
    page.on("pageerror", e => errors.push(e.message));
    const sparse = FIXTURE_YAML
        .replace("        desc: 第一天的測試事件\n", "")
        .replace("  - text: 測試待辦項目", "  - checked: false");

    await seedItinerary(page, sparse);
    await page.goto("/");
    await page.locator("button[data-day]").first().click();
    await expect(page.getByText("測試事件一")).toBeVisible();

    await page.locator("nav").getByRole("button", { name: "工具", exact: true }).click();
    await expect(page.getByRole("heading", { name: "行前準備與打包" })).toBeVisible();

    expect(errors).toEqual([]);
});
