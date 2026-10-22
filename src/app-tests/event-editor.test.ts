import {
    serializeToYaml,
    validateYaml,
} from "$lib/domain/trip";
import {
    fireEvent,
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

// 編輯模式：卡片標題旁的 ⋯ →「編輯行程」打開後，畫面換成整趟行程的草稿，每個字都直接是輸入框，
// 事件可以插入、刪除、上下移動；改完按日期列右邊的 ✓ 一次存回 showmeway_user_yaml，一個復原退回
// 全部。寫回的 bytes 用 canonical 形式比對整份：沒動到的欄位（早餐的多行 desc）要一個 byte 都不變，
// 否則每次存檔都會被當成一次編輯。午餐用文字寫時間、晚班機用 start / end，兩種寫法可以互相切換。

const canonical = (yaml: string) => serializeToYaml(validateYaml(yaml));

const HOTEL = `    - title: 測試飯店
      start: '2099-03-01T15:00'
      end: '2099-03-02T11:00'
`;

const TRIP = (timeline: string, { hotels = HOTEL, trip = "", day = "", laterDays = "" } = {}) =>
    canonical(`trip:
  name: 編輯測試
  id: t-edit
${trip}  hotels:
${hotels}days:
  - date: '2099-03-01'
    title: 第一天
${day}    timeline:
${timeline}${laterDays}`);

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
const order = () => screen.getAllByText(/^(早餐|午餐|晚班機|咖啡)$/).map(el => el.textContent);

/** The same in edit mode, where every title is an input. */
const titleInputs = () => screen.queryAllByLabelText<HTMLInputElement>("標題");
const editing = () => titleInputs().map(el => el.value);

/** An entry's editor in edit mode, found by what its title input holds. */
function card(title: string): HTMLElement {
    const panel = titleInputs().find(el => el.value === title)?.closest<HTMLElement>(".panel");
    if (!panel) throw new Error(`no card editing ${title}`);
    return panel;
}

const finish = ({ user }: AppPage) => user.click(screen.getByRole("button", { name: "完成" }));

/** Edit mode sits in the row the open card's header ⋯ unfolds, beside share. */
async function startEditing({ user }: AppPage): Promise<void> {
    await user.click(screen.getByRole("button", { name: "更多" }));
    await user.click(screen.getByRole("button", { name: "編輯行程" }));
}

async function openDay(yaml = ORIGINAL): Promise<AppPage> {
    const page = await launchApp(yaml);
    await waitFor(firstDayChip);
    await page.user.click(firstDayChip());
    await screen.findByRole("heading", { name: "第一天" });
    return page;
}

async function editMode(yaml = ORIGINAL): Promise<AppPage> {
    const page = await openDay(yaml);
    await startEditing(page);
    await waitFor(() => expect(titleInputs().length).toBeGreaterThan(0));
    return page;
}

async function saved(page: AppPage): Promise<void> {
    await finish(page);
    await waitFor(() => expect(titleInputs()).toHaveLength(0));
}

test("改時間要等按完成才存、才依時間重排；沒動的欄位原樣保留，復原回到原本", async () => {
    const page = await editMode();

    await page.fill(within(card("早餐")).getByLabelText("時間"), "13:00");
    // 打字當下卡片不跳位置，也還沒寫回。
    expect(editing()).toEqual(["早餐", "午餐", "晚班機"]);
    expect(stored()).toBe(ORIGINAL);

    await saved(page);
    expect(order()).toEqual(["午餐", "早餐", "晚班機"]);
    expect(stored()).toBe(TRIP(LUNCH + BREAKFAST("13:00") + FLIGHT("19:00", "2099-03-01T21:00")));

    await waitFor(() => expect(status().textContent).toContain("已儲存修改"));
    await page.user.click(within(status()).getByRole("button", { name: "復原" }));
    await waitFor(() => expect(order()).toEqual(["早餐", "午餐", "晚班機"]));
    expect(stored()).toBe(ORIGINAL);
});

test("一次改好幾張卡，按一次完成就一起存，一個復原全部退回", async () => {
    const page = await editMode();

    await page.fill(within(card("早餐")).getByLabelText("說明"), "改過的早餐");
    await page.fill(within(card("午餐")).getByLabelText("地址"), "Via Roma 1");
    await page.fill(within(card("午餐")).getByLabelText("標題"), "午餐改名");
    await saved(page);

    expect(stored()).toBe(TRIP(`      - time: '09:00'
        title: 早餐
        desc: 改過的早餐
      - time: '12:00'
        title: 午餐改名
        address: Via Roma 1
${FLIGHT("19:00", "2099-03-01T21:00")}`));

    await waitFor(() => expect(status().textContent).toContain("已儲存修改"));
    await page.user.click(within(status()).getByRole("button", { name: "復原" }));
    await waitFor(() => expect(stored()).toBe(ORIGINAL));
});

test("時間可以在起訖時間和文字之間切換，切過去會帶入原本寫的時間", async () => {
    const page = await editMode();

    // 起訖時間排第一個：鼓勵用 App 讀得懂的寫法。
    expect(within(within(card("午餐")).getByRole("group", { name: "時間寫法" })).getAllByRole("button").map(el => el.textContent?.trim())).toEqual(["起訖時間", "文字"]);
    await page.user.click(within(card("午餐")).getByRole("button", { name: "起訖時間" }));
    expect(within(card("午餐")).getByLabelText<HTMLInputElement>("開始").value).toBe("12:00");
    await page.fill(within(card("午餐")).getByLabelText("結束"), "13:30");

    await page.user.click(within(card("晚班機")).getByRole("button", { name: "文字" }));
    expect(within(card("晚班機")).getByLabelText<HTMLInputElement>("時間").value).toBe("19:00 - 21:00");

    await saved(page);
    expect(stored()).toBe(TRIP(`${BREAKFAST("09:00")}      - start: '2099-03-01T12:00'
        end: '2099-03-01T13:30'
        title: 午餐
      - time: '19:00 - 21:00'
        title: 晚班機
`));
});

test("存不了的不放人走：卡片上說原因、toast 指出是哪一張，改好再按完成才存", async () => {
    const page = await editMode();

    await page.fill(within(card("早餐")).getByLabelText("標題"), "");
    // 標題清空的那張只剩說明可以認，從說明往上找它的卡片。
    const breakfast = screen.getByDisplayValue(/第一行/).closest<HTMLElement>(".panel")!;
    await page.user.click(within(card("午餐")).getByRole("button", { name: "文字" }));
    await page.fill(within(card("午餐")).getByLabelText("時間"), "");
    await finish(page);

    await waitFor(() => expect(status().textContent).toContain("「未命名事件」：標題不能空白"));
    expect(within(breakfast).getByRole("alert").textContent).toContain("標題不能空白");
    expect(within(card("午餐")).getByRole("alert").textContent).toContain("時間不能空白");
    expect(titleInputs()).toHaveLength(3);
    expect(stored()).toBe(ORIGINAL);

    await page.fill(within(breakfast).getByLabelText("標題"), "早餐");
    await page.fill(within(card("午餐")).getByLabelText("時間"), "12:00");
    await saved(page);
    expect(stored()).toBe(ORIGINAL);
});

test("起訖時間的結束早於開始時算到隔天，像紅眼班機", async () => {
    const page = await editMode();

    await page.fill(within(card("晚班機")).getByLabelText("開始"), "23:30");
    await page.fill(within(card("晚班機")).getByLabelText("結束"), "06:10");
    await saved(page);
    expect(stored()).toBe(TRIP(BREAKFAST("09:00") + LUNCH + FLIGHT("23:30", "2099-03-02T06:10")));
});

test("事件可以插入、刪除、上下移動；手動排的順序存檔時保留，新加的照時間就位，沒填的不存", async () => {
    const page = await editMode();

    await page.user.click(within(card("晚班機")).getByRole("button", { name: "上移" }));
    expect(editing()).toEqual(["早餐", "晚班機", "午餐"]);
    // 最上面那張不能再上移，最下面那張不能再下移。
    expect(within(card("早餐")).getByRole<HTMLButtonElement>("button", { name: "上移" }).disabled).toBe(true);
    expect(within(card("午餐")).getByRole<HTMLButtonElement>("button", { name: "下移" }).disabled).toBe(true);

    await page.user.click(within(card("午餐")).getByRole("button", { name: "刪除這個事件" }));
    expect(editing()).toEqual(["早餐", "晚班機"]);

    await page.user.click(within(card("早餐")).getByRole("button", { name: "在下方插入事件" }));
    expect(editing()).toEqual(["早餐", "", "晚班機"]);
    const inserted = titleInputs()[1]!.closest<HTMLElement>(".panel")!;
    await page.fill(within(inserted).getByLabelText("標題"), "咖啡");
    await page.fill(within(inserted).getByLabelText("開始"), "20:00");

    // 加了卻什麼都沒填的，存檔時直接拿掉，不擋人。
    await page.user.click(screen.getByRole("button", { name: "新增事件" }));
    expect(editing()).toEqual(["早餐", "咖啡", "晚班機", ""]);

    await saved(page);
    // 晚班機是手動移的、時間沒變，留在原地；咖啡 20:00 排在晚班機 19:00 前面不對，就位到它後面。
    expect(order()).toEqual(["早餐", "晚班機", "咖啡"]);
    expect(stored()).toBe(TRIP(`${BREAKFAST("09:00")}${FLIGHT("19:00", "2099-03-01T21:00")}      - start: '2099-03-01T20:00'
        title: 咖啡
`));
});

test("事件的其他欄位：類型、當地名稱、條列、地點、連結都能加能改能刪", async () => {
    const page = await editMode();
    const lunch = () => card("午餐");

    // 沒填的欄位收在「新增欄位」後面，選一個就收回去。
    const add = async (name: string) => {
        await page.user.click(within(lunch()).getByRole("button", { name: "新增欄位" }));
        await page.user.click(within(lunch()).getByRole("button", { name }));
    };

    await page.user.selectOptions(within(lunch()).getByLabelText("類型"), "must-go");
    await add("當地名稱");
    await page.fill(within(lunch()).getByLabelText("當地名稱"), "Mercato Centrale");
    await add("條列");
    await page.fill(within(lunch()).getByLabelText("條列"), "記得帶現金");
    await add("連結");
    await page.fill(within(lunch()).getByLabelText("連結文字"), "官網");
    await page.fill(within(lunch()).getByLabelText("連結網址"), "https://example.com");
    // 加了又刪的地點、只加不填的條列，都不會留下空殼。
    await add("地點");
    await page.user.click(within(lunch()).getByRole("button", { name: "刪除這個地點" }));
    await add("條列");

    await saved(page);
    expect(stored()).toBe(TRIP(`${BREAKFAST("09:00")}      - time: '12:00'
        title: 午餐
        type: must-go
        bullets:
          - 記得帶現金
        localName: Mercato Centrale
        links:
          - label: 官網
            url: https://example.com
${FLIGHT("19:00", "2099-03-01T21:00")}`));
});

test("這一天的標題、節奏、天氣城市可以改，標題不能空白", async () => {
    const page = await editMode();

    await page.fill(screen.getByLabelText("今日節奏"), "慢慢走");
    await page.fill(screen.getByLabelText("天氣城市"), "Florence");
    await page.fill(screen.getByLabelText("這天的標題"), "");
    await finish(page);
    await waitFor(() => expect(status().textContent).toContain("這天的標題不能空白"));

    await page.fill(screen.getByLabelText("這天的標題"), "佛羅倫斯");
    await saved(page);
    expect(stored()).toBe(TRIP(BREAKFAST("09:00") + LUNCH + FLIGHT("19:00", "2099-03-01T21:00"), { day: "    pace: 慢慢走\n    city: Florence\n" }).replace("title: 第一天", "title: 佛羅倫斯"));
});

test("總覽：行程名稱、城市、語言、地圖與住宿都能改，住宿可以新增和刪除", async () => {
    const page = await launchApp(ORIGINAL);
    await screen.findByRole("heading", { level: 2, name: "編輯測試" });
    await startEditing(page);

    await page.fill(await screen.findByLabelText("行程名稱"), "佛羅倫斯小旅行");
    await page.fill(screen.getByLabelText("天氣城市"), "Florence");
    await page.user.selectOptions(screen.getByLabelText("當地語言"), "ja");
    await page.user.selectOptions(screen.getByLabelText("地圖"), "naver");

    await page.fill(within(card("測試飯店")).getByLabelText("退房時間"), "10:00");
    await page.user.click(screen.getByRole("button", { name: "新增住宿" }));
    await page.fill(within(card("")).getByLabelText("標題"), "第二間飯店");
    // 新的住宿從上一間的退房日接著住。
    expect(within(card("第二間飯店")).getByLabelText<HTMLInputElement>("入住日期").value).toBe("2099-03-02");
    await page.user.click(within(card("測試飯店")).getByRole("button", { name: "刪除這個住宿" }));

    await saved(page);
    expect(stored()).toBe(
        TRIP(BREAKFAST("09:00") + LUNCH + FLIGHT("19:00", "2099-03-01T21:00"), {
            trip: "  lang: ja\n  mapProvider: naver\n  city: Florence\n",
            hotels: "    - title: 第二間飯店\n      start: '2099-03-02'\n      end: '2099-03-03'\n",
        }).replace("name: 編輯測試", "name: 佛羅倫斯小旅行"),
    );
});

const SECOND_DAY = (moved = "") =>
    `  - date: '2099-03-02'
    title: 第二天
    timeline:
      - time: '10:00'
        title: 皮蒂宮
${moved}`;
const dayChip = (n: number) => document.querySelectorAll<HTMLElement>("button[data-day]")[n]!;

test("事件可以搬到別天：時刻不變、日期跟著換，到了那天照時間就位", async () => {
    const TWO_DAYS = TRIP(BREAKFAST("09:00") + LUNCH + FLIGHT("19:00", "2099-03-01T21:00"), { laterDays: SECOND_DAY() });
    const page = await editMode(TWO_DAYS);

    await page.user.selectOptions(within(card("晚班機")).getByLabelText("移到別天"), "2099-03-02");
    await waitFor(() => expect(status().textContent).toContain("已移到 03/02(一)"));
    await page.user.selectOptions(within(card("午餐")).getByLabelText("移到別天"), "2099-03-02");
    expect(editing()).toEqual(["早餐"]);

    await page.user.click(dayChip(1));
    await screen.findByLabelText("這天的標題");
    // 皮蒂宮 10:00 之後是午餐 12:00，晚班機 19:00 最後，不管搬過來的先後。
    expect(editing()).toEqual(["皮蒂宮", "午餐", "晚班機"]);

    await saved(page);
    expect(stored()).toBe(TRIP(BREAKFAST("09:00"), { laterDays: SECOND_DAY(LUNCH + FLIGHT("19:00", "2099-03-02T21:00").replace("2099-03-01T19:00", "2099-03-02T19:00")) }));
});

test("編輯中改了住宿日期，每一天的「回飯店休息」馬上跟著變，取消就回到原本", async () => {
    const page = await launchApp(ORIGINAL);
    await screen.findByRole("heading", { level: 2, name: "編輯測試" });
    await startEditing(page);

    await page.fill(within(card("測試飯店")).getByLabelText("退房日期"), "2099-03-03");
    await page.fill(within(card("測試飯店")).getByLabelText("入住日期"), "2099-03-02");
    await page.user.click(firstDayChip());
    await screen.findByLabelText("這天的標題");
    expect(screen.queryByText("回飯店休息")).toBeNull();

    page.answerDialogs(true);
    await page.user.click(screen.getByRole("button", { name: "取消" }));
    await waitFor(() => expect(titleInputs()).toHaveLength(0));
    expect(screen.getByText("回飯店休息")).toBeTruthy();
});

/** Picks a date the way the native picker hands one over: whole, in one change. */
const pickDate = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const dayChips = () => document.querySelectorAll("button[data-day]").length;

test("總覽的起訖日期：延長會補上自由活動的空白天，編輯中就能切過去改", async () => {
    const page = await launchApp(ORIGINAL);
    await screen.findByRole("heading", { level: 2, name: "編輯測試" });
    await startEditing(page);

    pickDate("結束日期", "2099-03-02");
    await waitFor(() => expect(dayChips()).toBe(2));
    await page.user.click(dayChip(1));
    expect(await screen.findByDisplayValue("自由活動")).toBeTruthy();

    await saved(page);
    expect(stored()).toBe(TRIP(BREAKFAST("09:00") + LUNCH + FLIGHT("19:00", "2099-03-01T21:00"), { laterDays: "  - date: '2099-03-02'\n    title: 自由活動\n    timeline: []\n" }));
});

test("總覽的起訖日期：縮短掉有事件的天要先確認，結束早於開始會擋下來", async () => {
    const page = await launchApp(TRIP(BREAKFAST("09:00") + LUNCH + FLIGHT("19:00", "2099-03-01T21:00"), { laterDays: SECOND_DAY() }));
    await screen.findByRole("heading", { level: 2, name: "編輯測試" });
    await startEditing(page);

    pickDate("結束日期", "2099-02-28");
    await waitFor(() => expect(status().textContent).toContain("結束日不能早於開始日"));
    expect(screen.getByLabelText<HTMLInputElement>("結束日期").value).toBe("2099-03-02");

    page.answerDialogs(false, true);
    pickDate("開始日期", "2099-03-02");
    expect(page.dialogs).toEqual(["會拿掉 03/01(日) 這 1 天，連同上面的 3 個事件。確定嗎？"]);
    expect(dayChips()).toBe(2);
    expect(screen.getByLabelText<HTMLInputElement>("開始日期").value).toBe("2099-03-01");

    pickDate("開始日期", "2099-03-02");
    await waitFor(() => expect(dayChips()).toBe(1));
    await saved(page);
    expect(stored()).toBe(canonical(`trip:
  name: 編輯測試
  id: t-edit
  hotels:
${HOTEL}days:
${SECOND_DAY()}`));
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

    await startEditing(page);
    expect(await screen.findByLabelText("行程名稱")).toBeTruthy();
    expect(screen.getByRole("button", { name: "完成" })).toBeTruthy();

    await page.user.click(firstDayChip());
    await waitFor(() => expect(editing()).toEqual(["早餐", "午餐", "晚班機"]));
});
