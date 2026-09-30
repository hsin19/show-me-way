import { yamlFingerprint } from "$lib/domain/utils";
import type { TripSyncRecord } from "$lib/infra/http/gdrive";
import { FIXTURE_YAML } from "$lib/testing/fixture-trip";
import {
    screen,
    waitFor,
    within,
} from "@testing-library/dom";
import type { UserEvent } from "@testing-library/user-event";
import {
    expect,
    onTestFinished,
    test,
    vi,
} from "vitest";
import {
    type FakeFile,
    installFakeDrive,
    md5Of,
} from "./fake-drive";
import {
    type AppPage,
    createPage,
    firstDayChip,
    navTab,
    openTripManagement,
} from "./harness";

// Google Drive 同步。所有 googleapis.com 端點都由 ./fake-drive.ts 的有狀態假 Drive 接手，
// 所以 push → pull → conflict 是真的往返一輪，而不是每個呼叫各回一份罐頭。
//
// 除了「連線」與兩條「重新連線」，其他測試都預先把 token 快取塞進 localStorage，
// `getValidToken` 就直接命中快取、`loadGisScript` 全程不會被呼叫；那三條才需要把 GIS 的
// script 換成 stub。
//
// No page-error assertions: an error escaping a component fails the whole vitest run.

const CLOUD_FILE_ID = "file-cloud-1";
const PROFILE_ID = "p-app";
const EXPIRED_NOTICE = "Google 雲端登入已過期，無法檢查行程更新";

/** 把 FIXTURE_YAML 的行程名稱換掉，用來分辨畫面上是哪一份內容 */
function yamlNamed(name: string): string {
    return FIXTURE_YAML.replace("name: 測試行程", `name: ${name}`);
}

/** 這趟行程在雲端的那一份，跟本機一字不差。 */
const CLOUD_COPY: FakeFile = { id: CLOUD_FILE_ID, name: "測試行程.yaml", content: FIXTURE_YAML, tripId: "t-fixture" };
/** 上次同步時雙方一致（`localHash` 用真的指紋，才算「本機沒變」）。 */
const IN_SYNC: TripSyncRecord = { fileId: CLOUD_FILE_ID, remoteMd5: md5Of(FIXTURE_YAML), localHash: yamlFingerprint(FIXTURE_YAML) };
/** localHash 是舊的 → 本機也算動過，按鈕一開始就是「上傳」而不是「同步」。 */
const LOCALLY_EDITED: TripSyncRecord = { ...IN_SYNC, localHash: "stale-fingerprint" };

/**
 * 以「已連線」狀態開場，在 `createPage` 之後、`goto` 之前呼叫。塞的是 token 快取而不是假的
 * window.google，所以 GIS 完全不介入；有 `record` 時代表這個行程已經綁好雲端檔。
 */
function seedConnected(options: { expiredToken?: boolean; record?: TripSyncRecord; } = {}): void {
    const storage = window.localStorage;
    storage.setItem("showmeway_gdrive_user", JSON.stringify({ email: "tester@example.com", name: "測試者" }));
    storage.setItem("showmeway_gdrive_token", JSON.stringify({ token: "app-test-token", expiresAt: Date.now() + (options.expiredToken ? -3600_000 : 3600_000) }));
    if (options.record) storage.setItem("showmeway_gdrive_trips", JSON.stringify({ [PROFILE_ID]: options.record }));
    storage.setItem("showmeway_active_profile", PROFILE_ID);
}

const GIS_SCRIPT_SRC = "https://accounts.google.com/gsi/client";

/**
 * GIS 的 SDK 換成 stub：app 注入的 GIS script 由這裡代替網路載入（定義 window.google 再觸發
 * load），initTokenClient 直接回一個含 drive.file scope 的 token，這樣 loadGisScript 與
 * requestGoogleAccessToken（含 scope 檢查）都真的被執行到。裝上之前，happy-dom 對外部 script
 * 當場觸發 error，跟被 fixture 擋掉的請求一樣。只有使用者主動按下的流程才會走到它；背景刷新
 * 一律停在快取 token。`popups` 是 token 被要了幾次 —— 真的 GIS 每要一次就彈一次視窗。
 */
