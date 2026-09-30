import { hopBaseUrl } from "$lib/config";
import { encodeShareToken } from "$lib/domain/share";
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
    type AppPage,
    createPage,
    openTripManagement,
    status,
} from "./harness";

// Share-link flows (src/lib/domain/share.ts + maybeImportSharedItinerary in src/lib/stores/trip.svelte.ts):
// a `#s=<token>` hash carries a whole compressed itinerary. An unrecognised trip is
// imported non-destructively — the current trip is parked as a profile, never
// overwritten — while a link carrying a trip this device already holds (same trip.id)
// offers to replace that copy first, and a copy only behind that. The hash is always
// stripped afterwards so a refresh never re-prompts.
// Tokens are built with the app's own encodeShareToken (share.ts is pure;
// CompressionStream/btoa exist in Node 18+). Everything here runs on Node's codecs;
// e2e/tests/share.spec.ts keeps one short-link round trip on the real engines.

// Derived from FIXTURE_YAML with distinct names/dates, so assertions can tell
// the imported trip from the seeded one. The id has to differ too: this stands for
// someone else's trip, and sharing the seed's id would land on the replace-mine flow
// these tests are not about.
const SHARED_YAML = FIXTURE_YAML
    .replace("id: t-fixture", "id: t-shared")
    .replace("name: 測試行程", "name: 分享行程")
    .replaceAll("2099-01-01", "2099-02-01")
    .replaceAll("2099-01-02", "2099-02-02")
    .replace("測試區域一", "分享區域一")
    .replace("測試區域二", "分享區域二")
    .replace("測試事件一", "分享事件一")
    .replace("測試事件二", "分享事件二")
    .replace("第一天的測試事件", "分享行程的第一天事件")
    .replace("第二天的測試事件", "分享行程的第二天事件")
    .replace("測試待辦項目", "分享待辦項目");

const expander = () => screen.getByRole("button", { name: /目前行程/ });

/** `button`'s accessible name as a role query computes it. */
function buttonName(button: HTMLElement): string {
    let name = "";
    screen.getAllByRole("button", {
        name: (computed, element) => {
            if (element === button) name = computed;
            return element === button;
        },
    });
    return name;
}

test("分享連結匯入：接受後成為新行程，原行程保留可切回", async () => {
    const page = createPage();
    const token = await encodeShareToken(SHARED_YAML);

    // confirm() 在開機期間觸發，所以答案要在 goto 之前給。
    page.answerDialogs(true);
    await page.goto(`/#s=${token}`);

    await waitFor(() => expect(status().textContent).toContain("已匯入"));
    expect(page.dialogs).toEqual(["偵測到分享的行程，要匯入為新行程嗎？（目前行程會保留，可隨時切回）"]);
    await screen.findByRole("heading", { level: 2, name: "分享行程" });
    // clearShareHash：匯入後網址不再帶 token，重新整理不會再跳提示
    expect(page.url()).not.toContain("#s=");

    // 原行程被停放為設定檔（非破壞性匯入）：切換器（行程管理頁）裡看得到、可切回
    await openTripManagement(page.user);
    await page.user.click(expander());
    const parked = await screen.findByRole("button", { name: /測試行程.*切換/ });

    // 來源徽章：匯入的那趟標成「來自分享」，本機原有的那趟不標，圖示說明同時出現
    expect(buttonName(expander())).toMatch(/來自分享/);
    expect(buttonName(parked)).not.toMatch(/來自分享/);
    screen.getByText("來自分享");
});

test("分享連結匯入：無原行程時直接匯入無彈窗", async () => {
    const page = createPage({ yaml: null });
    const token = await encodeShareToken(SHARED_YAML);

    await page.goto(`/#s=${token}`);

    await waitFor(() => expect(status().textContent).toContain("已匯入"));
    expect(page.dialogs).toHaveLength(0);
    await screen.findByRole("heading", { level: 2, name: "分享行程" });
});

