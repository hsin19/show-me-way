import type { BaseIssue } from "valibot";

/*
 * Turns the first valibot issue into the zh-TW sentence the editor shows. The
 * wording predates the schema and is pinned by `trip.test.ts`, spacing quirks
 * included (`trip的 id` but `confirmation 的 code`), so the rules below
 * reproduce it rather than tidy it -- a saved trip that used to fail with one
 * message should keep failing with the same one.
 */

type PathKey = string | number;

const STRUCTURE_MESSAGE = "YAML 缺少必要的結構 (trip 或 days 區塊)";

/** `("done" | "skipped")`, valibot's rendering of a picklist, as `'done' 或 'skipped'`. */
function listChoices(expected: string): string {
    const values = [...expected.matchAll(/"([^"]*)"/g)].map(m => `'${m[1]}'`);
    if (values.length <= 1) return values.join("");
    return `${values.slice(0, -1).join("、")} 或 ${values[values.length - 1]}`;
}

/**
 * `["days", 0, "timeline", 1, "confirmation"]` → `days 第 1 項的 timeline 第 2 項的 confirmation`.
 * `trip` is named only when it is the immediate parent (`trip的 id`); deeper
 * paths start at the list (`hotels 第 1 項`, never `trip的 hotels 第 1 項`).
 */
function describeContainer(keys: PathKey[]): string {
    const parts: string[] = [];
    keys.forEach((key, index) => {
        if (typeof key === "number") return;
        const next = keys[index + 1];
        if (typeof next === "number") parts.push(`${key} 第 ${next + 1} 項`);
        else if (key !== "trip" || keys.length === 1) parts.push(key);
    });
    return parts.join("的 ");
}

function describeListItem(issue: BaseIssue<unknown>, container: PathKey[], listName: string, index: number): string {
    const where = describeContainer(container.length === 1 && container[0] === "trip" ? [] : container);
    const prefix = where ? `${where}的 ` : "";
    const item = `${listName} 第 ${index + 1} 項`;
    if (issue.type === "string") {
        return issue.received === "null"
            ? `${prefix}${item}必須是文字 (不可為空白列表項)`
            : `${prefix}${item} 必須是文字`;
    }
    if (listName === "todo" || listName === "packing") return `${item}必須是物件 (例如 - text: '項目內容')`;
    if (listName === "expenses") return `${item}必須是物件`;
    return `${prefix}${item}必須是物件 (不可為空白列表項)`;
}

function describeField(issue: BaseIssue<unknown>, container: PathKey[], field: string): string {
    if (container.length === 0) {
        if (field === "trip") return STRUCTURE_MESSAGE;
        if (field === "days") return issue.type === "min_length" ? "days 至少需要一天的行程" : STRUCTURE_MESSAGE;
        return `${field} 必須是列表`;
    }
    const missing = issue.received === "undefined";
    if (container.length === 1 && container[0] === "trip") {
        if (field === "name" || field === "hotels") return "trip 區塊缺少 name (文字) 或 hotels 屬性";
        if (field === "city") return "trip.city 必須是文字 (例如 'Tokyo')";
        if (field === "wallets") return "trip.wallets 必須是文字列表";
        if (field === "mapProvider") return `trip.mapProvider 必須是 ${listChoices(issue.expected ?? "")}`;
    }
    const where = describeContainer(container);
    if (container.length === 2 && container[0] === "days") {
        if (field === "title") return `${where}缺少 title 屬性 (或 title 必須是文字)`;
        if (field === "timeline") return `${where}缺少 timeline 列表`;
        if (field === "date" && !missing) return `${where}的 date 必須是 YYYY-MM-DD 日期格式`;
        if (field === "city") return `${where}的 city 必須是文字 (例如 'Tokyo')`;
    }
    const insideConfirmation = container[container.length - 1] === "confirmation";
    if (missing) return `${where}${insideConfirmation ? " " : ""}缺少 ${field} 屬性`;

    const subject = `${where}${insideConfirmation ? " 的 " : "的 "}${field}`;
    if (insideConfirmation && field === "code") return `${subject} 必須是文字 (數字代碼請加引號，例如 code: '012345')`;
    switch (issue.type) {
        case "string":
            return `${subject} 必須是文字`;
        case "array":
            return `${subject} 必須是列表`;
        case "object":
            return field === "confirmation" ? `${subject} 必須是物件 (包含 code 屬性)` : `${subject} 必須是物件`;
        case "boolean":
            return `${subject} 必須是 true 或 false`;
        case "number":
            return `${subject} 必須是數字`;
        case "integer":
            return `${subject} 必須是整數`;
        case "regex":
            return `${subject} 必須是 YYYY-MM-DD 日期格式`;
        case "picklist":
            return `${subject} 必須是 ${listChoices(issue.expected ?? "")}`;
        default:
            return `${subject} 格式不正確`;
    }
}

/** The zh-TW message for one issue from `itinerarySchema`, safe to show the user verbatim. */
export function describeIssue(issue: BaseIssue<unknown>): string {
    // valibot reports a missing key as an issue on the parent object with the key appended, so the path always ends at the offending field or list item.
    const keys = (issue.path ?? []).map(segment => segment.key as PathKey);
    if (keys.length === 0) return "YAML 內容為空或格式不正確";
    const last = keys[keys.length - 1];
    if (typeof last === "number") return describeListItem(issue, keys.slice(0, -2), String(keys[keys.length - 2]), last);
    return describeField(issue, keys.slice(0, -1), last);
}
