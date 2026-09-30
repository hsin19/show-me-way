import { yamlFingerprint } from "$lib/domain/utils";
import type { AppPage } from "./harness";

// 一個「有狀態的假 Drive」：所有 googleapis.com 端點都由它接手，檔案內容存在測試進程裡、
// 會隨 POST / PATCH / DELETE 真的變動 —— 所以 push → pull → conflict 是真的往返一輪，
// 而不是每個呼叫各回一份罐頭。

const FAKE_FOLDER_ID = "folder-showmeway";

export interface FakeFile {
    id: string;
    name: string;
    content: string;
    trashed?: boolean;
    /** 對應 Drive appProperties.startDate —— 決定切換器要不要把它摺起來 */
    startDate?: string;
    /** 對應 appProperties.showmewayTripId —— 重新綁定就是靠它認出「同一趟行程」 */
    tripId?: string;
    /** 上傳／PATCH 寫進來的其他 appProperties（分享連結就走這裡），null 代表清掉 */
    props?: Record<string, string>;
}

export interface FakeDrive {
    /** 測試中途改雲端那一側，模擬另一台裝置寫入 */
    write: (id: string, content: string) => void;
    read: (id: string) => string | undefined;
    list: () => FakeFile[];
    /** 每個端點被打了幾次：上傳、下載用來驗「按下去之前什麼都沒送」，清單用來確定開啟時那一輪已經問過 */
    counts: () => { uploads: number; downloads: number; listings: number; };
    /** 檔案上被寫進去的 appProperties —— 分享連結是 metadata，不在內容裡 */
    props: (id: string) => Record<string, string>;
}

/**
 * Drive 的 md5Checksum 的替身。app 自己從不算 md5（`crypto.subtle` 沒有 MD5），只拿它跟
 * 自己記下的值比「變了沒」，所以只要內容一變它就跟著變，哪種雜湊都一樣；src 的 tsconfig
 * 沒有 node 型別，用不到 node:crypto。加前綴讓它跟 contentHash（同一個 yamlFingerprint）
 * 永遠不相等 —— app 若把兩者拿錯來比，不會碰巧通過。
 */
export function md5Of(content: string): string {
    return `md5-${yamlFingerprint(content)}`;
}

function json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

/** 在 `page` 上接手 googleapis.com。要在 `goto` 之前裝：app 一開啟就會列清單。 */
export function installFakeDrive(page: AppPage, initial: FakeFile[] = []): FakeDrive {
    const files = new Map(initial.map(f => [f.id, { ...f }]));
    let nextId = 1;
    let uploads = 0;
    let downloads = 0;
    let listings = 0;

    const meta = (f: FakeFile) => ({
        id: f.id,
        name: f.name,
        modifiedTime: "2099-01-01T00:00:00.000Z",
        size: String(new TextEncoder().encode(f.content).length),
        md5Checksum: md5Of(f.content),
        trashed: !!f.trashed,
        appProperties: {
            // 沒指定就不帶：真的 Drive 上，沒記 tripId 的檔案就是「看不出是哪趟」，不是某個佔位 id。
            ...(f.tripId ? { showmewayTripId: f.tripId } : {}),
            // 真的算，不是寫死：假 Drive 每次被寫入都會重算，行為才跟真的 Drive 一致。
            contentHash: yamlFingerprint(f.content),
            ...(f.startDate ? { startDate: f.startDate } : {}),
            ...(f.props ?? {}),
        },
    });

    // Drive 的 appProperties 是合併寫入：沒提到的 key 留著，值為 null 的 key 被清掉。
    const mergeProps = (f: FakeFile, incoming: Record<string, string | null> | undefined) => {
        if (!incoming) return;
        f.props ??= {};
        for (const [key, value] of Object.entries(incoming)) {
            if (value === null) delete f.props[key];
            else f.props[key] = value;
        }
    };

    // multipart/related：part[1] 是 JSON metadata，part[2] 是空行之後的 YAML
    const parseMultipart = (body: string, boundary: string) => {
        const parts = body.split(`--${boundary}`);
        const head = parts[1]!;
        const metadata = JSON.parse(head.slice(head.indexOf("{"), head.lastIndexOf("}") + 1)) as { name?: string; appProperties?: Record<string, string | null>; };
        const media = parts[2]!;
        const content = media.slice(media.indexOf("\r\n\r\n") + 4).replace(/\r\n$/, "");
        return { name: metadata.name ?? "未命名行程.yaml", content, appProperties: metadata.appProperties };
    };

    page.route("https://www.googleapis.com/", async request => {
        const url = new URL(request.url);
        const method = request.method;

        if (url.pathname === "/oauth2/v3/userinfo") {
            return json({ email: "tester@example.com", name: "測試者" });
        }

        if (url.pathname.startsWith("/upload/drive/v3/files")) {
            uploads++;
            const boundary = (request.headers.get("content-type") ?? "").split("boundary=")[1]!;
            const { name, content, appProperties } = parseMultipart(await request.text(), boundary);
            const id = method === "PATCH" ? url.pathname.split("/").pop()! : `file-new-${nextId++}`;
            files.set(id, { ...files.get(id), id, name, content });
            mergeProps(files.get(id)!, appProperties);
            return json(meta(files.get(id)!));
        }

        // 資料夾搜尋與行程列表共用 files?q=。要用 "in parents" 分辨而不是 mimeType ——
        // 列表的查詢字串裡也有 `mimeType != '…folder'`，用後者會把列表誤判成資料夾搜尋。
        if (url.pathname === "/drive/v3/files" && url.searchParams.has("q")) {
            const q = url.searchParams.get("q")!;
            if (q.includes("in parents")) {
                listings++;
                return json({ files: [...files.values()].filter(f => !f.trashed).map(meta) });
            }
            return json({ files: [{ id: FAKE_FOLDER_ID, name: "ShowMeWay" }] });
        }

        if (url.pathname === "/drive/v3/files" && method === "POST") {
            return json({ id: FAKE_FOLDER_ID });
        }

        const fileId = url.pathname.replace("/drive/v3/files/", "");
        const file = files.get(fileId);
        if (method === "DELETE") {
            files.delete(fileId);
            return new Response(null, { status: 204 });
        }
        if (!file) return json({ error: { message: "not found" } }, 404);
        if (url.searchParams.get("alt") === "media") {
            downloads++;
            return new Response(file.content, { headers: { "Content-Type": "text/yaml" } });
        }
        // metadata-only PATCH：分享連結的寫入不該動到內容，也不該重算 contentHash
        if (method === "PATCH") {
            mergeProps(file, (JSON.parse((await request.text()) || "{}") as { appProperties?: Record<string, string | null>; }).appProperties);
        }
        return json(meta(file));
    });

    return {
        write: (id, content) => {
            const f = files.get(id);
            if (f) f.content = content;
        },
        read: id => files.get(id)?.content,
        list: () => [...files.values()],
        counts: () => ({ uploads, downloads, listings }),
        props: id => files.get(id)?.props ?? {},
    };
}
