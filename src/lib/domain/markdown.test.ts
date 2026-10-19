import {
    describe,
    expect,
    it,
} from "vitest";
import {
    type BlockNode,
    type InlineNode,
    type ListBlock,
    parseInline,
    parseMarkdown,
    sanitizeHref,
    sanitizeLinkHref,
} from "./markdown";

/** Compact view of a node tree, so expectations read like the source text. */
function shape(text: string): string {
    const walk = (nodes: InlineNode[]): string =>
        nodes.map(n => {
            switch (n.type) {
                case "text":
                    return n.value;
                case "code":
                    return `code(${n.value})`;
                case "strong":
                    return `B(${walk(n.children)})`;
                case "em":
                    return `I(${walk(n.children)})`;
                case "link":
                    return `A(${walk(n.children)}→${n.href})`;
            }
        }).join("");
    return walk(parseInline(text));
}

describe("parseInline", () => {
    it("returns an empty list for empty text", () => {
        expect(parseInline("")).toEqual([]);
    });

    it("returns plain prose as a single text node", () => {
        expect(parseInline("早上九點在飯店大廳集合")).toEqual([
            { type: "text", value: "早上九點在飯店大廳集合" },
        ]);
    });

    it("parses a link and shows only its label", () => {
        expect(shape("詳見 [官方售票頁](https://alcatrazcitycruises.com/tickets/)，記得先訂"))
            .toBe("詳見 A(官方售票頁→https://alcatrazcitycruises.com/tickets/)，記得先訂");
    });

    it("keeps a link glued to Chinese with no spaces", () => {
        expect(shape("詳見[官網](https://a.com)說明")).toBe("詳見A(官網→https://a.com)說明");
    });

    it("parses bold, italic and code", () => {
        expect(shape('包包 **5"×9"×1" 以內**，*建議*先量 `12.75in`'))
            .toBe('包包 B(5"×9"×1" 以內)，I(建議)先量 code(12.75in)');
    });

    it("nests emphasis inside a link label", () => {
        expect(shape("[**必訂**票](https://a.com)")).toBe("A(B(必訂)票→https://a.com)");
    });

    it("does not nest a link inside a link", () => {
        expect(shape("[a [b](https://x.com) c](https://y.com)"))
            .toBe("A(a [b](https://x.com) c→https://y.com)");
    });

    it("nests strong inside em, not just em inside strong", () => {
        expect(shape("*外層 **內層粗體** 收尾*")).toBe("I(外層 B(內層粗體) 收尾)");
        expect(shape("**外層 *內層斜體* 收尾**")).toBe("B(外層 I(內層斜體) 收尾)");
    });

    it("reads a triple run as both", () => {
        expect(shape("***非常重要***")).toBe("I(B(非常重要))");
    });

    it("leaves a masking run of asterisks alone", () => {
        // `****` used to close on itself and render an empty <strong>, i.e. the
        // asterisks vanished off the screen.
        expect(shape("卡號 ****1234")).toBe("卡號 ****1234");
        expect(shape("****")).toBe("****");
    });

    it("leaves spaced-out arithmetic alone", () => {
        expect(shape("3 * 4 * 5 公尺")).toBe("3 * 4 * 5 公尺");
    });

    it("leaves an unclosed delimiter as literal text", () => {
        expect(shape("**沒有收尾")).toBe("**沒有收尾");
        expect(shape("價格 5* 起")).toBe("價格 5* 起");
        expect(shape("`沒收尾")).toBe("`沒收尾");
    });

    it("treats code span content as literal", () => {
        expect(shape("`**not bold**`")).toBe("code(**not bold**)");
    });

    it("does not let a code span or a link target close an enclosing emphasis", () => {
        expect(shape("**注意 `a**b` 結束**")).toBe("B(注意 code(a**b) 結束)");
        expect(shape("*見 [連結](https://a.com/*x*) 後*")).toBe("I(見 A(連結→https://a.com/*x*) 後)");
    });

    it("honors backslash escapes", () => {
        expect(shape("\\*不是斜體\\*")).toBe("*不是斜體*");
        expect(shape("\\[不是連結](https://a.com)")).toBe("[不是連結](https://a.com)");
    });

    it("keeps a link whose href contains balanced parentheses", () => {
        expect(shape("[東京](https://en.wikipedia.org/wiki/Tokyo_(city))"))
            .toBe("A(東京→https://en.wikipedia.org/wiki/Tokyo_(city))");
    });

    it("strips the escapes from an href, not just from the label", () => {
        // The escape exists so an UNbalanced paren can go in a URL; leaving the
        // backslashes in sends the reader somewhere else entirely.
        expect(parseInline("[標籤](https://a.com/p\\(1\\))")).toEqual([
            { type: "link", href: "https://a.com/p(1)", children: [{ type: "text", value: "標籤" }] },
        ]);
    });

    it("does not auto-link a bare URL", () => {
        expect(parseInline("詳見 https://example.com/abc")).toEqual([
            { type: "text", value: "詳見 https://example.com/abc" },
        ]);
    });

    it("leaves a link with an unsafe href as literal text", () => {
        expect(shape("[點我](javascript:alert(1))")).toBe("[點我](javascript:alert(1))");
        expect(shape("[點我](data:text/html;base64,AAA)")).toBe("[點我](data:text/html;base64,AAA)");
    });

    it("leaves a link with an empty label or href as literal text", () => {
        expect(shape("[](https://a.com)")).toBe("[](https://a.com)");
        expect(shape("[標籤]()")).toBe("[標籤]()");
    });

    it("degrades to nothing instead of throwing on a non-string field", () => {
        // `normalizeTripData` rejects these, but a `desc` that is simply absent
        // used to render an empty paragraph — it must not take the day panel
        // down now that the same field goes through a parser.
        const notStrings: unknown[] = [undefined, null, 42, {}];
        for (const bad of notStrings) {
            expect(parseInline(bad as string)).toEqual([]);
        }
    });
});