test("分享連結匯入：取消後維持原行程，網址 token 仍被清除", async () => {
    const page = createPage();
    const token = await encodeShareToken(SHARED_YAML);

    page.answerDialogs(false);
    await page.goto(`/#s=${token}`);

    await screen.findByRole("heading", { level: 2, name: "測試行程" });
    expect(page.dialogs).toHaveLength(1);
    // 取消就是什麼都沒做，也就不該有提示說做了什麼。匯入的提示在載入行程之前就發出，標題出現時還沒有就不會有。
    expect(status().textContent).toBe("");
    expect(page.url()).not.toContain("#s=");
});

test("無效的分享 token：提示內容無效並照常載入原行程", async () => {
    const page = createPage();

    // token 須通過 parseShareLink 的 base64url 字元檢查（否則被靜默忽略、
    // 不會有 toast），但解壓失敗 → 走「內容無效」錯誤路徑。
    await page.goto("/#s=not-a-valid-token");

    await waitFor(() => expect(status().textContent).toContain("分享連結內容無效"));
    await screen.findByRole("heading", { level: 2, name: "測試行程" });
    expect(page.url()).not.toContain("#s=");
});

/** 每個本機行程的 trip.id：active 一個，加上停放中的每一個。 */
function localTripIds(): { active: string | null; parked: (string | null)[]; } {
    const idOf = (yaml: string | null) => yaml?.match(/^\s+id:\s*(\S+)/m)?.[1] ?? null;
    const parked = JSON.parse(window.localStorage.getItem("showmeway_profiles") ?? "[]") as { yaml: string; }[];
    return { active: idOf(window.localStorage.getItem("showmeway_user_yaml")), parked: parked.map(p => idOf(p.yaml)) };
}

function backupCount(): number {
    return (JSON.parse(window.localStorage.getItem("showmeway_yaml_backups") ?? "[]") as unknown[]).length;
}

/**
 * 讓本機那份和連結裡的內容不一樣，否則收件端會認出「已經是同一版」而直接略過，覆蓋／副本的分支就跑不到。
 * 改的是總覽上看得到的第一天標題，畫面才分得出載入的是哪一份。
 */
function ageLocalCopy(): void {
    const yaml = window.localStorage.getItem("showmeway_user_yaml")!;
    window.localStorage.setItem("showmeway_user_yaml", yaml.replace("title: 測試區域一", "title: 舊版區域一"));
}

/**
 * 總覽上的是連結裡那一版，不是 ageLocalCopy 改過的本機那份。兩版同名同 id，所以寫進儲存卻沒
 * 重新載入、或寫進去的其實是舊的那份，都只有這裡看得出來。
 */
async function expectLinkVersionOnScreen(): Promise<void> {
    await screen.findByText("測試區域一");
    expect(screen.queryByText("舊版區域一")).toBeNull();
}

// 第一問就得是覆蓋：以為自己在另存副本而按下確定的人，原本那份就被蓋掉了。
const REPLACE_QUESTION = "「測試行程」你已經有這趟行程了。要用連結裡的版本覆蓋原本那份嗎？（可以復原）";
const COPY_QUESTION = "那要另外匯入成一份副本嗎？原本那份會保留。";

/**
 * 分享自己的行程，回傳連結。收件端刻意用同一個 page 再 goto 一次，所以共用 localStorage ——
 * 那正是「連結帶進來的行程本機已經有」的情境，也就是同一個瀏覽器裡的第二個分頁。
 */
async function shareOwnTrip(page: AppPage): Promise<string> {
    await page.goto("/");
    await screen.findByRole("heading", { level: 2, name: "測試行程" });

    // 分享行程按鈕在總覽 hero 卡（與每日的分享今日行程對稱）。
    // harness 拿掉了 navigator.share，所以走剪貼簿 fallback 並跳 toast。
    await page.user.click(screen.getByRole("button", { name: "分享行程" }));
    await waitFor(() => expect(status().textContent).toContain("分享連結已複製"));

    const sharedUrl = page.copiedText();
    expect(sharedUrl).toContain("#s=");
    return sharedUrl;
}

