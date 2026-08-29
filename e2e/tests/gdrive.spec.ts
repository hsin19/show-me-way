import type { Page } from "@playwright/test";
import { createHash } from "node:crypto";
import { yamlFingerprint } from "../../src/lib/infra/api/gdrive";
import {
    expect,
    FIXTURE_YAML,
    seedItinerary,
    test,
} from "./fixtures";

// Google Drive 同步的端對端測試。所有 googleapis.com 端點都由一個「有狀態的假 Drive」
// 接手（page 層級路由優先於 fixtures.ts 的 context 層級封鎖），檔案內容存在測試進程裡、
// 會隨 POST / PATCH / DELETE 真的變動 —— 所以 push → pull → conflict 是真的往返一輪，
// 而不是每個呼叫各回一份罐頭。md5 用 node 的 crypto 真的算，跟 Drive 的行為一致。
//
// 除了「連線」那一條，其他測試都預先把 token 快取塞進 localStorage，`getValidToken` 就
// 直接命中快取、`loadGisScript` 全程不會被呼叫；連線那條才需要把 GIS 的 script 換成 stub。

const FAKE_FOLDER_ID = "folder-showmeway";
const CLOUD_FILE_ID = "file-cloud-1";

/** 把 FIXTURE_YAML 的行程名稱換掉，用來分辨畫面上是哪一份內容 */
function yamlNamed(name: string): string {
    return FIXTURE_YAML.replace("name: 測試行程", `name: ${name}`);
}

interface FakeFile {
    id: string;
    name: string;
    content: string;
    trashed?: boolean;
    /** 對應 Drive appProperties.startDate —— 決定切換器要不要把它摺起來 */
    startDate?: string;
    /** 對應 appProperties.showmewayTripId —— 重新綁定就是靠它認出「同一趟行程」 */
    tripId?: string;
}

interface FakeDrive {
    /** 測試中途改雲端那一側，模擬另一台裝置寫入 */
    write: (id: string, content: string) => void;
    read: (id: string) => string | undefined;
    list: () => FakeFile[];
    /** 每個端點被打了幾次，用來驗 debounce 有沒有真的合併 */
    counts: () => { uploads: number; downloads: number; };
}

async function installFakeDrive(page: Page, initial: FakeFile[] = []): Promise<FakeDrive> {
    const files = new Map(initial.map(f => [f.id, { ...f }]));
    let nextId = 1;
    let uploads = 0;
    let downloads = 0;

    const md5 = (content: string) => createHash("md5").update(content, "utf8").digest("hex");
    const meta = (f: FakeFile) => ({
        id: f.id,
        name: f.name,
        modifiedTime: "2099-01-01T00:00:00.000Z",
        size: String(Buffer.byteLength(f.content, "utf8")),
        md5Checksum: md5(f.content),
        trashed: !!f.trashed,
        appProperties: {
            showmewayTripId: f.tripId ?? "seeded",
            // 真的算，不是寫死：假 Drive 每次被寫入都會重算，行為才跟真的 Drive 一致。
            contentHash: yamlFingerprint(f.content),
            ...(f.startDate ? { startDate: f.startDate } : {}),
        },
    });

    // multipart/related：part[1] 是 JSON metadata，part[2] 是空行之後的 YAML
    const parseMultipart = (body: string, boundary: string) => {
        const parts = body.split(`--${boundary}`);
        const metadata = JSON.parse(parts[1].slice(parts[1].indexOf("{"), parts[1].lastIndexOf("}") + 1)) as { name?: string; };
        const media = parts[2];
        const content = media.slice(media.indexOf("\r\n\r\n") + 4).replace(/\r\n$/, "");
        return { name: metadata.name ?? "未命名行程.yaml", content };
    };

    await page.route("https://www.googleapis.com/**", async route => {
        const req = route.request();
        const url = new URL(req.url());
        const method = req.method();

        if (url.pathname === "/oauth2/v3/userinfo") {
            return route.fulfill({ json: { email: "tester@example.com", name: "測試者" } });
        }

        if (url.pathname.startsWith("/upload/drive/v3/files")) {
            uploads++;
            const boundary = (req.headers()["content-type"] ?? "").split("boundary=")[1];
            const { name, content } = parseMultipart(req.postData() ?? "", boundary);
            const id = method === "PATCH" ? url.pathname.split("/").pop()! : `file-new-${nextId++}`;
            files.set(id, { id, name, content });
            return route.fulfill({ json: meta(files.get(id)!) });
        }

        // 資料夾搜尋與行程列表共用 files?q=。要用 "in parents" 分辨而不是 mimeType ——
        // 列表的查詢字串裡也有 `mimeType != '…folder'`，用後者會把列表誤判成資料夾搜尋。
        if (url.pathname === "/drive/v3/files" && url.searchParams.has("q")) {
            const q = url.searchParams.get("q")!;
            if (q.includes("in parents")) {
                return route.fulfill({ json: { files: [...files.values()].filter(f => !f.trashed).map(meta) } });
            }
            return route.fulfill({ json: { files: [{ id: FAKE_FOLDER_ID, name: "ShowMeWay" }] } });
        }

        if (url.pathname === "/drive/v3/files" && method === "POST") {
            return route.fulfill({ json: { id: FAKE_FOLDER_ID } });
        }

        const fileId = url.pathname.replace("/drive/v3/files/", "");
        const file = files.get(fileId);
        if (method === "DELETE") {
            files.delete(fileId);
            return route.fulfill({ status: 204, body: "" });
        }
        if (!file) return route.fulfill({ status: 404, json: { error: { message: "not found" } } });
        if (url.searchParams.get("alt") === "media") {
            downloads++;
            return route.fulfill({ body: file.content, contentType: "text/yaml" });
        }
        return route.fulfill({ json: meta(file) });
    });

    return {
        write: (id, content) => {
            const f = files.get(id);
            if (f) f.content = content;
        },
        read: id => files.get(id)?.content,
        list: () => [...files.values()],
        counts: () => ({ uploads, downloads }),
    };
}

