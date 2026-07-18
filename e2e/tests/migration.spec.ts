import { type Page } from "@playwright/test";
import {
    expect,
    FIXTURE_YAML,
    test,
} from "./fixtures";

// 一次性遷移（App.svelte）：todo_state / packing_state 以舊版持久化的 `id` 對回
// 清單項目、ledger_expenses 經 parseLegacyExpenses 折疊進 expenses（僅在 YAML
// 尚無任何 expenses 時），完成後三個舊 key 都被刪除、統一寫回 YAML。

// FIXTURE_YAML 的形狀，但清單項目帶舊 schema 的 `id`（遷移靠它對應勾選狀態），
// 並加上 packing 清單以涵蓋兩條遷移路徑。
const LEGACY_YAML = FIXTURE_YAML.replace(
    "  - text: 測試待辦項目\n",
    "  - text: 測試待辦項目\n    id: legacy-1\n",
) + "packing:\n  - text: 測試打包項目\n    id: legacy-2\n";

// 與 fixtures.ts 的 seedItinerary 相同的守門邏輯：只在 showmeway_user_yaml 不存在
// 時寫入。三個舊 key 也放在同一個守門內 — 它們會被 App 遷移後刪除，init script
// 在 reload 時會重跑，若無條件重寫就會讓已刪除的舊 key「復活」並重複匯入。
async function seedLegacyState(page: Page): Promise<void> {
    await page.addInitScript(
        ([yaml, todoState, packingState, ledgerExpenses]) => {
            if (!window.localStorage.getItem("showmeway_user_yaml")) {
                window.localStorage.setItem("showmeway_user_yaml", yaml);
                window.localStorage.setItem("todo_state", todoState);
                window.localStorage.setItem("packing_state", packingState);
                window.localStorage.setItem("ledger_expenses", ledgerExpenses);
            }
        },
        [
            LEGACY_YAML,
            JSON.stringify({ "legacy-1": true }),
            JSON.stringify({ "legacy-2": true }),
            // parseLegacyExpenses 的舊紀錄形狀：{ name, amount, type, date }
            JSON.stringify([{ name: "舊消費", amount: 120, type: "Cash", date: "2099-01-01" }]),
        ] as const,
    );
}

function readMigrationState(page: Page) {
    return page.evaluate(() => ({
        todoState: window.localStorage.getItem("todo_state"),
        packingState: window.localStorage.getItem("packing_state"),
        ledgerExpenses: window.localStorage.getItem("ledger_expenses"),
        userYaml: window.localStorage.getItem("showmeway_user_yaml"),
    }));
}

test("舊版 localStorage 狀態折疊進 YAML，移除舊 key 且重新載入不重複匯入", async ({ page }) => {
    await seedLegacyState(page);
    await page.goto("/");

    // 勾選狀態依舊 `id` 對回清單項目（todo 與 packing 各一）
    await page.locator("nav").getByRole("button", { name: "準備", exact: true }).click();
    await expect(page.getByRole("checkbox", { name: "測試待辦項目" })).toBeChecked();
    await expect(page.getByRole("checkbox", { name: "測試打包項目" })).toBeChecked();

    // 舊帳本紀錄折疊進 expenses：紀錄列顯示名稱、金額與付款方式標籤
    await page.locator("nav").getByRole("button", { name: "記帳", exact: true }).click();
    const expenseRow = page.locator("li").filter({ hasText: "舊消費" });
    await expect(expenseRow).toContainText("-NT$120");
    await expect(expenseRow).toContainText("現金支付");

    // 三個舊 key 已刪除，YAML 成為唯一資料來源
    const migrated = await readMigrationState(page);
    expect(migrated.todoState).toBeNull();
    expect(migrated.packingState).toBeNull();
    expect(migrated.ledgerExpenses).toBeNull();
    expect(migrated.userYaml).toContain("checked: true");
    expect(migrated.userYaml).toContain("舊消費");

    // 重新載入：init script 因 showmeway_user_yaml 已存在而不再播種，
    // 狀態維持不變且消費紀錄只出現一次（不重複匯入）
    await page.reload();
    await page.locator("nav").getByRole("button", { name: "準備", exact: true }).click();
    await expect(page.getByRole("checkbox", { name: "測試待辦項目" })).toBeChecked();
    await expect(page.getByRole("checkbox", { name: "測試打包項目" })).toBeChecked();

    await page.locator("nav").getByRole("button", { name: "記帳", exact: true }).click();
    await expect(page.getByText("舊消費")).toHaveCount(1);
    await expect(expenseRow).toContainText("-NT$120");

    const reloaded = await readMigrationState(page);
    expect(reloaded.todoState).toBeNull();
    expect(reloaded.packingState).toBeNull();
    expect(reloaded.ledgerExpenses).toBeNull();
});