/** Blocks in the same compact notation as `shape`, one per line, lines of a paragraph or item joined by ⏎. */
function blocks(text: string): string[] {
    const walk = (nodes: InlineNode[]): string => nodes.map(n => (n.type === "text" || n.type === "code" ? n.value : n.type === "link" ? `A(${walk(n.children)}→${n.href})` : `${n.type === "strong" ? "B" : "I"}(${walk(n.children)})`)).join("");
    const lines = (list: InlineNode[][]) => list.map(walk).join("⏎");
    const list = (block: ListBlock): string => `${block.ordered ? `ol@${block.start}` : "ul"}: ${block.items.map(item => lines(item.lines) + (item.sublist ? ` [${list(item.sublist)}]` : "")).join(" | ")}`;
    return parseMarkdown(text).map((block: BlockNode) => {
        switch (block.type) {
            case "paragraph":
                return `p: ${lines(block.lines)}`;
            case "heading":
                return `h${block.level}: ${walk(block.children)}`;
            case "list":
                return list(block);
            case "rule":
                return "hr";
        }
    });
}

describe("parseMarkdown", () => {
    it("reads one line of prose as one paragraph, which is all an existing field is", () => {
        expect(blocks("先到 **Gate 2** 排安檢")).toEqual(["p: 先到 B(Gate 2) 排安檢"]);
        expect(parseMarkdown("")).toEqual([]);
        expect(parseMarkdown(undefined)).toEqual([]);
    });

    it("splits paragraphs on a blank line and keeps a single newline as a line break", () => {
        expect(blocks("第一行\n第二行\n\n另一段")).toEqual(["p: 第一行⏎第二行", "p: 另一段"]);
    });

    it("reads headings, lists and rules the way a model writes them, without blank lines between", () => {
        expect(blocks("### 1. 國際長途飛行\n* **去程**：約 13.5 小時\n* **回程**：約 6.75 小時\n---\n2. 搭火車\n3. 搭船")).toEqual([
            "h3: 1. 國際長途飛行",
            "ul: B(去程)：約 13.5 小時 | B(回程)：約 6.75 小時",
            "hr",
            "ol@2: 搭火車 | 搭船",
        ]);
    });

    it("nests an indented item one level under the item above, and continues an item with an indented line", () => {
        expect(blocks("- 羅馬\n  - 競技場\n  先寄行李\n- 佛羅倫斯")).toEqual(["ul: 羅馬 [ul: 競技場⏎先寄行李] | 佛羅倫斯"]);
        // The shape gemini-3.6-flash wrote for 五漁村's rainy-day options.
        expect(blocks("* **搭火車串村**\n  村落之間多在隧道\n  * **品嚐白酒**\n  * **海景咖啡館**\n* **教堂巡禮**")).toEqual([
            "ul: B(搭火車串村)⏎村落之間多在隧道 [ul: B(品嚐白酒) | B(海景咖啡館)] | B(教堂巡禮)",
        ]);
    });

    it("keeps nesting one level deep, folding anything deeper into the nested list", () => {
        expect(blocks("1. 去程\n   - 桃園\n     - T2 報到\n2. 回程")).toEqual(["ol@1: 去程 [ul: 桃園 | T2 報到] | 回程"]);
    });

    it("parses inline Markdown inside every block, unsafe links included", () => {
        expect(blocks("- [官網](https://example.com)\n- [惡意](javascript:alert(1))")).toEqual(["ul: A(官網→https://example.com) | [惡意](javascript:alert(1))"]);
    });

    it("leaves tables and quotes as literal paragraph text", () => {
        expect(blocks("| 天 | 城市 |\n> 引言")).toEqual(["p: | 天 | 城市 |⏎> 引言"]);
    });
});

