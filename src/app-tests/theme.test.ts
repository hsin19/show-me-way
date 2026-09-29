import { screen } from "@testing-library/dom";
import { test } from "vitest";
import {
    launchApp,
    navTab,
} from "./harness";

// The one theme case that is app logic rather than theme resolution: App 設定 holds
// the theme picker, and it must stay reachable when the trip failed to load. The rest
// of e2e/tests/theme.spec.ts checks the theme resolved at load — by index.html's
// pre-paint script and main.ts's initTheme(), neither of which runs here, since the
// harness mounts App.svelte alone — or reads CSS tokens, which happy-dom never loads.

test("設定頁：載入失敗時仍可到達（主題與行程資料無關）", async () => {
    const { user } = await launchApp("這不是有效的 YAML: [");
    // The premise: without it a fallback to the bundled template would pass this too.
    await screen.findByText("無法載入或解析行程資料。請開啟設定確認 YAML 語法。");

    await user.click(navTab("工具"));
    await user.click(screen.getByRole("button", { name: "App 設定" }));
    await screen.findByRole("heading", { level: 3, name: "外觀" });
});