test("分享行程按鈕：連結帶回同一趟行程時，第一個選項是覆蓋原本那份", async () => {
    const page = createPage();
    const sharedUrl = await shareOwnTrip(page);
    ageLocalCopy();
    const before = localTripIds();

    page.answerDialogs(true);
    await page.goto(sharedUrl);

    await waitFor(() => expect(status().textContent).toContain("已用分享連結更新行程"));
    expect(page.dialogs).toEqual([REPLACE_QUESTION]);
    await screen.findByRole("heading", { level: 2, name: "測試行程" });
    await expectLinkVersionOnScreen();

    // 同一趟就是同一趟：沒有多出第二份，身分也沒換 —— 換掉的話雲端那個檔案就認不得它了。
    const after = localTripIds();
    expect(after.parked).toHaveLength(0);
    expect(after.active).toBe(before.active);
    // 覆蓋前先進了備份環，所以行程管理還原得回來。
    expect(backupCount()).toBeGreaterThan(0);
});

test("分享行程按鈕：拒絕覆蓋後可以改成另存副本，副本會拿到自己的 trip.id", async () => {
    const page = createPage();
    const sharedUrl = await shareOwnTrip(page);
    ageLocalCopy();
    const before = localTripIds();

    // 第一問（覆蓋）取消、第二問（副本）確定。
    page.answerDialogs(false, true);
    await page.goto(sharedUrl);

    await waitFor(() => expect(status().textContent).toContain("已匯入"));
    expect(page.dialogs).toEqual([REPLACE_QUESTION, COPY_QUESTION]);

    // 兩份共用同一個 trip.id 會讓它們搶同一個雲端檔案，所以副本一定要換身分。
    const after = localTripIds();
    expect(after.parked).toEqual([before.active]);
    expect(after.active).toBeTruthy();
    expect(after.active).not.toBe(before.active);
});

test("分享行程按鈕：兩問都拒絕時什麼都不動，網址 token 仍被清除", async () => {
    const page = createPage();
    const sharedUrl = await shareOwnTrip(page);
    ageLocalCopy();
    const before = localTripIds();
    const yamlBefore = window.localStorage.getItem("showmeway_user_yaml");
    const backupsBefore = backupCount();

    page.answerDialogs(false, false);
    await page.goto(sharedUrl);

    await screen.findByRole("heading", { level: 2, name: "測試行程" });
    await screen.findByText("舊版區域一");
    expect(page.dialogs).toEqual([REPLACE_QUESTION, COPY_QUESTION]);
    expect(localTripIds()).toEqual(before);
    // 覆蓋會保留 trip.id，所以 id 沒變不代表沒被寫過：本機那份一個字都不能動，備份環也不會多一份。
    expect(window.localStorage.getItem("showmeway_user_yaml")).toBe(yamlBefore);
    expect(backupCount()).toBe(backupsBefore);
    expect(status().textContent).toBe("");
    expect(page.url()).not.toContain("#s=");
});

// 持久性連結會被重開來「看看有沒有更新」，沒更新才是常態；這時跳覆蓋確認只會教人按取消。
test("分享行程按鈕：連結裡的版本和本機一樣時不問也不寫，直接提示已是最新", async () => {
    const page = createPage();
    const sharedUrl = await shareOwnTrip(page);
    const before = localTripIds();
    const backupsBefore = backupCount();

    page.answerDialogs(true, true);
    await page.goto(sharedUrl);

    await waitFor(() => expect(status().textContent).toContain("已經是連結裡的版本"));
    expect(page.dialogs).toHaveLength(0);
    expect(localTripIds()).toEqual(before);
    expect(backupCount()).toBe(backupsBefore);
    expect(page.url()).not.toContain("#s=");
});

