import {
    screen,
    waitFor,
    within,
} from "@testing-library/dom";
import {
    expect,
    onTestFinished,
    test,
    vi,
} from "vitest";
import {
    type AppPage,
    createPage,
} from "./harness";

// 住宿和事件是同一種卡：住宿要排進總覽的住宿清單，也要變成每晚的「回飯店休息」與退房日的
// 「退房」；只寫 start / end 的事件要自己組出時間。住宿刻意用舊欄位名 (name / checkIn /
// checkOut) 寫，手機上、備份裡、別人手上的舊檔才有人替它們開門。
//
// 時鐘停在第二天 23:00：「進行中」、今晚入住與今天卡片都只在旅程中出現，而紅眼班機 23:30
// 才起飛，快轉過去就看得到今天卡片從「接下來」換成「進行中」。只換掉 Date —— Testing
// Library 的等待靠真的計時器在輪詢 —— 所以快轉之後要像從別的 app 切回來一樣，讓 App 重讀時鐘。

const YAML = `trip:
  name: 住宿測試
  lang: ja
  hotels:
    - name: 舊欄位飯店
      checkIn: '2026-10-10T15:00'
      checkOut: '2026-10-12T11:00'
      address: 東京都新宿區西新宿 1-1-1
days:
  - date: '2026-10-10'
    title: 第一天
    timeline:
      - time: '12:00'
        title: 拉麵店
        localName: ラーメン屋
  - date: '2026-10-11'
    title: 第二天
    timeline:
      - title: 紅眼班機
        start: '2026-10-11T23:30'
        end: '2026-10-12T06:10'
  - date: '2026-10-12'
    title: 第三天
    timeline:
      - time: '14:00'
        title: 回家
`;

const dayChips = () => document.querySelectorAll<HTMLElement>("button[data-day]");

/** The card a title sits in, for reaching the buttons that belong to it. */
function cardOf(text: string): HTMLElement {
    const card = screen.getByText(text).closest<HTMLElement>(".panel");
    if (!card) throw new Error(`no card around ${text}`);
    return card;
}

async function launch(): Promise<AppPage> {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date(2026, 9, 11, 23, 0) });
    onTestFinished(() => void vi.useRealTimers());
    const page = createPage({ yaml: YAML });
    await page.goto("/");
    // A trip running today opens on today's panel.
    await screen.findByRole("heading", { name: "第二天" });
    return page;
}

test("住宿：舊欄位名照樣讀進來，排進住宿清單、今晚入住和每天的時間軸", async () => {
    const { user } = await launch();

    expect(within(cardOf("回飯店休息")).getByText("舊欄位飯店")).toBeTruthy();

    await user.click(dayChips()[2]!);
    await screen.findByRole("heading", { name: "第三天" });
    expect(within(cardOf("退房 11:00")).getByText("舊欄位飯店")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "總覽" }));
    await screen.findByText("今晚入住");
    // 住宿清單沒有所在的那一天，所以日期照寫；正住著的那間跟進行中的事件一樣標出來。
    const stay = cardOf("10/10 15:00 – 10/12 11:00");
    expect(within(stay).getByText("舊欄位飯店")).toBeTruthy();
    expect(within(stay).getByText("進行中")).toBeTruthy();
    screen.getByRole("button", { name: "放大顯示今晚飯店給司機看" });
});

test("只寫 start / end 的事件自己組時間；放大卡只有帶地址時才用司機那句話", async () => {
    const { user } = await launch();

    // 跨到隔天的結束時間像機票一樣標 +1。
    expect(within(cardOf("紅眼班機")).getByText("23:30 – 06:10 +1")).toBeTruthy();

    await user.click(within(cardOf("回飯店休息")).getByRole("button", { name: "放大顯示地址給司機看" }));
    const driverCard = await screen.findByRole("dialog");
    within(driverCard).getByText(/運転手さん、ここまでお願いします/);
    within(driverCard).getByText("東京都新宿區西新宿 1-1-1");
    await user.click(within(driverCard).getByRole("button", { name: "關閉" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    await user.click(dayChips()[0]!);
    await screen.findByRole("heading", { name: "第一天" });
    await user.click(within(cardOf("拉麵店")).getByRole("button", { name: "放大顯示當地名稱" }));
    within(await screen.findByRole("dialog")).getByText("出示給司機 / 店員看（點字可複製）");
    await user.click(screen.getByRole("button", { name: "關閉" }));
});

test("今天卡片跟著時鐘走：只寫 start 的紅眼班機 23:30 前是接下來，過了就是進行中", async () => {
    const page = await launch();

    await page.user.click(screen.getByRole("button", { name: "總覽" }));
    const todayCard = () => screen.getByRole("button", { name: /^今天\s*・DAY 02/ });
    await waitFor(() => expect(todayCard().textContent).toContain("接下來 23:30 紅眼班機"));

    vi.setSystemTime(new Date(2026, 9, 11, 23, 40));
    page.setVisibility("visible");
    await waitFor(() => expect(todayCard().textContent).toContain("進行中：紅眼班機"));
});