/**
 * 以「已連線」狀態開場。塞的是 token 快取而不是假的 window.google，所以 GIS 完全不介入；
 * `trips` 有 record 時代表這個行程已經綁好雲端檔（`localHash` 用真的指紋，才算「本機沒變」）。
 */
async function seedConnected(page: Page, options: { autoSync?: boolean; expiredToken?: boolean; record?: { fileId: string; remoteMd5: string; localHash: string; }; } = {}) {
    await page.addInitScript(seed => {
        window.localStorage.setItem("showmeway_gdrive_user", JSON.stringify({ email: "tester@example.com", name: "測試者" }));
        window.localStorage.setItem(
            "showmeway_gdrive_token",
            JSON.stringify({ token: "e2e-token", expiresAt: Date.now() + (seed.expiredToken ? -3600_000 : 3600_000) }),
        );
        window.localStorage.setItem("showmeway_gdrive_auto_sync", seed.autoSync ? "true" : "false");
        if (seed.record) {
            window.localStorage.setItem("showmeway_gdrive_trips", JSON.stringify({ [seed.tripId]: seed.record }));
        }
        window.localStorage.setItem("showmeway_active_profile", seed.tripId);
    }, { autoSync: !!options.autoSync, expiredToken: !!options.expiredToken, record: options.record, tripId: "p-e2e" });
}

function md5Of(content: string): string {
    return createHash("md5").update(content, "utf8").digest("hex");
}

async function openTripManagement(page: Page) {
    await page.locator("nav").getByRole("button", { name: "工具", exact: true }).click();
    await page.getByRole("button", { name: "行程管理", exact: true }).click();
}

/**
 * GIS 的 SDK 換成 stub：initTokenClient 直接回一個含 drive.file scope 的 token，
 * 這樣 loadGisScript 與 requestGoogleAccessToken（含 scope 檢查）都真的被執行到。
 * 只有使用者主動按下的流程才會走到它；背景刷新一律停在快取 token。
 */
async function installGisStub(page: Page) {
    await page.route("https://accounts.google.com/gsi/client", route =>
        route.fulfill({
            contentType: "text/javascript",
            body: `window.google = { accounts: { oauth2: { initTokenClient: (config) => ({
                requestAccessToken: () => config.callback({
                    access_token: "gis-token",
                    expires_in: 3600,
                    scope: "https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/userinfo.email",
                }),
            }) } } };`,
        }));
}

test("連線 Google：走完 GIS 流程並把行程建立成雲端檔", async ({ page }) => {
    const drive = await installFakeDrive(page);
    await installGisStub(page);
    await seedItinerary(page);
    await page.goto("/");

    await page.locator("nav").getByRole("button", { name: "工具", exact: true }).click();
    await page.getByRole("button", { name: "App 設定", exact: true }).click();
    await expect(page.getByText("未連線", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "登入 Google" }).click();

    await expect(page.getByText("已連線", { exact: true })).toBeVisible();
    await expect(page.getByText("測試者 (tester@example.com)")).toBeVisible();

    await openTripManagement(page);
    await page.getByRole("button", { name: "上傳此行程至 Google Drive (建立新檔案)" }).click();
    await expect(page.getByText(/已建立雲端備份/)).toBeVisible();

    expect(drive.list()).toHaveLength(1);
    expect(drive.list()[0].content).toContain("name: 測試行程");
});