function installGisStub(): { popups: () => number; } {
    let popups = 0;
    const google = {
        accounts: {
            oauth2: {
                initTokenClient: (config: { callback: (resp: object) => void; }) => ({
                    requestAccessToken: () => {
                        popups++;
                        config.callback({
                            access_token: "gis-token",
                            expires_in: 3600,
                            scope: "https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/userinfo.email",
                        });
                    },
                }),
            },
        },
    };
    const head = document.head;
    const append = head.appendChild.bind(head);
    const served = vi.spyOn(head, "appendChild").mockImplementation(<T extends Node>(node: T): T => {
        if (!(node instanceof HTMLScriptElement) || node.src !== GIS_SCRIPT_SRC) return append(node);
        Object.defineProperty(window, "google", { configurable: true, value: google });
        setTimeout(() => node.dispatchEvent(new Event("load")));
        return node;
    });
    // 同一個檔案的測試共用一個 window：不收掉的話，下一條還沒按就已經有 GIS。
    onTestFinished(() => {
        served.mockRestore();
        Reflect.deleteProperty(window, "google");
    });
    return { popups: () => popups };
}

/** 開到 `/` 並等行程載入完：導覽列一開始就在，行程管理頁卻要等行程載入後才掛得上去。 */
async function gotoLoaded(page: AppPage): Promise<void> {
    await page.goto("/");
    await waitFor(firstDayChip);
}

/** 點下去並等它真的換成 `checked`：勾選框的狀態是 store 重畫出來的，不是點擊本身。 */
async function setChecked(user: UserEvent, box: HTMLInputElement, checked: boolean): Promise<void> {
    await user.click(box);
    await waitFor(() => expect(box.checked).toBe(checked));
}

/**
 * 讓錨點之後還排著的 microtask 跑完再做否定判斷：背景檢查的提示是在清單失敗之後、隔幾個
 * await 才決定的，錨點一出現就查會搶在它前面而白白通過。
 */
function settle(): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, 0));
}

const expander = () => screen.getByRole("button", { name: /目前行程/ });
const yamlEditor = () => screen.getByLabelText<HTMLTextAreaElement>("行程資料 (YAML)");

test("連線 Google：走完 GIS 流程並把行程建立成雲端檔", async () => {
    const page = createPage();
    const drive = installFakeDrive(page);
    const gis = installGisStub();
    await gotoLoaded(page);
    const { user } = page;

    await user.click(navTab("工具"));
    await user.click(screen.getByRole("button", { name: "App 設定" }));
    await screen.findByText("未連線");
    await user.click(screen.getByRole("button", { name: "登入 Google" }));

    await screen.findByText("已連線");
    screen.getByText("測試者 (tester@example.com)");

    await openTripManagement(user);
    await user.click(await screen.findByRole("button", { name: "上傳此行程至 Google Drive (建立新檔案)" }));
    await screen.findByText(/已建立雲端備份/);

    expect(drive.list()).toHaveLength(1);
    expect(drive.list()[0]?.content).toContain("name: 測試行程");
    // 只有連線那一下彈過視窗：上傳用的是連線時拿到、存起來的 token。
    expect(gis.popups()).toBe(1);

    // 綁定成立後，切換器把這趟標成「已同步雲端」
    await screen.findByRole("button", { name: /目前行程.*已同步雲端/ });
});

