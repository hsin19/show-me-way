import {
    serializeToYaml,
    validateYaml,
} from "$lib/domain/trip";
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
    type AppPage,
    firstDayChip,
    launchApp,
    navTab,
    status,
} from "./harness";

// 編輯模式：日程卡上的「編輯」打開後，每張事件卡的時間、標題、說明、地址都直接是輸入框，
// 改完按右下角的 ✓ 一次存回 showmeway_user_yaml，一個復原退回全部。寫回的 bytes 用 canonical
// 形式比對整份：沒動到的欄位（早餐的多行 desc）要一個 byte 都不變，否則每次存檔都會被當成
// 一次編輯。午餐用文字寫時間、晚班機用 start / end，兩種寫法可以互相切換。

const canonical = (yaml: string) => serializeToYaml(validateYaml(yaml));

const TRIP = (timeline: string) =>
    canonical(`trip:
  name: 編輯測試
  id: t-edit
  hotels:
    - title: 測試飯店
      start: '2099-03-01T15:00'
      end: '2099-03-02T11:00'
days:
  - date: '2099-03-01'
    title: 第一天
    timeline:
${timeline}`);

const BREAKFAST = (time: string) =>
    `      - time: '${time}'
        title: 早餐
        desc: |
          第一行
          第二行
`;
const LUNCH = `      - time: '12:00'
        title: 午餐
`;
const FLIGHT = (start: string, end: string) =>
    `      - title: 晚班機
        start: '2099-03-01T${start}'
        end: '${end}'
`;

const ORIGINAL = TRIP(BREAKFAST("09:00") + LUNCH + FLIGHT("19:00", "2099-03-01T21:00"));

const stored = () => window.localStorage.getItem("showmeway_user_yaml");

/** Event titles in the order the open day shows them, outside edit mode. */
const order = () => screen.getAllByText(/^(早餐|午餐|晚班機)$/).map(el => el.textContent);

/** The same in edit mode, where every title is an input. */
const titleInputs = () => screen.queryAllByLabelText<HTMLInputElement>("標題");

/** An event's card in edit mode, found by what its title input holds. */
function card(title: string): HTMLElement {
    const input = titleInputs().find(el => el.value === title);
    const panel = input?.closest<HTMLElement>(".panel");
    if (!panel) throw new Error(`no card editing ${title}`);
    return panel;
}

const finish = ({ user }: AppPage) => user.click(screen.getByRole("button", { name: "完成" }));

async function openDay(): Promise<AppPage> {
    const page = await launchApp(ORIGINAL);
    await waitFor(firstDayChip);
    await page.user.click(firstDayChip());
    await screen.findByRole("heading", { name: "第一天" });
    return page;
}

/** Edit mode sits in the row the open card's header ⋯ unfolds, beside share. */
async function startEditing({ user }: AppPage): Promise<void> {
    await user.click(screen.getByRole("button", { name: "更多" }));
    await user.click(screen.getByRole("button", { name: "編輯行程" }));
}

async function editMode(): Promise<AppPage> {
    const page = await openDay();
    await startEditing(page);
    await waitFor(() => expect(titleInputs().map(el => el.value)).toEqual(["早餐", "午餐", "晚班機"]));
    return page;
}

test("改時間要等按完成才存、才依時間重排；沒動的欄位原樣保留，復原回到原本", async () => {
    const page = await editMode();

    await page.fill(within(card("早餐")).getByLabelText("時間"), "13:00");
    // 打字當下卡片不跳位置，也還沒寫回。
    expect(titleInputs().map(el => el.value)).toEqual(["早餐", "午餐", "晚班機"]);
    expect(stored()).toBe(ORIGINAL);

    await finish(page);
    await waitFor(() => expect(titleInputs()).toHaveLength(0));
    expect(order()).toEqual(["午餐", "早餐", "晚班機"]);
    expect(stored()).toBe(TRIP(LUNCH + BREAKFAST("13:00") + FLIGHT("19:00", "2099-03-01T21:00")));

    await waitFor(() => expect(status().textContent).toContain("已更新「早餐」"));
    await page.user.click(within(status()).getByRole("button", { name: "復原" }));
    await waitFor(() => expect(order()).toEqual(["早餐", "午餐", "晚班機"]));
    expect(stored()).toBe(ORIGINAL);
});

test("一次改好幾張卡，按一次完成就一起存，一個復原全部退回", async () => {
    const page = await editMode();

    await page.fill(within(card("早餐")).getByLabelText("說明"), "改過的早餐");
    await page.fill(within(card("午餐")).getByLabelText("地址"), "Via Roma 1");
    await page.fill(within(card("午餐")).getByLabelText("標題"), "午餐改名");
    await finish(page);

    await waitFor(() => expect(status().textContent).toContain("已更新 2 個事件"));
    expect(stored()).toBe(TRIP(`      - time: '09:00'
        title: 早餐
        desc: 改過的早餐
      - time: '12:00'
        title: 午餐改名
        address: Via Roma 1
${FLIGHT("19:00", "2099-03-01T21:00")}`));

    await page.user.click(within(status()).getByRole("button", { name: "復原" }));
    await waitFor(() => expect(stored()).toBe(ORIGINAL));
});