test("重新綁定：登出再登入後靠 trip.id 認回雲端檔案，不是當成沒備份過", async ({ page }) => {
    // 登出會留下行程本身，但不留 sync record —— 修好之前這裡會顯示「建立新檔案」，
    // 按下去就多一份重複的雲端檔。
    const drive = await installFakeDrive(page, [
        { id: CLOUD_FILE_ID, name: "測試行程.yaml", content: FIXTURE_YAML, tripId: "t-fixture" },
    ]);
    await seedItinerary(page);
    await seedConnected(page);
    await page.goto("/");

    await openTripManagement(page);

    // 內容一致 → 直接認回完整的比對基準，按鈕停在「同步」而不是「上傳」。
    await expect(page.getByRole("button", { name: "同步行程 (比對本地與雲端內容差異)" })).toBeVisible();
    expect(drive.counts().downloads).toBe(0);
    expect(drive.list()).toHaveLength(1);
});

test("按一下同步：雲端較新時先給下載按鈕，再按一次才真的換掉畫面上的行程", async ({ page }) => {
    const cloudYaml = yamlNamed("雲端版行程");
    const drive = await installFakeDrive(page, [{ id: CLOUD_FILE_ID, name: "測試行程.yaml", content: FIXTURE_YAML }]);
    await seedItinerary(page);
    await seedConnected(page, {
        // 上次同步時雙方一致；接著只有雲端動了。
        record: { fileId: CLOUD_FILE_ID, remoteMd5: md5Of(FIXTURE_YAML), localHash: yamlFingerprint(FIXTURE_YAML) },
    });
    await page.goto("/");
    drive.write(CLOUD_FILE_ID, cloudYaml);

    await openTripManagement(page);
    await page.getByRole("button", { name: "同步行程 (比對本地與雲端內容差異)" }).click();

    // 第一下只是檢查：按鈕換成「下載」，還沒真的動到本機內容。
    await expect(page.getByText(/有新版本，可以下載更新/)).toBeVisible();
    expect(drive.counts().downloads).toBe(0);
    const downloadButton = page.getByRole("button", { name: "下載雲端最新版本 (覆蓋本機)" });
    await expect(downloadButton).toBeVisible();

    await downloadButton.click();

    await expect(page.getByText(/已載入雲端版本/)).toBeVisible();
    // 真的套用了：回到行程分頁看得到新名稱，而不只是 toast 說有。
    await page.locator("nav").getByRole("button", { name: "行程", exact: true }).click();
    await expect(page.getByRole("heading", { name: "雲端版行程" })).toBeVisible();
    // 覆蓋前先進了備份環，所以還原得回來。
    await openTripManagement(page);
    await expect(page.getByRole("button", { name: /還原/ }).first()).toBeVisible();
});

test("按一下上傳：本機與雲端都改過時停下來問，且兩側都不動", async ({ page }) => {
    const drive = await installFakeDrive(page, [{ id: CLOUD_FILE_ID, name: "測試行程.yaml", content: FIXTURE_YAML }]);
    await seedItinerary(page);
    await seedConnected(page, {
        // localHash 是舊的 → 本機也算動過，按鈕一開始就是「上傳」而不是「同步」。
        record: { fileId: CLOUD_FILE_ID, remoteMd5: md5Of(FIXTURE_YAML), localHash: "stale-fingerprint" },
    });
    await page.goto("/");
    drive.write(CLOUD_FILE_ID, yamlNamed("雲端版行程"));

    await openTripManagement(page);
    await page.getByRole("button", { name: "上傳本機異動到 Google Drive (覆蓋雲端版本)" }).click();

    const strip = page.getByRole("alertdialog", { name: /都改過/ });
    await expect(strip).toBeVisible();
    // 沒有上傳、雲端內容原封不動。
    expect(drive.counts().uploads).toBe(0);
    expect(drive.read(CLOUD_FILE_ID)).toContain("name: 雲端版行程");

    await page.getByRole("button", { name: "採用雲端版本" }).click();
    await page.getByRole("button", { name: "採用雲端" }).click();

    await page.locator("nav").getByRole("button", { name: "行程", exact: true }).click();
    await expect(page.getByRole("heading", { name: "雲端版行程" })).toBeVisible();
});

