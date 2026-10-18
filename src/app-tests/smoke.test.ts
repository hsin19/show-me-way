import {
    screen,
    waitFor,
    within,
} from "@testing-library/dom";
import {
    expect,
    onTestFinished,
    test,
    vi,
} from "vitest";
import {
    checklist,
    createPage,
    firstDayChip,
    launchApp,
    navTab,
} from "./harness";

// Smoke suite: boots the whole App, walks the bottom tabs (行程/工具/AI — 準備/
// 行程管理/App 設定 are sub-pages inside 工具) and the day strip, and verifies that
// edits round-trip through the YAML in localStorage (showmeway_user_yaml) across a
// reload. All assertions use the app's real Traditional Chinese UI strings —
// punctuation is fullwidth where the UI uses fullwidth (｜ U+FF5C, — U+2014).
//
// That the 總覽 chip stays put while the day chips scroll is layout, so it stays in
// e2e/tests/smoke.spec.ts.

const dayChips = () => document.querySelectorAll<HTMLElement>("button[data-day]");

function firstEventCard(): HTMLElement {
    const card = document.querySelector<HTMLElement>("[data-event-id]");
    if (!card) throw new Error("no event card rendered");
    return card;
}

test("種子行程載入：顯示行程總覽且無執行期錯誤", async () => {
    // No page-error collection: an error escaping a component fails the whole vitest run.
    await launchApp();

    await screen.findByRole("heading", { level: 2, name: "測試行程" });
    // App.svelte rewrites document.title to trip.name once the YAML is loaded.
    expect(document.title).toBe("測試行程");
    // One chip per day in the day strip (the 總覽 chip carries no data-day).
    expect(dayChips()).toHaveLength(2);
});

test("無使用者資料時回退載入預設範本", async () => {
    // The harness never serves public/itinerary.local.yaml, so the fallback chain skips
    // the personal itinerary exactly as it does on a clean CI checkout.
    const page = createPage({ yaml: null });
    await page.goto("/");

    await waitFor(() => expect(document.title).toBe("下面一way-我的探索之旅"));
});

test("日程切換：各天顯示對應事件後可返回總覽", async () => {
    const { user } = await launchApp();
    await waitFor(firstDayChip);

    await user.click(dayChips()[0]!);
    await screen.findByRole("heading", { name: "測試區域一" });
    screen.getByText("測試事件一");

    await user.click(dayChips()[1]!);
    await screen.findByRole("heading", { name: "測試區域二" });
    screen.getByText("測試事件二");

    await user.click(screen.getByRole("button", { name: "總覽" }));
    await screen.findByRole("heading", { level: 2, name: "測試行程" });
});

test("總覽：行程進行中時標出今天，點今天卡片回到當天", async () => {
    // FIXTURE_YAML 刻意落在 2099、永遠碰不到今天，所以這條把時鐘停在自己三天行程的第二天中午。
    // 只換掉 Date：Testing Library 的等待靠真的計時器在輪詢。
    vi.useFakeTimers({ toFake: ["Date"], now: new Date(2026, 9, 11, 12, 0) });
    onTestFinished(() => void vi.useRealTimers());
    const days = ["10", "11", "12"].map((dd, i) => `  - date: '2026-10-${dd}'\n    title: 第${i + 1}天區域\n    timeline:\n      - time: '09:00'\n        title: 第${i + 1}天事件\n`).join("");
    const page = createPage({ yaml: `trip:\n  name: 今天測試\n  hotels: []\ndays:\n${days}` });
    await page.goto("/");
    const { user } = page;

    // 開啟時本來就會落在今天；先回總覽，才是要測的起點。
    await screen.findByRole("heading", { name: "第2天區域" });
    await user.click(screen.getByRole("button", { name: "總覽" }));
    await screen.findByRole("heading", { level: 2, name: "今天測試" });

    // 日期列的 chip 本來就有標記；這裡要的是總覽清單裡的那一列。
    const marked = screen.getAllByRole("button", { current: "date" }).map(button => button.textContent ?? "");
    expect(marked.filter(text => text.includes("第2天區域") && text.includes("今天"))).toHaveLength(1);

    // 中午時 09:00 的事件已經開始。
    const todayCard = screen.getByRole("button", { name: /^今天\s*・DAY 02/ });
    expect(todayCard.textContent).toContain("進行中：第2天事件");
    await user.click(todayCard);
    await screen.findByRole("heading", { name: "第2天區域" });
});

test("事件打卡：標記完成並於重新載入後保留", async () => {
    const { user, reload } = await launchApp();
    await waitFor(firstDayChip);

    await user.click(firstDayChip());
    await user.click(within(await waitFor(firstEventCard)).getByRole("button", { name: "標記為已完成" }));
    await waitFor(() => within(firstEventCard()).getByRole("button", { name: "取消已完成標記" }));

    await reload();
    await waitFor(firstDayChip);
    await user.click(firstDayChip());
    await waitFor(() => within(firstEventCard()).getByRole("button", { name: "取消已完成標記" }));
});

test("清單：勾選與新增項目並於重新載入後保留", async () => {
    const { user, reload } = await launchApp();

    await user.click(navTab("工具"));
    await screen.findByRole("heading", { name: "行前準備與打包" });

    // 勾選既有項目（<label> 包住的 <input type="checkbox">；可及名稱來自 label 文字）
    const seededItem = () => screen.getByRole<HTMLInputElement>("checkbox", { name: "測試待辦項目" });
    expect(seededItem().checked).toBe(false);
    await user.click(seededItem());
    await waitFor(() => expect(seededItem().checked).toBe(true));

    // 勾選後先重新載入一次：新增會把整份行程重寫進 localStorage，只在最後才重新載入的話，
    // 一個自己沒 persist 的勾選會搭著新增一起存進去，看不出來。
    await reload();
    await user.click(navTab("工具"));
    expect((await screen.findByRole<HTMLInputElement>("checkbox", { name: "測試待辦項目" })).checked).toBe(true);

    // 新增一個項目（aria-label 是「待辦事項 — 新增項目」，em dash）。範圍限定在待辦事項
    // 這張卡：兩份清單共用同一個元件，加錯清單在整頁搜尋下照樣找得到。
    await user.type(screen.getByLabelText("待辦事項 — 新增項目"), "新增的測試項目{Enter}");
    await within(checklist("待辦事項")).findByRole("checkbox", { name: "新增的測試項目" });

    await reload();
    await user.click(navTab("工具"));
    expect((await screen.findByRole<HTMLInputElement>("checkbox", { name: "測試待辦項目" })).checked).toBe(true);
    within(checklist("待辦事項")).getByRole("checkbox", { name: "新增的測試項目" });
});

test("無效的使用者 YAML：顯示錯誤畫面與設定入口", async () => {
    const { user } = await launchApp("days: []\n");

    await screen.findByText("無法載入或解析行程資料。請開啟設定確認 YAML 語法。");
    // The entry has to land on 行程管理: its YAML editor is where the broken trip gets
    // repaired, and App 設定 or any other page would be a dead end.
    await user.click(screen.getByRole("button", { name: "開啟設定並貼上 YAML" }));
    await screen.findByRole("heading", { name: "行程管理" });
});
