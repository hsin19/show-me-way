import {
    expect,
    FIXTURE_YAML,
    seedItinerary,
    test,
} from "./fixtures";

// The one Markdown case that needs a real browser: a link inside a checklist row
// must not tick the row, and that is the HTML spec's label activation (see
// RichText.svelte), which happy-dom does not implement — there the click always
// reaches the checkbox. The rest of the Markdown rendering is covered in-process by
// src/app-tests/markdown.test.ts.
const MD_YAML = FIXTURE_YAML.replace(
    "  - text: 測試待辦項目",
    [
        "  - text: '測試待辦項目 [線上表單](https://example.com/todo-form)'",
        "  - text: 純文字待辦",
    ].join("\n"),
);

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