test("衝突時選擇保留本機：雲端內容被本機取代", async ({ page }) => {
    const drive = await installFakeDrive(page, [{ id: CLOUD_FILE_ID, name: "測試行程.yaml", content: FIXTURE_YAML }]);
    await seedItinerary(page);
    await seedConnected(page, {
        record: { fileId: CLOUD_FILE_ID, remoteMd5: md5Of(FIXTURE_YAML), localHash: "stale-fingerprint" },
    });
    await page.goto("/");
    drive.write(CLOUD_FILE_ID, yamlNamed("雲端版行程"));

    await openTripManagement(page);
    await page.getByRole("button", { name: "上傳本機異動到 Google Drive (覆蓋雲端版本)" }).click();
    await expect(page.getByRole("alertdialog", { name: /都改過/ })).toBeVisible();

    await page.getByRole("button", { name: "保留本機版本" }).click();
    await page.getByRole("button", { name: "覆蓋雲端" }).click();

    await expect(page.getByText(/已以本機版本覆蓋雲端/)).toBeVisible();
    expect(drive.read(CLOUD_FILE_ID)).toContain("name: 測試行程");
});

test("衝突時兩份都留：雲端版成為這趟行程，本機版另存成新行程", async ({ page }) => {
    const drive = await installFakeDrive(page, [{ id: CLOUD_FILE_ID, name: "測試行程.yaml", content: FIXTURE_YAML }]);
    await seedItinerary(page);
    await seedConnected(page, {
        record: { fileId: CLOUD_FILE_ID, remoteMd5: md5Of(FIXTURE_YAML), localHash: "stale-fingerprint" },
    });
    await page.goto("/");
    drive.write(CLOUD_FILE_ID, yamlNamed("雲端版行程"));

    await openTripManagement(page);
    await page.getByRole("button", { name: "上傳本機異動到 Google Drive (覆蓋雲端版本)" }).click();
    await expect(page.getByRole("alertdialog", { name: /都改過/ })).toBeVisible();

    await page.getByRole("button", { name: /兩份都留/ }).click();
    await page.getByRole("button", { name: "兩份都留", exact: true }).click();

    // 畫面上留的是本機那份，改了名字才分得出來。
    await expect(page.getByRole("heading", { level: 2, name: "測試行程（本機版）" })).toBeVisible();
    // 雲端那份沒有被覆蓋，而且成為停放中的另一趟行程。
    expect(drive.read(CLOUD_FILE_ID)).toContain("name: 雲端版行程");
    expect(drive.counts().uploads).toBe(0);

    await openTripManagement(page);
    await page.getByRole("button", { name: /目前行程/ }).click();
    await expect(page.getByRole("button", { name: /雲端版行程.*切換/ })).toBeVisible();

    // 兩趟行程的身分必須分開，否則會搶同一個雲端檔案。
    const ids = await page.evaluate(() => {
        const idOf = (yaml: string | null) => yaml?.match(/^\s+id:\s*(\S+)/m)?.[1] ?? null;
        const parked = JSON.parse(localStorage.getItem("showmeway_profiles") ?? "[]") as { yaml: string; }[];
        return { active: idOf(localStorage.getItem("showmeway_user_yaml")), parked: parked.map(p => idOf(p.yaml)) };
    });
    // 綁定留在原本那個 slot，所以雲端版保住 t-fixture；本機版是新的一趟。
    expect(ids.parked).toEqual(["t-fixture"]);
    expect(ids.active).toBeTruthy();
    expect(ids.active).not.toBe("t-fixture");
});

test("雲端行程清單：載入為新行程，原行程仍可切回；刪除後該列消失", async ({ page }) => {
    await installFakeDrive(page, [{ id: CLOUD_FILE_ID, name: "另一趟旅行", content: yamlNamed("另一趟旅行") }]);
    await seedItinerary(page);
    await seedConnected(page);
    await page.goto("/");

    await openTripManagement(page);
    await page.getByRole("button", { name: /目前行程/ }).click();
    await page.getByRole("button", { name: /另一趟旅行.*載入/ }).click();
    await page.getByRole("button", { name: "確定載入" }).click();

    await expect(page.getByText(/已從 Google Drive 載入/)).toBeVisible();
    await page.locator("nav").getByRole("button", { name: "行程", exact: true }).click();
    await expect(page.getByRole("heading", { name: "另一趟旅行" })).toBeVisible();

    // 原本的行程被停放成 profile，沒有被覆蓋。
    await openTripManagement(page);
    await page.getByRole("button", { name: /目前行程/ }).click();
    await expect(page.getByRole("button", { name: /測試行程.*切換/ })).toBeVisible();
});

