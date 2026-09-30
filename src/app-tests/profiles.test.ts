import {
    screen,
    waitFor,
} from "@testing-library/dom";
import {
    expect,
    test,
} from "vitest";
import {
    launchApp,
    navTab,
    status,
} from "./harness";

// 行程設定檔（trip profiles）生命週期：建立 → 切換 → 刪除（先取消再確認）。
// 建立與切換各觸發一次 load（isLoading 會暫時卸載總覽面板，切換器
// 因此收合），所以每個步驟都先等畫面落定，再重新展開切換器。

const expander = () => screen.getByRole("button", { name: /目前行程/ });

test("行程設定檔：建立、切換、刪除與取消刪除", async () => {
    const { user, reload } = await launchApp();
    await screen.findByRole("heading", { level: 2, name: "測試行程" });

    await user.click(navTab("工具"));
    await user.click(screen.getByRole("button", { name: "行程管理" }));

    // (1) 建立：新增行程後停在行程管理頁，回行程分頁顯示範本行程
    expect(expander().getAttribute("aria-expanded")).toBe("false");
    await user.click(expander());
    expect(expander().getAttribute("aria-expanded")).toBe("true");
    await user.click(screen.getByRole("button", { name: "新增行程" }));
    await waitFor(() => expect(status().textContent).toContain("已建立新行程"));

    await screen.findByRole("heading", { name: "行程管理" });
    await user.click(navTab("行程"));
    await screen.findByRole("heading", { level: 2, name: "下面一way-我的探索之旅" });
    expect(document.title).toBe("下面一way-我的探索之旅");

    // 原本的行程被停放成 profile（工具分頁記住了行程管理子頁）
    await user.click(navTab("工具"));
    await waitFor(() => expect(expander().getAttribute("aria-expanded")).toBe("false"));
    await user.click(expander());
    await user.click(await screen.findByRole("button", { name: /測試行程.*切換/ }));

    // (2) 切換：換回原本的行程，自動導回行程分頁
    await waitFor(() => expect(status().textContent).toContain("已切換"));
    await screen.findByRole("heading", { level: 2, name: "測試行程" });
    expect(document.title).toBe("測試行程");

    await user.click(navTab("工具"));
    await user.click(expander());
    await screen.findByRole("button", { name: /下面一way-我的探索之旅.*切換/ });

    // (3) 取消刪除：行內確認 Bar 按取消後列仍在，localStorage 也未動
    await user.click(screen.getByRole("button", { name: "刪除行程 下面一way-我的探索之旅" }));
    screen.getByText("要刪除行程「下面一way-我的探索之旅」嗎？此動作無法復原。");
    await user.click(screen.getByRole("button", { name: "取消" }));
    screen.getByRole("button", { name: /下面一way-我的探索之旅.*切換/ });
    expect(window.localStorage.getItem("showmeway_profiles")).toContain("我的探索之旅");

    // (4) 確認刪除：列與刪除鈕都消失
    await user.click(screen.getByRole("button", { name: "刪除行程 下面一way-我的探索之旅" }));
    await user.click(screen.getByRole("button", { name: "確定刪除" }));
    await waitFor(() => expect(status().textContent).toContain("已刪除"));
    expect(screen.queryByRole("button", { name: /下面一way-我的探索之旅.*切換/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "刪除行程 下面一way-我的探索之旅" })).toBeNull();

    // 重新載入後：作用中行程仍是測試行程，被刪除的 profile 不會復活
    await reload();
    await screen.findByRole("heading", { level: 2, name: "測試行程" });
    expect(window.localStorage.getItem("showmeway_profiles") ?? "").not.toContain("我的探索之旅");
});