// 新安裝（或回復預設後）的 slot 只在畫面上放著範本，storage 裡什麼都沒有。上傳的必須是存下來、
// 帶著 trip.id 的那份，否則雲端檔認不出是哪一趟，按鈕也不該把面板關掉了事。
test("空的行程上傳：先存成這趟行程再傳，雲端檔帶著 trip.id", async () => {
    const page = createPage({ yaml: null });
    const drive = installFakeDrive(page);
    seedConnected();
    await gotoLoaded(page);
    const { user } = page;

    await openTripManagement(user);
    // 範本是非同步抓進編輯器的；還沒抓到之前，編輯器裡沒有東西可以存。
    await waitFor(() => expect(yamlEditor().value).toMatch(/trip:/));
    await user.click(await screen.findByRole("button", { name: "上傳此行程至 Google Drive (建立新檔案)" }));
    await screen.findByText(/已建立雲端備份/);

    expect(drive.list()).toHaveLength(1);
    const stored = window.localStorage.getItem("showmeway_user_yaml");
    expect(drive.list()[0]?.content).toBe(stored);
    expect(stored).toMatch(/^ {2}id: \S+$/m);
    await screen.findByRole("button", { name: /目前行程.*已同步雲端/ });
});

test("重新綁定：登出再登入後靠 trip.id 認回雲端檔案，不是當成沒備份過", async () => {
    // 登出會留下行程本身，但不留 sync record —— 修好之前這裡會顯示「建立新檔案」，
    // 按下去就多一份重複的雲端檔。
    const page = createPage();
    const drive = installFakeDrive(page, [CLOUD_COPY]);
    seedConnected();
    await gotoLoaded(page);

    await openTripManagement(page.user);

    // 內容一致 → 直接認回完整的比對基準，按鈕停在「同步」而不是「上傳」。
    await screen.findByRole("button", { name: "同步行程 (比對本地與雲端內容差異)" });
    expect(drive.counts().downloads).toBe(0);
    expect(drive.list()).toHaveLength(1);
});

test("按一下同步：雲端較新時先給下載按鈕，再按一次才真的換掉畫面上的行程", async () => {
    const cloudYaml = yamlNamed("雲端版行程");
    const page = createPage();
    const drive = installFakeDrive(page, [CLOUD_COPY]);
    // 上次同步時雙方一致；接著只有雲端動了。
    seedConnected({ record: IN_SYNC });
    await gotoLoaded(page);
    drive.write(CLOUD_FILE_ID, cloudYaml);
    const { user } = page;

    await openTripManagement(user);
    await user.click(screen.getByRole("button", { name: "同步行程 (比對本地與雲端內容差異)" }));

    // 第一下只是檢查：按鈕換成「下載」，還沒真的動到本機內容。
    await screen.findByText(/有新版本，可以下載更新/);
    expect(drive.counts().downloads).toBe(0);
    const downloadButton = screen.getByRole("button", { name: "下載雲端最新版本 (覆蓋本機)" });

    await user.click(downloadButton);

    await screen.findByText(/已載入雲端版本/);
    // 真的套用了：回到行程分頁看得到新名稱，而不只是 toast 說有。
    await user.click(navTab("行程"));
    await screen.findByRole("heading", { name: "雲端版行程" });
    // 覆蓋前先進了備份環，所以還原得回來。
    await openTripManagement(user);
    await screen.findByRole("button", { name: /測試行程.*還原/ });
});