// 上面每一個測試走的都是 inline fallback：harness 擋掉所有非本機來源的請求，
// 所以 hop 連不上、buildBestShareUrl 退回 #s=。以下的短連結（#h=<id>.<key>）測試
// 改成在 test 內用 page.route 掛上 hop 的假伺服器（後掛的 route 優先於 harness 的擋法）。

/** `sent` 是 hop 收到的每一個請求：方法、網址、header、內容各一行。 */
type HopStore = { uploaded: string; puts: { auth: string | null; url: string; }[]; sent: string[]; };

// 真正的 hop 由 hono/cors 放行的方法與 header，加上瀏覽器本來就不 preflight 的那幾個。
// 超出這些的請求到不了 hop：瀏覽器在 preflight 就讓 fetch 失敗。攔在 fetch 這一層沒有
// 瀏覽器替我們擋，所以假 hop 自己照做 —— app 多帶一個 hop 不認的 header，在這裡就會壞。
const HOP_CORS_METHODS = ["GET", "HEAD", "POST", "PUT", "DELETE"];
const HOP_CORS_HEADERS = ["authorization", "content-type", "accept", "accept-language", "content-language"];

const BLOB_ID = "abcd1234";

/**
 * POST 把 body 存起來、GET 再吐回去 —— 這樣就得到一次真的往返，跑的是 app 自己那份
 * 加解密，完全不需要伺服器。PUT 同樣覆寫存起來的 body，並記下帶來的 bearer。
 * 後掛的 route 蓋過先掛的，所以收件端換一組 opts 重掛一次就等於另一個分頁自己的 route。
 */
function mockHop(page: AppPage, store: HopStore, opts: { getFails?: boolean; corrupt?: boolean; } = {}): void {
    page.route(`${hopBaseUrl()}/`, async request => {
        // happy-dom 的 Headers 保留 app 寫的大小寫，規格上應該是小寫。
        const unlisted = [...request.headers.keys()].filter(name => !HOP_CORS_HEADERS.includes(name.toLowerCase()));
        if (!HOP_CORS_METHODS.includes(request.method) || unlisted.length > 0) throw new TypeError(`blocked by hop's CORS: ${request.method} ${unlisted.join(", ")}`);
        const body = await request.text();
        store.sent.push([request.method, request.url, ...[...request.headers].map(([name, value]) => `${name}: ${value}`), body].join("\n"));
        const { pathname } = new URL(request.url);
        if (request.method === "POST" && pathname === "/api/v1/blobs") {
            store.uploaded = body;
            return Response.json({ id: BLOB_ID, editToken: "edit-token", expiresAt: Date.now() + 365 * 86400_000 });
        }
        // 真的 hop 只在它發出去的 id 底下有東西。不看路徑的假 hop，會讓把整段 `<id>.<key>`
        // 當成 id 送出去的 app 照樣拿到密文 —— 那時金鑰已經到了 hop 手上。
        if (pathname !== `/api/v1/blobs/${BLOB_ID}`) return new Response("not found", { status: 404 });
        if (request.method === "PUT") {
            store.uploaded = body;
            store.puts.push({ auth: request.headers.get("authorization"), url: request.url });
            return Response.json({ id: BLOB_ID, expiresAt: Date.now() + 365 * 86400_000 });
        }
        if (opts.getFails) throw new TypeError("hop unreachable");
        if (opts.corrupt) return Response.json({ payload: "AAAAAAAAAAAAAAAAAAAA" });
        return Response.json({ id: BLOB_ID, kind: "blob", payload: store.uploaded });
    });
}

/** 連結 `#h=<id>.<key>` 的金鑰那一半。 */
const keyOf = (url: string) => url.split(".").pop()!;

async function shareOwnTripShort(page: AppPage, store: HopStore): Promise<string> {
    mockHop(page, store);
    await page.goto("/");
    await screen.findByRole("heading", { level: 2, name: "測試行程" });

    await page.user.click(screen.getByRole("button", { name: "分享行程" }));
    await waitFor(() => expect(status().textContent).toContain("已加密上傳"));

    const sharedUrl = page.copiedText();
    expect(sharedUrl).toContain("#h=");
    return sharedUrl;
}

