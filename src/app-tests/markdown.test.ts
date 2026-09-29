import { FIXTURE_YAML } from "$lib/testing/fixture-trip";
import {
    screen,
    waitFor,
} from "@testing-library/dom";
import {
    expect,
    test,
} from "vitest";
import {
    firstDayChip,
    launchApp,
    navTab,
} from "./harness";

// Inline Markdown in itinerary prose (src/lib/domain/markdown.ts, rendered by
// RichText.svelte). The parsing rules have unit coverage; what these show is that
// the markup reaches the DOM as real elements and that a hostile href never becomes
// a live link. That a link inside a checklist row does not tick the row is the
// browser's label activation, which happy-dom does not implement, so it stays in
// e2e/tests/markdown.spec.ts.
//
// No page-error assertions: an error escaping a component fails the whole vitest run.

const MD_YAML = FIXTURE_YAML
    .replace(
        "        desc: 第一天的測試事件",
        [
            "        desc: '第一天的測試事件，詳見[官方售票頁](https://example.com/tickets)與 **粗體提醒**'",
            "        bullets:",
            "          - '包包限制 `12\"×12\"`，*斜體*說明'",
            "          - '[惡意連結](javascript:alert(1)) 不可點'",
        ].join("\n"),
    );

/** Launches on `yaml` and opens day 1, whose event carries the prose under test. */
async function openDayOne(yaml: string) {
    const app = await launchApp(yaml);
    await waitFor(firstDayChip);
    await app.user.click(firstDayChip());
    return app;
}

test("行程敘述的 Markdown 連結只顯示標籤，粗體成為真正的 strong", async () => {
    await openDayOne(MD_YAML);

    const link = await screen.findByRole("link", { name: "官方售票頁" });
    expect(link.getAttribute("href")).toBe("https://example.com/tickets");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");

    // 網址本身不出現在畫面上 —— 這是改用 Markdown 的重點。
    expect(screen.queryByText("https://example.com/tickets")).toBeNull();

    expect(screen.getByText("粗體提醒").tagName).toBe("STRONG");
    expect(screen.getByText('12"×12"').tagName).toBe("CODE");
    expect(screen.getByText("斜體").tagName).toBe("EM");
});

test("javascript: 連結不會成為可點連結，整段維持字面文字", async () => {
    await openDayOne(MD_YAML);

    await screen.findByText("[惡意連結](javascript:alert(1)) 不可點");
    expect(screen.queryByRole("link", { name: "惡意連結" })).toBeNull();
});

test("裸網址不再自動變成連結", async () => {
    await openDayOne(FIXTURE_YAML.replace(
        "        desc: 第一天的測試事件",
        "        desc: '第一天的測試事件 https://example.com/bare'",
    ));

    await screen.findByText("第一天的測試事件 https://example.com/bare");
    expect(screen.queryByRole("link", { name: /example\.com/ })).toBeNull();
});

test("links 與 mapLink 的 javascript: 目標不會進到 DOM", async () => {
    // 這兩個 href 跟 Markdown 連結來自同一份匯入的 YAML，所以走同一道
    // sanitizeHref：links 的整顆 chip 消失，mapLink 則退回 localName 搜尋。
    await openDayOne(FIXTURE_YAML.replace(
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
    ));

    const ok = await screen.findByRole("link", { name: "正常官網" });
    expect(ok.getAttribute("href")).toBe("https://example.com/ok");
    expect(screen.queryByRole("link", { name: "惡意チップ" })).toBeNull();
    expect(document.querySelectorAll("a[href^='javascript:']")).toHaveLength(0);
    // Map chip 仍在，只是改用 localName 搜尋，而不是那個被拒絕的 mapLink。
    expect(screen.getByRole("link", { name: "Map" }).getAttribute("href")).toMatch(/^https:\/\/www\.google\.com\/maps\/search/);
});

test("links 的 tel: 仍可用（改用白名單後不能把電話 chip 弄不見）", async () => {
    await openDayOne(FIXTURE_YAML.replace(
        "        desc: 第一天的測試事件",
        [
            "        desc: 第一天的測試事件",
            "        links:",
            "          - label: 訂位電話",
            "            url: 'tel:+81312345678'",
        ].join("\n"),
    ));

    const tel = await screen.findByRole("link", { name: "訂位電話" });
    expect(tel.getAttribute("href")).toBe("tel:+81312345678");
});

test("links 缺少 url 時在載入這關就被擋下，而不是渲染時炸掉", async () => {
    // 開機路徑把訊息收斂成一句通用文案（確切訊息由 src/lib/domain/trip.test.ts 斷言），這裡要證的
    // 是「擋在 validateYaml，不是讓 undefined 走到 sanitizeLinkHref」。
    await launchApp(FIXTURE_YAML.replace(
        "        desc: 第一天的測試事件",
        [
            "        desc: 第一天的測試事件",
            "        links:",
            "          - label: 官網",
        ].join("\n"),
    ));

    await screen.findByText("無法載入或解析行程資料。請開啟設定確認 YAML 語法。");
});

test("事件缺少 desc、待辦缺少 text 時只是空白，不會讓整頁掛掉", async () => {
    // 兩個欄位在 normalizeTripData 都是選填，缺了只該少一行字。改用 parser 之後
    // 一旦拋錯就會連整個日程面板／準備頁一起帶走。
    const { user } = await openDayOne(
        FIXTURE_YAML
            .replace("        desc: 第一天的測試事件\n", "")
            .replace("  - text: 測試待辦項目", "  - checked: false"),
    );
    await screen.findByText("測試事件一");

    await user.click(navTab("工具"));
    await screen.findByRole("heading", { name: "行前準備與打包" });
});