// 在 Drive 網頁上手改、或別的工具推上去的檔，不是 app 會寫的樣子。app 只存自己的格式，所以下載下來
// 就讀成「本機有改動」，上傳一次雲端就回到 app 的格式 —— 這就是修復，不另外處理。
test("雲端檔被手改過：下載後認得出來，按上傳才把雲端修回 app 的格式", async () => {
    const page = createPage();
    const drive = installFakeDrive(page, [CLOUD_COPY]);
    seedConnected({ record: IN_SYNC });
    await page.goto("/");
    const { user } = page;
    // 開啟時的清單已經拿到了，之後才被手改：下載之後若還拿那份舊清單來比，就會誤判成衝突。
    await screen.findByRole("heading", { level: 2, name: "測試行程" });
    await waitFor(() => expect(drive.counts().listings).toBeGreaterThan(0));
    drive.write(CLOUD_FILE_ID, `# 在 Drive 網頁上手改\n${yamlNamed("手改過的行程")}`);

    await openTripManagement(user);
    await user.click(screen.getByRole("button", { name: "同步行程 (比對本地與雲端內容差異)" }));
    await user.click(await screen.findByRole("button", { name: "下載雲端最新版本 (覆蓋本機)" }));
    await screen.findByText(/已載入雲端版本/);

    // 認得出來：存成 app 的格式後跟下載的不一樣，按鈕變成上傳，回到前景時提示要上傳 —— 不是誤報成
    // 兩邊都改過 —— 而且沒按之前什麼都沒送出去。前景的檢查在提示出現之後才輪到雲端那一半，
    // 所以先讓它跑完，再確認衝突沒出現。
    await screen.findByRole("button", { name: "上傳本機異動到 Google Drive (覆蓋雲端版本)" });
    page.setVisibility("visible");
    await screen.findByText("行程有改動還沒上傳到 Google Drive");
    await settle();
    expect(screen.queryByText(/雲端與本機都有修改，請選擇要保留哪一份/)).toBeNull();
    expect(drive.counts().uploads).toBe(0);

    await user.click(await screen.findByRole("button", { name: "上傳" }));

    await waitFor(() => expect(drive.counts().uploads).toBe(1));
    expect(drive.read(CLOUD_FILE_ID)).toBe(yamlNamed("手改過的行程"));
    await screen.findByRole("button", { name: "同步行程 (比對本地與雲端內容差異)" });
});

test("按一下上傳：本機與雲端都改過時停下來問，且兩側都不動", async () => {
    const page = createPage();
    const drive = installFakeDrive(page, [CLOUD_COPY]);
    seedConnected({ record: LOCALLY_EDITED });
    await gotoLoaded(page);
    drive.write(CLOUD_FILE_ID, yamlNamed("雲端版行程"));
    const { user } = page;

    await openTripManagement(user);
    await user.click(await screen.findByRole("button", { name: "上傳本機異動到 Google Drive (覆蓋雲端版本)" }));

    await screen.findByRole("alertdialog", { name: /都改過/ });
    // 沒有上傳、雲端內容原封不動。
    expect(drive.counts().uploads).toBe(0);
    expect(drive.read(CLOUD_FILE_ID)).toContain("name: 雲端版行程");

    await user.click(screen.getByRole("button", { name: "採用雲端版本" }));
    await user.click(screen.getByRole("button", { name: "採用雲端" }));

    await user.click(navTab("行程"));
    await screen.findByRole("heading", { name: "雲端版行程" });
});

test("衝突時選擇保留本機：雲端內容被本機取代", async () => {
    const page = createPage();
    const drive = installFakeDrive(page, [CLOUD_COPY]);
    seedConnected({ record: LOCALLY_EDITED });
    await gotoLoaded(page);
    drive.write(CLOUD_FILE_ID, yamlNamed("雲端版行程"));
    const { user } = page;

    await openTripManagement(user);
    await user.click(await screen.findByRole("button", { name: "上傳本機異動到 Google Drive (覆蓋雲端版本)" }));
    await screen.findByRole("alertdialog", { name: /都改過/ });

    await user.click(screen.getByRole("button", { name: "保留本機版本" }));
    await user.click(screen.getByRole("button", { name: "覆蓋雲端" }));

    await screen.findByText(/已以本機版本覆蓋雲端/);
    expect(drive.read(CLOUD_FILE_ID)).toContain("name: 測試行程");
});