/** 在行程管理的編輯器裡把行程改名並儲存，儲存後會回到行程分頁。 */
async function renameTripInEditor(page: AppPage, name: string): Promise<void> {
    const editor = document.querySelector<HTMLTextAreaElement>("#yaml-editor")!;
    const next = editor.value.replace("name: 測試行程", `name: ${name}`);
    await page.fill(editor, next);
    await page.user.click(screen.getByRole("button", { name: "儲存並解析" }));
    await screen.findByRole("heading", { level: 2, name });
}

test("短連結分享：上傳的是密文，連結短到可以做成 QR code", async () => {
    const page = createPage();
    const hop: HopStore = { uploaded: "", puts: [], sent: [] };
    const sharedUrl = await shareOwnTripShort(page, hop);

    // 這一行就是整個功能的核心不變條件：離開裝置的是密文，不是行程內容。
    expect(hop.uploaded.length).toBeGreaterThan(0);
    expect(hop.uploaded).not.toContain("測試行程");
    expect(hop.uploaded).not.toContain("測試事件一");
    // 金鑰只能在網址片段裡：hop 收到的網址、header 或內容裡有它，hop 自己就解得開。
    expect(hop.sent.join("\n")).not.toContain(keyOf(sharedUrl));

    // 原本的 inline 連結是好幾千字元，做不成 QR code。正式站是
    // https://trip.hsin19.com/#h=<8 碼>.<22 碼> ≈ 58 字元。
    expect(sharedUrl.length).toBeLessThan(100);
});

// 持久性分享的核心：第二次分享不是再造一條連結，而是拿 editToken 覆寫同一個 id 的密文，
// 所以印出去的 QR code 不會過時。金鑰只在網址片段裡，PUT 的網址與 header 都不能帶到。
test("再次分享同一趟行程：更新同一條連結而不是換一條，收件端拿到新版本", async () => {
    const page = createPage();
    const hop: HopStore = { uploaded: "", puts: [], sent: [] };
    const firstUrl = await shareOwnTripShort(page, hop);
    const firstUpload = hop.uploaded;

    // 改個名字再分享一次。
    await openTripManagement(page.user);
    // 行程管理頁看得到這條連結，並提供更新；切換器也標出這趟已經有分享連結。
    screen.getByText(/最後更新/);
    expect(buttonName(expander())).toMatch(/已分享連結/);
    await renameTripInEditor(page, "測試行程二版");

    await page.user.click(screen.getByRole("button", { name: "分享行程" }));
    await waitFor(() => expect(status().textContent).toContain("分享連結已更新"));

    const secondUrl = page.copiedText();
    expect(secondUrl).toBe(firstUrl);
    expect(hop.puts).toHaveLength(1);
    expect(hop.puts[0]!.auth).toBe("Bearer edit-token");
    expect(hop.uploaded).not.toBe(firstUpload);
    const key = keyOf(firstUrl);
    expect(hop.puts[0]!.url).not.toContain(key);
    expect(hop.uploaded).not.toContain("測試行程二版");

    // 同一條連結在另一個裝置打開，看到的是新版本。
    mockHop(page, hop);
    page.answerDialogs(true);
    await page.goto(secondUrl);
    // 這個 localStorage 裡本來就是二版，連結解不開標題也照樣是二版；這則提示才表示
    // 原本那把金鑰解出來的正是新版本。
    await waitFor(() => expect(status().textContent).toContain("已經是連結裡的版本"));
    await screen.findByRole("heading", { level: 2, name: "測試行程二版" });
    // 建立、更新、收件端的讀取，三趟裡沒有一趟帶著金鑰。
    expect(hop.sent.join("\n")).not.toContain(key);
});

/**
 * 換成一台還沒有這趟行程的裝置：清掉這個 origin 的資料。安裝提示的拒絕記錄要補回去 ——
 * createPage 只在開頭寫過一次，清掉就沒了，而它的計時 toast 會跟測試要讀的那一則擠在同一個 status 區。
 */