test("刪除雲端行程：確認後該列從清單消失", async ({ page }) => {
    const drive = await installFakeDrive(page, [{ id: CLOUD_FILE_ID, name: "待刪行程", content: yamlNamed("待刪行程") }]);
    await seedItinerary(page);
    await seedConnected(page);
    await page.goto("/");

    await openTripManagement(page);
    await page.getByRole("button", { name: /目前行程/ }).click();
    const row = page.getByRole("button", { name: /待刪行程.*載入/ });
    await expect(row).toBeVisible();

    await page.getByRole("button", { name: "刪除雲端檔案 待刪行程" }).click();
    await page.getByRole("button", { name: "確定刪除" }).click();

    await expect(page.getByText("已從 Google Drive 刪除行程")).toBeVisible();
    await expect(row).toBeHidden();
    expect(drive.list()).toHaveLength(0);
});

test("儲存完同步：連續操作在 debounce 窗口內只上傳一次", async ({ page }) => {
    const drive = await installFakeDrive(page);
    await seedItinerary(page);
    await seedConnected(page, { autoSync: true });
    await page.goto("/");

    // 三次 persistTripData：勾一個待辦、取消、再勾回來。
    await page.locator("nav").getByRole("button", { name: "工具", exact: true }).click();
    const todo = page.getByRole("checkbox", { name: /測試待辦項目/ });
    await todo.check();
    await todo.uncheck();
    await todo.check();

    // debounce 是 4s，等它收斂後才數。
    await expect.poll(() => drive.counts().uploads, { timeout: 15_000 }).toBe(1);
    expect(drive.list()[0].content).toContain("checked: true");
});

// 主畫面的「切換行程」抽屜：本機行程下方恆為單一雲端列 —— 清單、重新連線、或登入。
// 之所以要在這裡驗，是因為它是唯一允許把取 token 升級到 cache-only 之上的入口。

test("切換行程抽屜：未登入時給的是登入入口", async ({ page }) => {
    await installFakeDrive(page);
    await seedItinerary(page);
    await page.goto("/");

    await page.getByRole("button", { name: "切換行程選單" }).click();

    await expect(page.getByRole("button", { name: "登入 Google 取得雲端行程" })).toBeVisible();
});

test("切換行程抽屜：token 過期時顯示重新連線，連上後雲端行程才出現", async ({ page }) => {
    await installFakeDrive(page, [{ id: CLOUD_FILE_ID, name: "另一趟旅行", content: yamlNamed("另一趟旅行") }]);
    await seedItinerary(page);
    await seedConnected(page, { expiredToken: true });
    await page.goto("/");

    // 背景刷新只用快取 token，過期就停在這一列 —— 不碰 GIS，也就不可能彈視窗。
    await page.getByRole("button", { name: "切換行程選單" }).click();
    const reconnect = page.getByRole("button", { name: "雲端連線中斷，點此重新連線" });
    await expect(reconnect).toBeVisible();
    await expect(page.getByRole("button", { name: /另一趟旅行/ })).toBeHidden();

    // 使用者主動按下去才走 GIS：失敗過的 script 標籤已被忘掉，這次會重新注入。
    await installGisStub(page);
    await reconnect.click();

    await expect(page.getByRole("button", { name: /另一趟旅行.*載入/ })).toBeVisible();
});

test("切換行程抽屜：一個月前的雲端行程摺起來，載入後再開又摺回去", async ({ page }) => {
    await installFakeDrive(page, [
        { id: "file-soon", name: "即將出發", content: yamlNamed("即將出發"), startDate: "2099-01-01" },
        { id: "file-old", name: "去年那趟", content: yamlNamed("去年那趟"), startDate: "2020-01-01" },
    ]);
    await seedItinerary(page);
    await seedConnected(page);
    await page.goto("/");

    await page.getByRole("button", { name: "切換行程選單" }).click();
    await expect(page.getByRole("button", { name: /即將出發.*載入/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /去年那趟.*載入/ })).toBeHidden();

    const loadEarlier = page.getByRole("button", { name: "載入更早的 1 筆行程" });
    await loadEarlier.click();
    await expect(page.getByRole("button", { name: /去年那趟.*載入/ })).toBeVisible();
    await expect(loadEarlier).toBeHidden();

    // 單向展開：關掉再開就自己摺回去，不必使用者收。
    await page.getByRole("button", { name: "切換行程選單" }).click();
    await page.getByRole("button", { name: "切換行程選單" }).click();
    await expect(page.getByRole("button", { name: "載入更早的 1 筆行程" })).toBeVisible();
    await expect(page.getByRole("button", { name: /去年那趟.*載入/ })).toBeHidden();
});