test("衝突時兩份都留：雲端版成為這趟行程，本機版另存成新行程", async () => {
    const page = createPage();
    const drive = installFakeDrive(page, [CLOUD_COPY]);
    seedConnected({ record: LOCALLY_EDITED });
    await gotoLoaded(page);
    drive.write(CLOUD_FILE_ID, yamlNamed("雲端版行程"));
    const { user } = page;

    await openTripManagement(user);
    await user.click(await screen.findByRole("button", { name: "上傳本機異動到 Google Drive (覆蓋雲端版本)" }));
    await screen.findByRole("alertdialog", { name: /都改過/ });

    await user.click(screen.getByRole("button", { name: /兩份都留/ }));
    await user.click(screen.getByRole("button", { name: "兩份都留" }));

    // 畫面上留的是本機那份，改了名字才分得出來。
    await screen.findByRole("heading", { level: 2, name: "測試行程（本機版）" });
    // 雲端那份沒有被覆蓋，而且成為停放中的另一趟行程。
    expect(drive.read(CLOUD_FILE_ID)).toContain("name: 雲端版行程");
    expect(drive.counts().uploads).toBe(0);

    await openTripManagement(user);
    await user.click(expander());
    await screen.findByRole("button", { name: /雲端版行程.*切換/ });

    // 兩趟行程的身分必須分開，否則會搶同一個雲端檔案。
    const idOf = (yaml: string | null) => yaml?.match(/^\s+id:\s*(\S+)/m)?.[1] ?? null;
    const parked = JSON.parse(window.localStorage.getItem("showmeway_profiles") ?? "[]") as { yaml: string; }[];
    const active = idOf(window.localStorage.getItem("showmeway_user_yaml"));
    // 綁定留在原本那個 slot，所以雲端版保住 t-fixture；本機版是新的一趟。
    expect(parked.map(p => idOf(p.yaml))).toEqual(["t-fixture"]);
    expect(active).toBeTruthy();
    expect(active).not.toBe("t-fixture");
});

test("雲端行程清單：載入為新行程，原行程仍可切回；刪除後該列消失", async () => {
    const page = createPage();
    installFakeDrive(page, [{ id: CLOUD_FILE_ID, name: "另一趟旅行", content: yamlNamed("另一趟旅行").replace("id: t-fixture", "id: t-other") }]);
    seedConnected();
    await gotoLoaded(page);
    const { user } = page;

    await openTripManagement(user);
    await user.click(expander());
    await user.click(await screen.findByRole("button", { name: /另一趟旅行.*載入/ }));
    await user.click(screen.getByRole("button", { name: "確定載入" }));

    await screen.findByText(/已從 Google Drive 載入/);
    await user.click(navTab("行程"));
    await screen.findByRole("heading", { name: "另一趟旅行" });

    // 原本的行程被停放成 profile，沒有被覆蓋。
    await openTripManagement(user);
    await user.click(expander());
    const parked = await screen.findByRole("button", { name: /測試行程.*切換/ });
    // 雲端檔綁在載入的這趟上，不是載入前畫面上那趟：匯入會換掉作用中的 slot，載入前記下的 id
    // 此時指的是被停放的原行程。
    screen.getByRole("button", { name: /目前行程.*另一趟旅行.*已同步雲端/ });
    expect(within(parked).queryByRole("img", { name: "已同步雲端" })).toBeNull();
});

// 分享連結是 metadata：上傳時走 appProperties，所以同一個 Google 帳號的另一台裝置能更新
// 同一條連結，而收件端解出來的 YAML 裡沒有金鑰也沒有 editToken。
const SHARE_KEY = "KKKKKKKKKKKKKKKKKKKKKK";
const SHARE_PROPERTY = `sh0rt1d.${SHARE_KEY}.edit-token`;

test("分享連結上傳：進 appProperties 而不是行程內容", async () => {
    const page = createPage();
    const drive = installFakeDrive(page);
    seedConnected();
    const [id, key, editToken] = SHARE_PROPERTY.split(".");
    window.localStorage.setItem(
        "showmeway_share_links",
        JSON.stringify({ [PROFILE_ID]: { id, key, editToken, createdAt: "2026-09-04T00:00:00.000Z", updatedAt: "2026-09-04T00:00:00.000Z", expiresAt: null } }),
    );
    await gotoLoaded(page);
    const { user } = page;

    await openTripManagement(user);
    await user.click(await screen.findByRole("button", { name: "上傳此行程至 Google Drive (建立新檔案)" }));
    await screen.findByText(/已建立雲端備份/);

    const fileId = drive.list()[0]!.id;
    expect(drive.props(fileId).shareLink).toBe(SHARE_PROPERTY);
    // 檔案內容才是收件端拿得到的東西：金鑰與 editToken 都不能在裡面。
    expect(drive.read(fileId)).not.toContain(SHARE_KEY);
    expect(drive.read(fileId)).not.toContain("edit-token");
});

