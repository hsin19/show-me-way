import { FIXTURE_YAML } from "$lib/testing/fixture-trip";
import {
    screen,
    waitFor,
    within,
} from "@testing-library/dom";
import {
    expect,
    test,
} from "vitest";
import {
    checklist,
    launchApp,
    navTab,
} from "./harness";

// 刪除／復原流程：TripStore.deleteWithUndo 會先 persist、再以帶「復原」動作的
// toast（role=status，4500ms 窗口）提供 undo，undo 透過 insertAtClamped 把快照
// 插回原本的 index。刪除與復原之間不可 reload 或切換分頁 — toast 狀態只存在
// 記憶體中。

// 種子項目夾在中間：刪第一個分不出「放回原位」和「一律插到最前」，刪最後一個分不出
// 它和「一律附加到最後」。
const THREE_TODOS_YAML = FIXTURE_YAML.replace("  - text: 測試待辦項目\n", "  - text: 第一個待辦\n  - text: 測試待辦項目\n  - text: 最後一個待辦\n");

const seededItem = () => screen.getByRole("checkbox", { name: "測試待辦項目" });

const todoOrder = () => within(checklist("待辦事項")).getAllByRole("checkbox").map(box => box.closest("label")?.textContent?.trim());

test("清單項目刪除後可復原並保留原本位置", async () => {
    // 前提檢查：fixture 改了 todo 的寫法後這支測試若沒跟著改，就不再是刪中間那一筆。
    expect(THREE_TODOS_YAML).toContain("第一個待辦");

    const { user, reload } = await launchApp(THREE_TODOS_YAML);

    await user.click(navTab("工具"));
    await screen.findByRole("heading", { name: "行前準備與打包" });
    expect(todoOrder()).toEqual(["第一個待辦", "測試待辦項目", "最後一個待辦"]);

    // 刪除種子項目（列內的垃圾桶按鈕 aria-label 是「刪除項目」）
    await user.click(within(seededItem().closest("li")!).getByRole("button", { name: "刪除項目" }));
    await waitFor(() => expect(screen.queryByRole("checkbox", { name: "測試待辦項目" })).toBeNull());
    // 刪除本身就要寫回：復原會再 persist 一次，只看復原後的結果會把一個漏存的刪除蓋過去。
    expect(window.localStorage.getItem("showmeway_user_yaml")).not.toContain("測試待辦項目");

    // toast 帶「復原」動作 — 立即點擊（4500ms 窗口內）
    const toast = screen.getByRole("status");
    await waitFor(() => expect(toast.textContent).toContain("已刪除"));
    await user.click(within(toast).getByRole("button", { name: "復原" }));

    // insertAtClamped 應把項目放回原本的 index 1（中間）
    await waitFor(seededItem);
    expect(todoOrder()).toEqual(["第一個待辦", "測試待辦項目", "最後一個待辦"]);

    // 復原結果已 persist 回 YAML，重新載入後仍在
    await reload();
    await user.click(navTab("工具"));
    await waitFor(seededItem);
    expect(todoOrder()).toEqual(["第一個待辦", "測試待辦項目", "最後一個待辦"]);
});
