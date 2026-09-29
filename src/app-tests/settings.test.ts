import { FIXTURE_YAML } from "$lib/testing/fixture-trip";
import {
    screen,
    waitFor,
} from "@testing-library/dom";
import type { UserEvent } from "@testing-library/user-event";
import {
    expect,
    test,
} from "vitest";
import {
    type AppPage,
    launchApp,
    navTab,
    openTripManagement,
    status,
} from "./harness";

// 行程管理頁（SettingsPanel.svelte — 工具分頁內的頁面，非模態）：YAML 編輯與
// 儲存、自動備份還原、無效 YAML 的行內錯誤、未儲存草稿跨分頁保留
// （settings-draft.svelte.ts）。儲存／還原成功後會自動導回行程分頁。

const EDITED_YAML = FIXTURE_YAML.replace("name: 測試行程", "name: 改版行程");

const editor = () => screen.getByLabelText<HTMLTextAreaElement>("行程資料 (YAML)");

// 從工具分頁的「行程管理」chip 進入設定頁，並等 SettingsPanel 的 onMount 把現有
// YAML 填入編輯器（太早 fill 會被 onMount 的內容覆寫）。
async function openSettings(user: UserEvent): Promise<void> {
    await openTripManagement(user);
    await waitFor(() => expect(editor().value).toMatch(/trip:/));
}

async function launchOnSettings(): Promise<AppPage> {
    const page = await launchApp();
    await screen.findByRole("heading", { level: 2, name: "測試行程" });
    await openSettings(page.user);
    return page;
}

test("設定：編輯 YAML 並儲存後套用新行程", async () => {
    const page = await launchOnSettings();
    const { user, fill } = page;
    await fill(editor(), EDITED_YAML);
    await user.click(screen.getByRole("button", { name: "儲存並解析" }));

    await waitFor(() => expect(status().textContent).toContain("儲存成功"));
    // 儲存成功後自動導回行程分頁
    await screen.findByRole("heading", { level: 2, name: "改版行程" });
    await waitFor(() => expect(document.title).toBe("改版行程"));
    // 同一趟（trip.id 相同）的修改正是這顆按鈕的本意，不該再跳確認框問要不要覆蓋。
    expect(page.dialogs).toEqual([]);
});

// 另一趟的 YAML（trip.id 不同）不能直接蓋掉目前這趟：它會繼承這趟的雲端檔與分享連結。
test("設定：貼上另一趟行程的 YAML，確認後另存為新行程，原本那趟停放保留", async () => {
    const page = await launchOnSettings();
    const { user, fill } = page;
    page.answerDialogs(true);

    const otherTrip = EDITED_YAML.replace("id: t-fixture", "id: t-other");
    await fill(editor(), otherTrip);
    await user.click(screen.getByRole("button", { name: "儲存並解析" }));

    await waitFor(() => expect(status().textContent).toContain("已另存為新行程「改版行程」，原本的行程已保留"));
    await screen.findByRole("heading", { level: 2, name: "改版行程" });
    expect(page.dialogs).toEqual([expect.stringContaining("和目前的行程不是同一趟")]);
    // 另存的是那一趟本身，不是換了身分的副本：它的 trip.id 要原樣留著，才對得上它自己的雲端檔與分享連結。
    expect(window.localStorage.getItem("showmeway_user_yaml")).toBe(otherTrip);

    await user.click(navTab("工具"));
    await user.click(screen.getByRole("button", { name: /目前行程/ }));
    await screen.findByRole("button", { name: /測試行程.*切換/ });
});