test("分享連結下載：另一台裝置從雲端認回同一條連結", async () => {
    const page = createPage();
    installFakeDrive(page, [{ ...CLOUD_COPY, name: "測試行程", props: { shareLink: SHARE_PROPERTY, shareLinkAt: "" } }]);
    // 綁好雲端檔、但本機沒有任何分享連結紀錄 —— 這台裝置沒按過分享。
    seedConnected({ record: IN_SYNC });
    await gotoLoaded(page);
    const { user } = page;

    await openTripManagement(user);
    // 展開切換器會刷新雲端清單，連結就是在那裡被認回來的。
    await user.click(expander());

    await screen.findByRole("button", { name: /目前行程.*已分享連結/ });
    await screen.findByRole("button", { name: "複製分享連結" });
    expect(window.localStorage.getItem("showmeway_share_links") ?? "").toContain("edit-token");
});

test("刪除雲端行程：確認後該列從清單消失", async () => {
    const page = createPage();
    const drive = installFakeDrive(page, [{ id: CLOUD_FILE_ID, name: "待刪行程", content: yamlNamed("待刪行程") }]);
    seedConnected();
    await gotoLoaded(page);
    const { user } = page;

    await openTripManagement(user);
    await user.click(expander());
    const row = () => screen.queryByRole("button", { name: /待刪行程.*載入/ });
    await screen.findByRole("button", { name: /待刪行程.*載入/ });

    await user.click(screen.getByRole("button", { name: "刪除雲端檔案 待刪行程" }));
    await user.click(screen.getByRole("button", { name: "確定刪除" }));

    await screen.findByText("已從 Google Drive 刪除行程");
    await waitFor(() => expect(row()).toBeNull());
    expect(drive.list()).toHaveLength(0);
});

// 同步記錄比的是 bytes：勾了又取消，行程內容其實沒變，就不該變成「本機有改動」。
test("勾選待辦又取消：內容回到原樣，雲端按鈕維持同步而不是上傳", async () => {
    const page = createPage();
    installFakeDrive(page, [CLOUD_COPY]);
    seedConnected({ record: IN_SYNC });
    await gotoLoaded(page);
    const { user } = page;

    await user.click(navTab("工具"));
    const todo = await screen.findByRole<HTMLInputElement>("checkbox", { name: /測試待辦項目/ });
    await setChecked(user, todo, true);
    // 勾選真的存進去了，後面的「回到原樣」才不是什麼都沒寫而白白通過。
    expect(window.localStorage.getItem("showmeway_user_yaml")).toContain("checked: true");
    await setChecked(user, todo, false);

    expect(window.localStorage.getItem("showmeway_user_yaml")).toBe(FIXTURE_YAML);
    await openTripManagement(user);
    await screen.findByRole("button", { name: "同步行程 (比對本地與雲端內容差異)" });
});

// trip.svelte.ts 的 PUBLISH_PROMPT_QUIET_MS。安靜期用假時鐘快轉：只假造 setTimeout /
// clearTimeout，而且 shouldAdvanceTime 讓假時鐘跟著真的時間走，user-event 與 Testing Library
// 自己的排程照常運作，只有這段 12 秒可以一口氣跳過去。
const PUBLISH_PROMPT_QUIET_MS = 12_000;
const PROMPT = "行程有改動還沒上傳到 Google Drive";