test("時間可以在文字和起訖時間之間切換，切過去會帶入原本寫的時間", async () => {
    const page = await editMode();

    // 起訖時間排第一個：鼓勵用 App 讀得懂的寫法。
    expect(within(within(card("午餐")).getByRole("group", { name: "時間寫法" })).getAllByRole("button").map(el => el.textContent?.trim())).toEqual(["起訖時間", "文字"]);
    await page.user.click(within(card("午餐")).getByRole("button", { name: "起訖時間" }));
    expect(within(card("午餐")).getByLabelText<HTMLInputElement>("開始").value).toBe("12:00");
    await page.fill(within(card("午餐")).getByLabelText("結束"), "13:30");

    await page.user.click(within(card("晚班機")).getByRole("button", { name: "文字" }));
    expect(within(card("晚班機")).getByLabelText<HTMLInputElement>("時間").value).toBe("19:00 - 21:00");

    await finish(page);
    await waitFor(() => expect(titleInputs()).toHaveLength(0));
    expect(stored()).toBe(TRIP(`${BREAKFAST("09:00")}      - start: '2099-03-01T12:00'
        end: '2099-03-01T13:30'
        title: 午餐
      - time: '19:00 - 21:00'
        title: 晚班機
`));
});

test("存不了的不放人走：卡片上說原因、toast 指出是哪一張，改好再按完成才存", async () => {
    const page = await editMode();

    await page.fill(within(card("晚班機")).getByLabelText("結束"), "18:00");
    await page.fill(within(card("早餐")).getByLabelText("標題"), "");
    await finish(page);

    await waitFor(() => expect(status().textContent).toContain("「早餐」：標題不能空白"));
    expect(within(card("晚班機")).getByRole("alert").textContent).toContain("結束時間早於開始時間");
    expect(titleInputs()).toHaveLength(3);
    expect(stored()).toBe(ORIGINAL);

    await page.fill(titleInputs()[0]!, "早餐");
    await page.fill(within(card("晚班機")).getByLabelText("開始"), "20:30");
    await page.fill(within(card("晚班機")).getByLabelText("結束"), "22:45");
    await finish(page);

    await waitFor(() => expect(titleInputs()).toHaveLength(0));
    expect(stored()).toBe(TRIP(BREAKFAST("09:00") + LUNCH + FLIGHT("20:30", "2099-03-01T22:45")));
});

test("只有編輯模式才有輸入框，住宿節點不能改；草稿切分頁回來還在，取消前會先問", async () => {
    const page = await openDay();
    expect(titleInputs()).toHaveLength(0);
    expect(screen.getAllByRole("button", { name: "標記為已完成" })).toHaveLength(3);

    await startEditing(page);
    // 自動產生的「回飯店休息」照樣是字，打卡按鈕也收起來。
    await waitFor(() => expect(titleInputs()).toHaveLength(3));
    expect(screen.getByText("回飯店休息")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "標記為已完成" })).toBeNull();
    // 編輯中標題卡的 ⋯ 收起來，離開只走日期列右邊出現的 ✕ 和 ✓。
    expect(screen.queryByRole("button", { name: "更多" })).toBeNull();

    await page.fill(within(card("早餐")).getByLabelText("說明"), "改過的說明");
    await page.user.click(navTab("工具"));
    await page.user.click(navTab("行程"));
    await waitFor(() => expect(within(card("早餐")).getByLabelText<HTMLTextAreaElement>("說明").value).toBe("改過的說明"));

    page.answerDialogs(false, true);
    await page.user.click(screen.getByRole("button", { name: "取消" }));
    expect(page.dialogs).toEqual(["要放棄這次的修改嗎？"]);
    expect(titleInputs()).toHaveLength(3);

    await page.user.click(screen.getByRole("button", { name: "取消" }));
    await waitFor(() => expect(titleInputs()).toHaveLength(0));
    expect(stored()).toBe(ORIGINAL);

    // 什麼都沒改就不用問。
    await startEditing(page);
    await page.user.click(screen.getByRole("button", { name: "取消" }));
    await waitFor(() => expect(titleInputs()).toHaveLength(0));
    expect(page.dialogs).toHaveLength(2);
});

test("總覽也能進編輯模式，切到某一天就能改；展開的那排再按一次就收起來", async () => {
    const page = await launchApp(ORIGINAL);
    await screen.findByRole("heading", { level: 2, name: "編輯測試" });

    // 分享和編輯都收在標題旁的 ⋯ 裡：兩個都不常用，卡片標題列留給讀的人。
    await page.user.click(screen.getByRole("button", { name: "更多" }));
    expect(screen.getByRole("button", { name: "分享行程" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "編輯行程" })).toBeTruthy();
    await page.user.click(screen.getByRole("button", { name: "更多" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "編輯行程" })).toBeNull());

    // 總覽目前沒有能改的欄位，進了編輯模式就待在原地，✕ ✓ 照樣在。
    await startEditing(page);
    expect(screen.getByRole("heading", { level: 2, name: "編輯測試" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "完成" })).toBeTruthy();

    await page.user.click(firstDayChip());
    await screen.findByRole("heading", { name: "第一天" });
    await waitFor(() => expect(titleInputs().map(el => el.value)).toEqual(["早餐", "午餐", "晚班機"]));
});