test("備份還原：儲存後產生備份，還原回前一版行程", async () => {
    const { user, fill } = await launchOnSettings();

    // 先儲存一次修改版 — 覆蓋前會自動備份原本的「測試行程」
    await fill(editor(), EDITED_YAML);
    await user.click(screen.getByRole("button", { name: "儲存並解析" }));
    await screen.findByRole("heading", { level: 2, name: "改版行程" });

    // 重新進入設定頁：備份區出現一列，空狀態文案消失。openSettings 等到的編輯器內容與
    // 備份清單在同一個 onMount 裡填入，所以這裡的「消失」不是還沒 mount 的假象。
    await openSettings(user);
    expect(screen.queryByText(/尚無自動備份/)).toBeNull();
    const restoreRows = screen.getAllByRole("button", { name: /還原/ });
    expect(restoreRows).toHaveLength(1);

    // 點擊「還原」按鈕展開 ConfirmBar 行內確認，再點擊「確定還原」。備份區收著
    // 每一趟的備份，所以確認文案點名的是備份裡那一趟，不是目前的「改版行程」。
    await user.click(restoreRows[0]!);
    screen.getByText("確定要還原「測試行程」的備份嗎？");
    await user.click(screen.getByRole("button", { name: "確定還原" }));

    await waitFor(() => expect(status().textContent).toContain("已還原"));
    // 還原成功後同樣導回行程分頁
    await screen.findByRole("heading", { level: 2, name: "測試行程" });
    await waitFor(() => expect(document.title).toBe("測試行程"));
});

test("無效 YAML：顯示行內驗證錯誤且停留在設定頁", async () => {
    const { user, fill } = await launchOnSettings();

    await fill(editor(), "days: []");
    await user.click(screen.getByRole("button", { name: "儲存並解析" }));

    await screen.findByText(/YAML 缺少必要的結構/);
    screen.getByRole("heading", { name: "行程管理" });
    // 被拒的內容留在編輯器裡等使用者修正，不會被換回已存的那份。
    expect(editor().value).toBe("days: []");
    // 無效內容沒有被存入 — 行程維持原樣
    expect(document.title).toBe("測試行程");
    expect(window.localStorage.getItem("showmeway_user_yaml")).toBe(FIXTURE_YAML);
});

test("未儲存草稿：切換分頁後再回來仍保留編輯內容", async () => {
    const { user, fill } = await launchOnSettings();
    await fill(editor(), "edited: true");

    // 切去行程分頁再回工具分頁（子頁記憶為行程管理）— 草稿仍在
    await user.click(navTab("行程"));
    await screen.findByRole("heading", { level: 2, name: "測試行程" });

    await user.click(navTab("工具"));
    await screen.findByRole("heading", { name: "行程管理" });
    await waitFor(() => expect(editor().value).toBe("edited: true"));
});

// 這幾個 affordance 曾經在一次無關的改寫中被順手刪掉（複製鈕、手機輸入屬性、
// 預設行程與 Skill 安裝說明），而型別、lint、單元測試全都不會察覺。
test("編輯器：複製鈕可用，且保留手機輸入必要屬性與說明", async () => {
    const page = await launchOnSettings();

    // YAML 的 key 全小寫：手機輸入法自動大寫會直接產生無效的行程。
    const textarea = document.querySelector("#yaml-editor");
    expect(textarea?.getAttribute("spellcheck")).toBe("false");
    expect(textarea?.getAttribute("autocapitalize")).toBe("off");

    // 複製的是編輯器裡還沒存的內容，不是已存的那份 — 先改過，兩者才分得出來。
    await page.fill(editor(), EDITED_YAML);
    // 名稱完整比對：部分比對會連「複製分享連結」一起命中。
    await page.user.click(screen.getByRole("button", { name: "複製" }));
    await waitFor(() => expect(status().textContent).toContain("已複製編輯器中的 YAML"));
    expect(page.copiedText()).toBe(EDITED_YAML);

    // 說明卡：回復預設的入口、資料出境、以及產生 YAML 的 Skill 從哪來。入口是相對
    // 路徑：正式站在 /show-me-way/ 底下，開頭的 / 只在正式站 404。
    expect(screen.getByRole("link", { name: "itinerary.yaml" }).getAttribute("href")).toBe("./itinerary.yaml");
    screen.getByText(/同步會把整份行程複製到你自己的 Drive/);
    screen.getByText(/npx skills add .*itinerary-yaml-builder/);
});