test("儲存完提示：連續操作只問一次，而且要按下去才上傳", async () => {
    const page = createPage();
    const drive = installFakeDrive(page, [CLOUD_COPY]);
    // 綁好雲端檔且兩邊一致，所以接下來的改動就是「還沒上傳的異動」。
    seedConnected({ record: IN_SYNC });
    await gotoLoaded(page);
    const { user } = page;

    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"], shouldAdvanceTime: true });
    onTestFinished(() => void vi.useRealTimers());

    // 三次 persist：勾一個待辦、取消、再勾回來。每一次都重新起算安靜期，所以隔著
    // 快滿的安靜期再動一次，提示也不該出現。
    await user.click(navTab("工具"));
    const todo = await screen.findByRole<HTMLInputElement>("checkbox", { name: /測試待辦項目/ });
    await setChecked(user, todo, true);
    await setChecked(user, todo, false);
    await vi.advanceTimersByTimeAsync(PUBLISH_PROMPT_QUIET_MS - 1_000);
    await setChecked(user, todo, true);
    await vi.advanceTimersByTimeAsync(PUBLISH_PROMPT_QUIET_MS - 1_000);
    expect(screen.queryByText(PROMPT)).toBeNull();

    // 安靜下來才問，整串操作只問一次，而且問之前什麼都沒送出去。
    await vi.advanceTimersByTimeAsync(1_000);
    await screen.findByText(PROMPT);
    expect(screen.getAllByText(PROMPT)).toHaveLength(1);
    expect(drive.counts().uploads).toBe(0);

    await user.click(await screen.findByRole("button", { name: "上傳" }));

    await waitFor(() => expect(drive.counts().uploads).toBe(1));
    expect(drive.read(CLOUD_FILE_ID)).toContain("checked: true");
});

test("背景檢查：一開啟就發現雲端有新版，按下載才換掉行程", async () => {
    // 雲端檔在上次同步之後被另一台裝置改過。
    const page = createPage();
    const drive = installFakeDrive(page, [{ ...CLOUD_COPY, content: yamlNamed("雲端版行程") }]);
    seedConnected({ record: IN_SYNC });
    await page.goto("/");

    // 清單本來就帶著兩邊的 checksum，所以這個提示沒有多打一次 Drive，也沒有先下載。趁提示
    // 預先下載的話，下載會晚提示幾個 await 才送出，所以先讓它跑完再數。
    await screen.findByText("雲端有這趟行程的新版本");
    await settle();
    expect(drive.counts().downloads).toBe(0);

    await page.user.click(await screen.findByRole("button", { name: "下載" }));

    await screen.findByRole("heading", { name: "雲端版行程" });
});

test("背景檢查：token 過期時提示重新連線，連上後才說雲端有新版", async () => {
    const page = createPage();
    installFakeDrive(page, [{ ...CLOUD_COPY, content: yamlNamed("雲端版行程") }]);
    seedConnected({ expiredToken: true, record: IN_SYNC });
    // GIS 從一開始就在、一問就給：背景清單拿不到東西只能是因為它沒去問，不是問不到。
    installGisStub();
    await page.goto("/");

    // 過期的 token 讓背景清單拿不到東西，所以此時還不可能知道雲端有新版。
    await screen.findByText(EXPIRED_NOTICE);
    expect(screen.queryByText("雲端有這趟行程的新版本")).toBeNull();

    await page.user.click(await screen.findByRole("button", { name: "重新連線" }));

    await screen.findByText("雲端有這趟行程的新版本");
});

test("背景檢查：關掉過期提示後回到前景不再問，重新開啟才又問", async () => {
    const page = createPage();
    installFakeDrive(page, [CLOUD_COPY]);
    seedConnected({ expiredToken: true, record: IN_SYNC });
    await page.goto("/");

    const notice = () => screen.queryByText(EXPIRED_NOTICE);
    await screen.findByText(EXPIRED_NOTICE);
    await page.user.click(await screen.findByRole("button", { name: "關閉通知" }));
    await waitFor(() => expect(notice()).toBeNull());

    // 從別的 app 切回來：背景檢查照跑，但提示還在冷卻中。等這一輪清單失敗的 warn —— 提示在它
    // 之後才決定，waitForConsole 也要等 warn 之後的那一輪跑完才回來 —— 然後只當下判斷一次：
    // 會重試的斷言可能等到一則又跳出來的提示自己到期才通過。
    const recheck = page.waitForConsole("Refresh cloud files failed");
    page.setVisibility("visible");
    await recheck;
    expect(notice()).toBeNull();

    // 冷卻只存在記憶體：重新開啟就當沒這回事。
    await page.reload();
    await screen.findByText(EXPIRED_NOTICE);
});