describe("sanitizeHref", () => {
    it("passes http, https and mailto through untouched", () => {
        expect(sanitizeHref("https://a.com/x?y=1#z")).toBe("https://a.com/x?y=1#z");
        expect(sanitizeHref("http://a.com")).toBe("http://a.com");
        expect(sanitizeHref("mailto:a@b.com")).toBe("mailto:a@b.com");
    });

    it("gives a bare domain an https scheme", () => {
        expect(sanitizeHref("www.example.com/ex-reserve")).toBe("https://www.example.com/ex-reserve");
        expect(sanitizeHref("example.com")).toBe("https://example.com");
    });

    it("keeps a port on a bare domain instead of reading it as a scheme", () => {
        expect(sanitizeHref("booking.example.com:8443/x")).toBe("https://booking.example.com:8443/x");
    });

    it("accepts an internationalized bare domain", () => {
        expect(sanitizeHref("例え.jp/tickets")).toBe("https://例え.jp/tickets");
    });

    it("gives a protocol-relative URL an https scheme", () => {
        expect(sanitizeHref("//a.com/x")).toBe("https://a.com/x");
    });

    it("rejects script-bearing and unknown schemes", () => {
        expect(sanitizeHref("javascript:alert(1)")).toBeNull();
        expect(sanitizeHref("JavaScript:alert(1)")).toBeNull();
        expect(sanitizeHref("data:text/html,<script>")).toBeNull();
        expect(sanitizeHref("vbscript:msgbox")).toBeNull();
    });

    it("rejects a scheme hidden behind whitespace or control characters", () => {
        expect(sanitizeHref("java\tscript:alert(1)")).toBeNull();
        expect(sanitizeHref("java\u0000script:alert(1)")).toBeNull();
        expect(sanitizeHref(" javascript:alert(1)")).toBeNull();
    });

    it("rejects anything that is not a destination", () => {
        expect(sanitizeHref("")).toBeNull();
        expect(sanitizeHref("   ")).toBeNull();
        expect(sanitizeHref("nonsense")).toBeNull();
        // Same-origin forms: there is nothing in this app to point at, and
        // concatenating them onto `https://` built a malformed URL.
        expect(sanitizeHref("/abs/path.html")).toBeNull();
        expect(sanitizeHref("./rel.html")).toBeNull();
        expect(sanitizeHref("#a.b")).toBeNull();
        expect(sanitizeHref("?q=1.2")).toBeNull();
        expect(sanitizeHref("//evil")).toBeNull();
        expect(sanitizeHref("\\\\evil.com")).toBeNull();
        // A number, not a host.
        expect(sanitizeHref("56.23")).toBeNull();
    });

    it("rejects a scheme with no destination after it", () => {
        expect(sanitizeHref("mailto:")).toBeNull();
        expect(sanitizeHref("https:")).toBeNull();
        expect(sanitizeHref("http://")).toBeNull();
    });

    it("returns null instead of throwing on a non-string", () => {
        // `links[].url` and `mapLink` reach this straight from user YAML.
        for (const bad of [undefined, null, 12345, new Date()] as unknown[]) {
            expect(sanitizeHref(bad)).toBeNull();
            expect(sanitizeLinkHref(bad)).toBeNull();
        }
    });
});

describe("sanitizeLinkHref", () => {
    it("also accepts the hand-off schemes an author labels themselves", () => {
        // `links[].url` accepted these long before any sanitizing existed;
        // dropping them would silently delete a chip on upgrade.
        expect(sanitizeLinkHref("tel:+81312345678")).toBe("tel:+81312345678");
        expect(sanitizeLinkHref("sms:+81312345678")).toBe("sms:+81312345678");
        expect(sanitizeLinkHref("geo:35.6,139.7")).toBe("geo:35.6,139.7");
        expect(sanitizeLinkHref("https://naver.me/abc")).toBe("https://naver.me/abc");
    });

    it("still rejects script-bearing schemes and app deep links", () => {
        expect(sanitizeLinkHref("javascript:alert(1)")).toBeNull();
        expect(sanitizeLinkHref("data:text/html,x")).toBeNull();
        expect(sanitizeLinkHref("line://ti/p/@shop")).toBeNull();
        expect(sanitizeLinkHref("tel:")).toBeNull();
    });

    it("keeps prose on the narrower list", () => {
        expect(sanitizeHref("tel:+81312345678")).toBeNull();
        expect(sanitizeHref("geo:35.6,139.7")).toBeNull();
    });
});