function becomeFreshDevice(): void {
    window.localStorage.clear();
    window.localStorage.setItem("showmeway_pwa_install_dismissed", String(Date.now()));
}

// 收件端的背景檢查：對方之後更新了同一條連結，這台裝置重開時要主動問，而不是等使用者
// 自己再開一次網址。金鑰是留在本機的那半條，所以整件事不需要網址列還帶著它。
test("收件端背景檢查：對方更新連結後，重開就問要不要更新", async () => {
    const page = createPage();
    const hop: HopStore = { uploaded: "", puts: [], sent: [] };
    const sharedUrl = await shareOwnTripShort(page, hop);
    const firstUpload = hop.uploaded;

    // 寄件端改名再分享一次：同一條連結、同一把金鑰，密文換成新版。
    await openTripManagement(page.user);
    await renameTripInEditor(page, "測試行程二版");
    await page.user.click(screen.getByRole("button", { name: "分享行程" }));
    await waitFor(() => expect(status().textContent).toContain("分享連結已更新"));
    const secondUpload = hop.uploaded;

    becomeFreshDevice();
    hop.uploaded = firstUpload;
    mockHop(page, hop);
    await page.goto(sharedUrl);
    await screen.findByRole("heading", { level: 2, name: "測試行程" });

    // 對方發佈了新版之後，收件端重開。
    hop.uploaded = secondUpload;
    await page.goto("/");

    await screen.findByText("「測試行程二版」的分享連結有新版本");
    // 只是提示：按下去之前，這台裝置上還是舊的那份。
    screen.getByRole("heading", { level: 2, name: "測試行程" });

    await page.user.click(screen.getByRole("button", { name: "更新" }));

    await screen.findByRole("heading", { level: 2, name: "測試行程二版" });
});

test("短連結匯入：收件端解密後正常匯入，網址片段被清除", async () => {
    const page = createPage();
    const hop: HopStore = { uploaded: "", puts: [], sent: [] };
    const sharedUrl = await shareOwnTripShort(page, hop);
    ageLocalCopy();

    mockHop(page, hop);
    page.answerDialogs(true);
    await page.goto(sharedUrl);

    await waitFor(() => expect(status().textContent).toContain("已用分享連結更新行程"));
    await screen.findByRole("heading", { level: 2, name: "測試行程" });
    await expectLinkVersionOnScreen();
    expect(page.url()).not.toContain("#h=");
    // 取回密文只需要 id：金鑰從網址片段直接交給解密，不經過 hop。
    expect(hop.sent.join("\n")).not.toContain(keyOf(sharedUrl));
});

test("短連結匯入：取不到密文時保留網址片段 —— 金鑰只存在於那裡", async () => {
    const page = createPage();
    const hop: HopStore = { uploaded: "", puts: [], sent: [] };
    const sharedUrl = await shareOwnTripShort(page, hop);

    mockHop(page, hop, { getFails: true });
    await page.goto(sharedUrl);

    await waitFor(() => expect(status().textContent).toContain("請檢查網路"));
    // 清掉就等於銷毀使用者剛掃進來的那把金鑰，重新整理也救不回來。
    expect(page.url()).toContain("#h=");
    await screen.findByRole("heading", { level: 2, name: "測試行程" });
});

test("短連結匯入：密文無法解密時提示內容無效並清除網址片段", async () => {
    const page = createPage();
    const hop: HopStore = { uploaded: "", puts: [], sent: [] };
    const sharedUrl = await shareOwnTripShort(page, hop);

    mockHop(page, hop, { corrupt: true });
    await page.goto(sharedUrl);

    await waitFor(() => expect(status().textContent).toContain("分享連結內容無效"));
    // 重新整理不會讓它變得可解密，所以這條連結留著沒有意義。
    expect(page.url()).not.toContain("#h=");
});