test("背景檢查：token 過期但行程沒綁雲端時不提示", async () => {
    const page = createPage();
    installFakeDrive(page);
    seedConnected({ expiredToken: true });
    await gotoLoaded(page);

    // 抽屜出現重新連線列，代表背景清單已經因過期失敗過 —— 提示若要出現早該出現了。
    await page.user.click(screen.getByRole("button", { name: "切換行程選單" }));
    await screen.findByRole("button", { name: "雲端連線中斷，點此重新連線" });
    await settle();
    expect(screen.queryByText(EXPIRED_NOTICE)).toBeNull();
});

// 主畫面的「切換行程」抽屜：本機行程下方恆為單一雲端列 —— 清單、重新連線、或登入。
// 之所以要在這裡驗，是因為它是唯一允許把取 token 升級到 cache-only 之上的入口。

test("切換行程抽屜：未登入時給的是登入入口", async () => {
    const page = createPage();
    installFakeDrive(page);
    await gotoLoaded(page);

    await page.user.click(screen.getByRole("button", { name: "切換行程選單" }));

    await screen.findByRole("button", { name: "登入 Google 取得雲端行程" });
});

test("切換行程抽屜：token 過期時顯示重新連線，連上後雲端行程才出現", async () => {
    const page = createPage();
    installFakeDrive(page, [{ id: CLOUD_FILE_ID, name: "另一趟旅行", content: yamlNamed("另一趟旅行") }]);
    seedConnected({ expiredToken: true });
    // GIS 從一開始就在、一問就給：停在重新連線列只能是因為背景沒去問，不是問不到。
    const gis = installGisStub();
    await gotoLoaded(page);
    const { user } = page;

    // 背景刷新只用快取 token，過期就停在這一列 —— 不碰 GIS，也就不可能彈視窗。
    await user.click(screen.getByRole("button", { name: "切換行程選單" }));
    const reconnect = await screen.findByRole("button", { name: "雲端連線中斷，點此重新連線" });
    expect(screen.queryByRole("button", { name: /另一趟旅行/ })).toBeNull();
    expect(gis.popups()).toBe(0);

    // 使用者主動按下去才走 GIS。
    await user.click(reconnect);

    await screen.findByRole("button", { name: /另一趟旅行.*載入/ });
    expect(gis.popups()).toBe(1);
});

test("切換行程抽屜：一個月前的雲端行程摺起來，載入後再開又摺回去", async () => {
    const page = createPage();
    installFakeDrive(page, [
        { id: "file-soon", name: "即將出發", content: yamlNamed("即將出發"), startDate: "2099-01-01" },
        { id: "file-old", name: "去年那趟", content: yamlNamed("去年那趟"), startDate: "2020-01-01" },
    ]);
    seedConnected();
    await gotoLoaded(page);
    const { user } = page;
    const drawerToggle = () => screen.getByRole("button", { name: "切換行程選單" });
    const earlierRow = () => screen.queryByRole("button", { name: /去年那趟.*載入/ });

    await user.click(drawerToggle());
    await screen.findByRole("button", { name: /即將出發.*載入/ });
    expect(earlierRow()).toBeNull();

    await user.click(screen.getByRole("button", { name: "載入更早的 1 筆行程" }));
    await screen.findByRole("button", { name: /去年那趟.*載入/ });
    expect(screen.queryByRole("button", { name: "載入更早的 1 筆行程" })).toBeNull();
    // 是接在後面，不是換掉：近期的那筆還在。
    screen.getByRole("button", { name: /即將出發.*載入/ });

    // 單向展開：關掉再開就自己摺回去，不必使用者收。
    await user.click(drawerToggle());
    await user.click(drawerToggle());
    await screen.findByRole("button", { name: "載入更早的 1 筆行程" });
    expect(earlierRow()).toBeNull();
});
