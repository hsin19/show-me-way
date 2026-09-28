import { SITE_URL } from "$lib/config";
import { buildShortShareUrl } from "$lib/domain/share";
import { resealShareToken } from "$lib/domain/share-crypto";
import {
    serializeToYaml,
    validateYaml,
} from "$lib/domain/trip";
import { yamlFingerprint } from "$lib/domain/utils";
import {
    agreedRecord,
    buildRebindRecord,
    clearDeadShareLink,
    type CloudSyncPlan,
    type CloudTripFile,
    fetchCloudTrip,
    getCachedAccessToken,
    type GoogleUser,
    listCloudTrips,
    loadGdriveUser,
    loadTripSyncMap,
    planCloudSync,
    rebindCandidates,
    saveGdriveUser,
    saveTripSyncMap,
    setCachedAccessToken,
    type TripSyncRecord,
} from "$lib/infra/http/gdrive";
import {
    PERSISTENT_LINK_TTL_SECONDS,
    updateHopBlob,
} from "$lib/infra/http/hop";
import {
    tripIdFromYaml,
    tripNameFromYaml,
} from "$lib/infra/storage/profiles";
import type { ShareLinkRecord } from "$lib/infra/storage/share-links";
import { spawn } from "node:child_process";
import {
    createHash,
    randomBytes,
} from "node:crypto";
import {
    chmodSync,
    existsSync,
    lstatSync,
    mkdirSync,
    readdirSync,
    readFileSync,
    readlinkSync,
    rmSync,
    symlinkSync,
    writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import {
    basename,
    dirname,
    relative,
    resolve,
} from "node:path";
import { parseArgs } from "node:util";

/*
 * Local counterpart of the app's Drive sync, for editing a trip's YAML on this machine.
 * It authenticates as a Desktop OAuth client in the same Cloud project as the web app's
 * client: `drive.file` grants are per project, so that is what lets it see the files the
 * web app created without asking for the whole Drive.
 *
 * It is one more device to the sync model, not a new one, and keeps only what is CLI-shaped:
 * OAuth, working copies, argv. Everything else is the app's own code — `planCloudSync` for
 * the direction and the transfer, the record map and token cache in the localStorage Node
 * backs with `.trip-sync/localstorage` — so a rule changed in the app reaches this tool
 * without a second edit. Like the app it transfers only on an explicit checkout, pull or
 * push. The `$lib` imports resolve through `resolve-hooks.ts`, which the script preloads.
 *
 * A push also puts the new version behind the trip's share link, unless `--no-share` says
 * not to: pushing is the owner's say-so that the version is ready, and holding the link
 * back would only leave recipients on the older one. The link's id, key and editToken come
 * from the Drive file's properties and stay in memory; the URL is printed for the owner,
 * the way the app hands it over after sharing. It never mints a link: one hop no longer
 * accepts was most likely revoked on another device, and a replacement would be a new URL
 * to hand out all over again.
 *
 * The client id and secret come from `.env` (gitignored). The names carry no `VITE_` prefix
 * on purpose — Vite reads the same file, and only prefixed values get inlined into the
 * bundle. The refresh token is not configuration but state `login` mints, so it sits in
 * `.trip-sync/` with the rest of this tool's state, readable only by this user.
 */

const ROOT = resolve(import.meta.dirname, "..");
const ENV_FILE = resolve(ROOT, ".env");
const SYNC_DIR = resolve(ROOT, ".trip-sync");
const TOKEN_FILE = resolve(SYNC_DIR, "refresh-token");
const TRIPS_DIR = resolve(SYNC_DIR, "trips");
const BACKUP_DIR = resolve(SYNC_DIR, "backups");
const LINK = resolve(ROOT, "public/itinerary.local.yaml");
const CHECKED_OUT_FILE = resolve(SYNC_DIR, "checked-out");
const SCOPE = "https://www.googleapis.com/auth/drive.file";

function loadEnv(): Record<string, string | undefined> {
    if (existsSync(ENV_FILE)) process.loadEnvFile(ENV_FILE);
    return process.env;
}

function requireClient(env: Record<string, string | undefined>): { clientId: string; clientSecret: string; } {
    const clientId = env.GDRIVE_CLI_CLIENT_ID;
    const clientSecret = env.GDRIVE_CLI_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
        throw new Error("在 .env 設定 GDRIVE_CLI_CLIENT_ID 與 GDRIVE_CLI_CLIENT_SECRET（Desktop 類型的 OAuth client）");
    }
    return { clientId, clientSecret };
}

async function login(): Promise<void> {
    const { clientId, clientSecret } = requireClient(loadEnv());
    const verifier = randomBytes(32).toString("base64url");
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    const state = randomBytes(16).toString("hex");

    const server = createServer();
    await new Promise<void>(done => server.listen(0, "127.0.0.1", done));
    const redirectUri = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    const code = await new Promise<string>((done, fail) => {
        // `close` stops new connections only; a keep-alive socket, or one the browser opened
        // ahead and never used, would hold the process open until the browser drops it.
        const shutDown = () => {
            server.close();
            server.closeAllConnections();
        };
        // Google shows its own error page instead of redirecting when the client is not a
        // Desktop one or the account is not a test user, so nothing would ever arrive here.
        const timeout = setTimeout(() => {
            shutDown();
            fail(new Error("5 分鐘內沒有完成登入：瀏覽器停在 Google 錯誤頁的話，確認 client 是 Desktop 類型、帳號在 OAuth 同意畫面的測試使用者裡"));
        }, 5 * 60_000);
        server.on("request", (req, res) => {
            const url = new URL(req.url ?? "/", redirectUri);
            // Only the redirect carries an answer; anything else reaching the port (a stray
            // visit, a prefetch) must not end the login.
            if (!url.searchParams.has("code") && !url.searchParams.has("error")) {
                res.writeHead(404).end();
                return;
            }
            const received = url.searchParams.get("code");
            const ok = !!received && url.searchParams.get("state") === state;
            res.writeHead(ok ? 200 : 400, { "content-type": "text/plain; charset=utf-8" });
            // The tab cannot say the login worked: the code still has to be exchanged, and that can fail.
            res.end(ok ? "已收到授權，回終端機看結果。" : "登入失敗，回終端機看訊息。", shutDown);
            clearTimeout(timeout);
            if (ok) done(received);
            else fail(new Error(url.searchParams.get("error") ?? "state 不符"));
        });

        const auth = new URL("https://accounts.google.com/o/oauth2/v2/auth");
        auth.search = new URLSearchParams({
            client_id: clientId,
            redirect_uri: redirectUri,
            response_type: "code",
            scope: SCOPE,
            // Without offline + consent Google may omit the refresh token on a repeat login; the
            // chooser is there because a browser signed in to one account would skip it.
            access_type: "offline",
            prompt: "select_account consent",
            code_challenge: challenge,
            code_challenge_method: "S256",
            state,
        }).toString();
        console.log(`瀏覽器沒自動打開的話，手動開這個網址：\n${auth.href}`);
        spawn("open", [auth.href], { stdio: "ignore" }).on("error", () => {});
    });

    const res = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, code, code_verifier: verifier, redirect_uri: redirectUri, grant_type: "authorization_code" }),
    });
    // A body that is not JSON (a proxy's error page) still leaves the status to report.
    const body = await res.json().catch(() => ({})) as { refresh_token?: string; access_token?: string; expires_in?: number; error?: string; error_description?: string; };
    if (!res.ok || !body.refresh_token || !body.access_token) throw new Error(`換 token 失敗：${body.error_description ?? body.error ?? `HTTP ${res.status}`}`);
    // Before anything is stored: tokens for an account the records do not describe would push
    // copies into it, so failing here has to leave the previous login whole.
    const account = await driveAccount(body.access_token).catch((error: unknown) => {
        throw new Error(`登入沒有完成，原本的登入不受影響：${describeError(error)}`);
    });

    writeFileSync(TOKEN_FILE, `${body.refresh_token}\n`, { mode: 0o600 });
    // `mode` applies only when the file is created, and an older login may have left it wider.
    chmodSync(TOKEN_FILE, 0o600);
    // Replaces the previous login's cached token, which would otherwise keep acting as that
    // account until it expires — up to an hour of reading and writing the wrong Drive.
    setCachedAccessToken(body.access_token, body.expires_in ?? 3600);

    // As the app's connect does: the records name files the previous account owns, and each
    // would read as deleted here, so the next push would copy the trip into this one. A login
    // that stored no account cannot be told apart, and the binding is a cache the next
    // command rebuilds from the listing, so an unknown previous account counts as another.
    const previous = loadGdriveUser();
    if (previous?.email !== account.email && Object.keys(loadTripSyncMap()).length > 0) {
        saveTripSyncMap({});
        console.log(previous ? `已改用 ${account.email}（原本是 ${previous.email}），行程的雲端綁定已重設` : "之前的登入沒記下帳號，行程的雲端綁定已重設，下次 status 會重新對上");
    }
    saveGdriveUser(account);
    console.log(`已登入 ${account.email}，refresh token 寫入 ${relative(ROOT, TOKEN_FILE)}`);
}

/** The account a token acts as. From Drive rather than userinfo, which `drive.file` alone does not grant. */
async function driveAccount(token: string): Promise<GoogleUser> {
    const res = await fetch("https://www.googleapis.com/drive/v3/about?fields=user(emailAddress,displayName)", {
        headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json().catch(() => ({})) as { user?: { emailAddress?: string; displayName?: string; }; };
    const email = body.user?.emailAddress;
    if (!res.ok || !email) throw new Error(`讀不到登入的帳號：HTTP ${res.status}`);
    return { email, name: body.user?.displayName || email };
}

async function accessToken(): Promise<string> {
    const cached = getCachedAccessToken();
    if (cached) return cached;
    const { clientId, clientSecret } = requireClient(loadEnv());
    const refreshToken = existsSync(TOKEN_FILE) ? readFileSync(TOKEN_FILE, "utf8").trim() : "";
    if (!refreshToken) throw new Error("還沒登入：先跑 pnpm run trip:sync login");
    const res = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: "refresh_token" }),
    });
    const body = await res.json().catch(() => ({})) as { access_token?: string; expires_in?: number; error?: string; };
    // invalid_grant is the expired/revoked case — a consent screen still in "Testing" hits it after 7 days.
    if (body.error === "invalid_grant") throw new Error("refresh token 失效，重跑 pnpm run trip:sync login");
    if (!res.ok || !body.access_token) throw new Error(`取得 access token 失敗：${body.error ?? `HTTP ${res.status}`}`);
    setCachedAccessToken(body.access_token, body.expires_in ?? 3600);
    return body.access_token;
}

/*
 * Working copies live in `.trip-sync/trips/<tripId>.yaml`, one per trip, and
 * `public/itinerary.local.yaml` is a symlink to whichever is checked out — the file the dev
 * server seeds from and the one to edit. Named by id, not trip name, because a rename or
 * two trips sharing a name must not move or merge a copy. Switching never touches a copy,
 * so unpushed edits wait in theirs. The trip id doubles as the record map's slot id, the
 * role a profile id plays in the app.
 */
function tripPath(tripId: string): string {
    if (!isFileNameSafe(tripId)) throw new Error(`tripId「${tripId}」不能當檔名，這份行程沒辦法 checkout`);
    return resolve(TRIPS_DIR, `${tripId}.yaml`);
}

/**
 * The id comes from Drive metadata and YAML other devices wrote — a trip imported from a share
 * link keeps its sender's — and it reaches a path.
 */
function isFileNameSafe(tripId: string): boolean {
    return /^[\w-]+$/.test(tripId);
}

function hasWorkingCopy(tripId: string): boolean {
    return isFileNameSafe(tripId) && existsSync(tripPath(tripId));
}

function checkedOutTripId(): string | null {
    try {
        if (!lstatSync(LINK).isSymbolicLink()) return null;
        const target = resolve(dirname(LINK), readlinkSync(LINK));
        return dirname(target) === TRIPS_DIR ? basename(target, ".yaml") : null;
    } catch {
        return null;
    }
}

/**
 * The trip checkout last linked, when a regular file now sits where the link was. A tool that
 * saves by renaming a temp file over the path swaps the symlink for a copy, with the edits in
 * it and the working copy left behind — but a file put there on purpose looks the same, and
 * so does a save made mid-edit that no longer parses. Nothing here guesses which: callers
 * leave it to the user unless the file is identical to the working copy.
 */
function displacedLinkTripId(): string | null {
    if (!existsSync(LINK) || lstatSync(LINK).isSymbolicLink() || !existsSync(CHECKED_OUT_FILE)) return null;
    const tripId = readFileSync(CHECKED_OUT_FILE, "utf8").trim();
    return isFileNameSafe(tripId) ? tripId : null;
}

function linkMatchesWorkingCopy(tripId: string): boolean {
    return hasWorkingCopy(tripId) && readFileSync(LINK, "utf8") === readFileSync(tripPath(tripId), "utf8");
}

function displacedLinkError(tripId: string): Error {
    const link = relative(ROOT, LINK);
    const relink = `pnpm run trip:sync checkout ${tripId}`;
    if (linkMatchesWorkingCopy(tripId)) return new Error(`${link} 不是 symlink 了，內容跟工作副本一樣，接回就好：\n  ${relink}`);
    const mkdir = existsSync(TRIPS_DIR) ? "" : `mkdir -p ${relative(ROOT, TRIPS_DIR)} && `;
    return new Error([
        `${link} 不是 symlink 了（上次 checkout 的是 ${tripId}），${hasWorkingCopy(tripId) ? "內容跟工作副本不一樣" : "工作副本也不見了"}。`,
        "如果是存檔時整檔替換掉 symlink，修改都在這個檔裡，在 repo 根目錄搬回工作副本：",
        `  ${mkdir}mv ${link} ${relative(ROOT, tripPath(tripId))}`,
        "如果是另外放進來的檔，先把它移走。處理完再接回：",
        `  ${relink}`,
    ].join("\n"));
}

/**
 * Keeps the record `displacedLinkTripId` reads once the link is gone. Refreshed wherever the
 * link is seen intact, not only by checkout, so one that is missing or stale is back by the
 * next command.
 */
function recordCheckout(tripId: string): void {
    if (!existsSync(CHECKED_OUT_FILE) || readFileSync(CHECKED_OUT_FILE, "utf8").trim() !== tripId) writeFileSync(CHECKED_OUT_FILE, `${tripId}\n`);
}

/** Read before asking for a token, so that what is wrong on this machine does not hide behind a login or a network error. */
function checkedOut(): { tripId: string; path: string; yaml: string; } {
    const tripId = checkedOutTripId();
    if (!tripId) {
        const displaced = displacedLinkTripId();
        if (displaced) throw displacedLinkError(displaced);
        throw new Error("還沒 checkout 行程：先跑 pnpm run trip:sync checkout <行程名或 tripId>");
    }
    recordCheckout(tripId);
    const path = tripPath(tripId);
    if (!existsSync(path)) throw new Error(`${relative(ROOT, path)} 不見了：重新 checkout 一次`);
    return { tripId, path, yaml: readFileSync(path, "utf8") };
}

function saveRecord(tripId: string, record: TripSyncRecord): void {
    saveTripSyncMap({ ...loadTripSyncMap(), [tripId]: record });
}

/** The trip's record, rebuilt the way the app's `reconcileBindings` does when this machine holds none yet. */
async function recordFor(token: string, tripId: string, localYaml: string): Promise<TripSyncRecord | null> {
    const records = loadTripSyncMap();
    const known = records[tripId];
    if (known) return known;
    const file = rebindCandidates(await listCloudTrips(token), Object.values(records).map(record => record.fileId))[tripId];
    if (!file) return null;
    const record = buildRebindRecord(file, yamlFingerprint(localYaml));
    saveRecord(tripId, record);
    return record;
}

function backup(label: string, content: string): void {
    const path = resolve(BACKUP_DIR, `${label}.${new Date().toISOString().replace(/[:.]/g, "-")}.yaml`);
    mkdirSync(BACKUP_DIR, { recursive: true });
    writeFileSync(path, content);
    console.log(`原本的版本備份在 ${relative(ROOT, path)}`);
}

const DECISION_TEXT: Record<CloudSyncPlan["decision"], string> = {
    up_to_date: "兩邊一致",
    pull: "雲端有更新，可以 pull",
    push: "本機有修改，可以 push",
    conflict: "兩邊都改過（或從沒對齊過），加 --force 指定要以哪邊為準",
};

/** A plan in the words the commands print. */
function describe(plan: CloudSyncPlan): string {
    // A push with no remote is not an edit to send: the bound file is gone, or nothing was ever bound.
    if (plan.decision === "push" && !plan.remoteFile) return "雲端找不到這趟行程的檔案（可能被刪掉了），push 會另外建立一份新的";
    return DECISION_TEXT[plan.decision];
}

/**
 * Stores what an up_to_date plan proved, as the app's 比對 does. It transfers nothing, and
 * leaving the old base in place would make the next edit on either side read as a conflict.
 */
function settle(tripId: string, plan: CloudSyncPlan): void {
    if (plan.decision === "up_to_date" && plan.settled) saveRecord(tripId, plan.settled);
}

/** Reports a plan that does not go the way `command` asked, with what the user can do about it. */
function report(tripId: string, plan: CloudSyncPlan, command: "pull" | "push"): void {
    settle(tripId, plan);
    if (plan.decision === "up_to_date") {
        console.log(describe(plan));
        return;
    }
    console.error(describe(plan));
    if (command === "pull" && plan.decision === "push" && plan.remoteFile) console.error("要捨棄本機的修改、改用雲端版本：pull --force（會先備份）");
    if (command === "push" && plan.decision === "pull" && flags.force) console.error("push --force 只用來解衝突：本機沒有修改，照做只會用舊版蓋掉雲端的修改");
    process.exitCode = 1;
}

/** Terminal columns, not code units: CJK and fullwidth characters take two, which is what padStart/padEnd miss. */
function displayWidth(text: string): number {
    return [...text].reduce((width, char) => width + (/[\u1100-\u115F\u2E80-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE4F\uFF00-\uFF60\uFFE0-\uFFE6]/.test(char) ? 2 : 1), 0);
}

function padDisplay(text: string, width: number): string {
    return text + " ".repeat(Math.max(0, width - displayWidth(text)));
}

type CloudTrip = CloudTripFile & { tripId: string; };

/**
 * One Drive file per trip id, read the way the app's rebind reads duplicates: the copy this
 * machine is bound to, else the newest (`listCloudTrips` orders by modifiedTime).
 */
function filePerTrip(files: CloudTripFile[]): Map<string, CloudTrip> {
    const records = loadTripSyncMap();
    const chosen = new Map<string, CloudTrip>();
    for (const file of files) {
        if (!file.tripId) continue;
        if (!chosen.has(file.tripId) || records[file.tripId]?.fileId === file.id) chosen.set(file.tripId, { ...file, tripId: file.tripId });
    }
    return chosen;
}

async function list(): Promise<void> {
    const files = await listCloudTrips(await accessToken());
    const trips = filePerTrip(files);
    const current = checkedOutTripId();
    const rows = files.map(file => {
        const trip = file.tripId ? trips.get(file.tripId) : undefined;
        return {
            mark: trip && trip.id !== file.id ? "!" : trip?.tripId === current ? "*" : trip && hasWorkingCopy(trip.tripId) ? "·" : " ",
            name: file.name,
            // Local time, since that is the clock the edit was made by.
            modified: new Date(file.modifiedTime).toLocaleString("sv-SE", { dateStyle: "short", timeStyle: "short" }),
            tripId: file.tripId ?? "-",
        };
    });
    const nameWidth = Math.max(displayWidth("行程"), ...rows.map(row => displayWidth(row.name)));
    const modifiedWidth = Math.max(displayWidth("更新時間"), ...rows.map(row => displayWidth(row.modified)));
    const account = loadGdriveUser();
    if (account) console.log(`${account.email} 的雲端行程：`);
    console.log(`  ${padDisplay("行程", nameWidth)}  ${padDisplay("更新時間", modifiedWidth)}  tripId`);
    for (const row of rows) {
        console.log(`${row.mark} ${padDisplay(row.name, nameWidth)}  ${padDisplay(row.modified, modifiedWidth)}  ${row.tripId}`);
    }
    console.log("（* 目前 checkout，· 本機有副本，! 同一趟行程的重複檔，checkout 不會用它）");
}

/*
 * Hex-only, so a Chinese name never reads as an id prefix. An English word that happens to
 * be hex (`cafe`, `2026`) still can; four characters keeps that rare while staying short
 * enough to read off `list` at a glance.
 */
const MIN_ID_PREFIX = 4;

/**
 * The one trip `query` names, trying the stages in order and stopping at the first that
 * matches anything. More than one match is refused rather than picked, at every stage —
 * two trips can share a name as easily as a prefix. Duplicate files of one trip count once,
 * as the file `filePerTrip` keeps, but any of their names still finds it: `list` shows them.
 */
function resolveTrip(files: CloudTripFile[], query: string): CloudTrip {
    const chosen = filePerTrip(files);
    const needle = query.toLowerCase();
    const stages = [
        (file: CloudTripFile) => file.tripId === query,
        (file: CloudTripFile) => file.name === query,
        (file: CloudTripFile) => query.length >= MIN_ID_PREFIX && /^[0-9a-f-]+$/i.test(query) && !!file.tripId?.startsWith(needle),
        (file: CloudTripFile) => file.name.toLowerCase().startsWith(needle),
        (file: CloudTripFile) => file.name.toLowerCase().includes(needle),
    ];
    for (const stage of stages) {
        const matched = files.filter(stage);
        if (matched.length === 0) continue;
        // Each trip under the name it was found by, which for a duplicate is not the kept file's.
        // A file without an id is a candidate too, one this cannot check out: dropping it would
        // let the stage pick another trip, or fall through to a looser one that does.
        const candidates = new Map<CloudTripFile, string>();
        for (const file of matched) {
            const trip = file.tripId ? chosen.get(file.tripId) : file;
            if (trip && !candidates.has(trip)) candidates.set(trip, file.name === trip.name ? file.name : `${file.name}（→ ${trip.name}）`);
        }
        const [match, ...others] = candidates.keys();
        if (others.length > 0) {
            const width = Math.max(...[...candidates.values()].map(displayWidth));
            throw new Error(`「${query}」對到 ${candidates.size} 份行程，再具體一點：\n${[...candidates].map(([trip, name]) => `  ${padDisplay(name, width)}  ${trip.tripId?.slice(0, 8) ?? "（沒有 tripId）"}`).join("\n")}`);
        }
        // The appProperty is written by an upload only, and a sync that finds nothing to send uploads nothing.
        if (!match?.tripId) throw new Error(`「${query}」對到的雲端檔沒有 tripId，CLI 認不出是哪趟行程：在 app 改一下這趟行程再同步，上傳時會補上`);
        return { ...match, tripId: match.tripId };
    }
    const shortId = query.length < MIN_ID_PREFIX && /^[0-9a-f-]+$/i.test(query);
    throw new Error(`雲端找不到「${query}」${shortId ? `（tripId 至少要打 ${MIN_ID_PREFIX} 碼）` : ""}，用 list 看有哪些`);
}

/** The trip `query` names, downloaded first when this machine holds no working copy of it. */
async function checkoutTarget(query: string): Promise<{ tripId: string; name: string; existed: boolean; }> {
    // A full id with a working copy needs nothing from Drive, so switching back to it works
    // offline. Matched by listing, not existsSync: macOS would find an id typed in the wrong case.
    if (isFileNameSafe(query) && existsSync(TRIPS_DIR) && readdirSync(TRIPS_DIR).includes(`${query}.yaml`)) {
        const yaml = readFileSync(tripPath(query), "utf8");
        // A copy saved mid-edit does not parse, and its trip name would read as the placeholder for none.
        return { tripId: query, name: tripIdFromYaml(yaml) ? tripNameFromYaml(yaml) : query, existed: true };
    }
    const token = await accessToken();
    const match = resolveTrip(await listCloudTrips(token), query);
    const path = tripPath(match.tripId);
    if (existsSync(path)) return { tripId: match.tripId, name: match.name, existed: true };
    const { yaml, remoteFile } = await fetchCloudTrip(token, match.id);
    mkdirSync(TRIPS_DIR, { recursive: true });
    writeFileSync(path, yaml);
    saveRecord(match.tripId, agreedRecord(match.id, yaml, remoteFile?.md5Checksum));
    console.log(`已從雲端下載「${match.name}」`);
    return { tripId: match.tripId, name: match.name, existed: false };
}

async function checkout(query: string): Promise<void> {
    // Before anything else: relinking would bury whatever the displaced file holds in a backup.
    const displaced = displacedLinkTripId();
    if (displaced && !linkMatchesWorkingCopy(displaced)) throw displacedLinkError(displaced);

    const { tripId, name, existed } = await checkoutTarget(query);
    // Any other regular file there may be the only copy of what it holds (one from before the
    // first checkout, say), so it goes to a backup before the link replaces it. Compared again
    // rather than trusting the check above: the download took long enough for a save to land.
    if (existsSync(LINK) && !lstatSync(LINK).isSymbolicLink() && !(displaced && linkMatchesWorkingCopy(displaced))) backup("itinerary.local", readFileSync(LINK, "utf8"));
    rmSync(LINK, { force: true });
    symlinkSync(relative(dirname(LINK), tripPath(tripId)), LINK);
    recordCheckout(tripId);
    console.log(`已切換到「${name}」：編輯 ${relative(ROOT, LINK)}${existed ? "（沿用本機副本，用 status 看跟雲端的差別）" : ""}`);
}

/** Why `push` would refuse the working copy, or null. */
function pushBlocker(tripId: string, yaml: string): string | null {
    // The phone lands whatever bytes it pulls, so this is the last gate before a broken file
    // reaches it. Ahead of the id check, which reads a syntax error as a missing trip.id.
    try {
        validateYaml(yaml);
    } catch (error) {
        return `YAML 驗證失敗：${error instanceof Error ? error.message : String(error)}`;
    }
    // The file name is the binding, so an edited trip.id would push one trip into another's file.
    const yamlTripId = tripIdFromYaml(yaml);
    if (!yamlTripId) return `trip.id 不見了，補回 id: ${tripId}`;
    if (yamlTripId !== tripId) return `trip.id 跟 checkout 的行程（${tripId}）不符`;
    return null;
}

async function status(): Promise<void> {
    const { tripId, yaml } = checkedOut();
    const blocker = pushBlocker(tripId, yaml);
    if (blocker) console.error(`push 會被擋：${blocker}`);
    const token = await accessToken();
    const plan = await planCloudSync(token, await recordFor(token, tripId, yaml), yaml);
    settle(tripId, plan);
    console.log(plan.remoteFile ? `${plan.remoteFile.name}：${describe(plan)}` : describe(plan));
}

/*
 * pull and push plan without `--force` first and pass it on only when that plan calls for
 * it. A forced pull overrides a conflict or this machine's own edits, which the backup
 * keeps; a forced push overrides a conflict only, since past a plain pull it would put this
 * machine's older copy over edits it never saw.
 */
async function pull(): Promise<void> {
    const { tripId, path, yaml: localYaml } = checkedOut();
    const token = await accessToken();
    const record = await recordFor(token, tripId, localYaml);
    let plan = await planCloudSync(token, record, localYaml);
    if (flags.force && (plan.decision === "conflict" || (plan.decision === "push" && plan.remoteFile))) {
        plan = await planCloudSync(token, record, localYaml, "remote") ?? plan;
    }
    if (plan.decision !== "pull") return report(tripId, plan, "pull");

    const { yaml, record: pulled } = await plan.pull();
    // Local trip files are gitignored, so an overwrite would otherwise be the only copy gone.
    backup(tripId, localYaml);
    writeFileSync(path, yaml);
    saveRecord(tripId, pulled);
    console.log(`已從雲端「${plan.remoteFile.name}」更新`);
}

async function push(): Promise<void> {
    const { tripId, yaml } = checkedOut();
    const blocker = pushBlocker(tripId, yaml);
    if (blocker) throw new Error(`沒有上傳：${blocker}`);
    const token = await accessToken();
    const record = await recordFor(token, tripId, yaml);
    let plan = await planCloudSync(token, record, yaml);
    const forced = flags.force && plan.decision === "conflict";
    if (forced) plan = await planCloudSync(token, record, yaml, "local");
    if (plan.decision !== "push") return report(tripId, plan, "push");

    // Undefined leaves the file's share-link properties in place: new ciphertext changes nothing they hold.
    const { file, record: pushed } = await plan.push(undefined);
    saveRecord(tripId, pushed);
    if (!plan.remoteFile) console.log(`已在雲端建立新檔「${file.name}」`);
    else console.log(`已上傳到雲端「${file.name}」${forced ? "（以本機版本為準；Drive 的版本記錄還留著舊版）" : ""}`);
    const link = plan.remoteFile?.shareLink;
    if (!link) return;
    // The app marks a link stale only for an edit made on that device, never for a version it
    // pulled, so skipping the update here would leave nothing to remind the owner.
    if (flags["no-share"]) console.log(`沒有更新分享連結（--no-share），連結上還是舊版本。${RESHARE_HINT}`);
    else await refreshShareLink(token, file.id, link, yaml);
}

const RESHARE_HINT = "要更新時，手機載入新版後到「工具 → 行程管理」按「更新分享連結」";

/** Replaces the ciphertext behind `link` with `yaml`, keeping its id and key, so the URL already handed out shows this version. */
async function refreshShareLink(token: string, fileId: string, link: ShareLinkRecord, yaml: string): Promise<void> {
    // A later push finds nothing to send and never gets here, so the message has to say the retry is the phone's.
    const failed = (reason: string) => {
        console.error(`雲端已經更新，但分享連結沒更新（重跑 push 不會再試）：${reason}`);
        process.exitCode = 1;
    };
    let payload: string;
    try {
        // The form the app shares, not the working copy's bytes.
        payload = await resealShareToken(serializeToYaml(validateYaml(yaml)), link.key);
    } catch {
        // A malformed key in the file's properties; the push itself has already landed.
        return failed("Drive 上記的連結資料不完整，要分享得回手機重新產生一條");
    }
    const updated = await updateHopBlob(link.id, link.editToken, payload, PERSISTENT_LINK_TTL_SECONDS);
    if (!updated.ok) {
        if (updated.reason === "network") return failed(`連不到 hop。${RESHARE_HINT}`);
        // hop's own answer, not a failure to reach it, so the link is dead for good. Where the
        // app would mint a replacement this leaves that to the phone (see the module comment),
        // but it does take the dead one off Drive, so later pushes stop failing here — until a
        // device that still holds it pushes it back, which only its next share can cure.
        const dropped = await clearDeadShareLink(token, fileId, link.id).catch(() => false);
        return failed(`hop 回報這條連結已經失效${dropped ? "，已從雲端拿掉" : ""}，要分享得回手機重新產生一條`);
    }
    const url = buildShortShareUrl(link.id, link.key, SITE_URL);
    console.log(url ? `分享連結已更新：${url}` : "分享連結已更新");
}

const USAGE = `用法：pnpm run trip:sync <指令> [選項]

指令：
  login                      用瀏覽器登入 Google
  list                       列出雲端行程（* 目前 checkout，· 本機有副本，! 重複檔）
  checkout <行程名|tripId>   切換到這份行程，本機沒有就先從雲端下載
                             （名稱可以只打開頭或關鍵字，tripId 可以只打前 4 碼）
  status                     比較目前行程和雲端，不傳任何東西
  pull [--force]             用雲端版本更新本機
  push [--force] [--no-share]
                             把本機版本上傳到雲端（先過 validateYaml），有分享連結就一起更新

選項：
  --force                    pull：捨棄本機的修改、改用雲端版本（會先備份）
                             push：兩邊都改過時以本機為準（只用來解衝突）
  --no-share                 push 時不更新分享連結
  -h, --help                 顯示這份說明`;

const CLI_OPTIONS = {
    allowPositionals: true,
    options: {
        "force": { type: "boolean", default: false },
        "no-share": { type: "boolean", default: false },
        "help": { type: "boolean", short: "h" },
    },
} as const;

function usageError(message: string): never {
    console.error(`${message}\n\n${USAGE}`);
    process.exit(1);
}

function parseCli() {
    try {
        return parseArgs(CLI_OPTIONS);
    } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        // Node quotes an option as '-h, --help' when it has a short alias.
        const quoted = /'([^']+)'/.exec(String(error))?.[1];
        const option = quoted?.match(/--[\w-]+/)?.[0] ?? quoted;
        if (option && code === "ERR_PARSE_ARGS_UNKNOWN_OPTION") return usageError(`沒有 ${option} 這個選項`);
        if (option && code === "ERR_PARSE_ARGS_INVALID_OPTION_VALUE") return usageError(`${option} 不接值`);
        return usageError(error instanceof Error ? error.message : String(error));
    }
}

/** An error's message, plus the cause Node's fetch keeps behind a bare "fetch failed". */
function describeError(error: unknown): string {
    if (!(error instanceof Error)) return String(error);
    // A host with both IPv4 and IPv6 addresses fails as an AggregateError with an empty message.
    const inner: unknown = error.cause instanceof AggregateError ? error.cause.errors[0] ?? error.cause : error.cause;
    const cause = inner instanceof Error ? inner.message || (inner as NodeJS.ErrnoException).code || "" : "";
    return cause && !error.message.includes(cause) ? `${error.message}（${cause}）` : error.message;
}

const COMMANDS: Record<string, { run: (arg: string) => Promise<void>; takesArg?: boolean; takesForce?: boolean; takesNoShare?: boolean; }> = {
    login: { run: login },
    list: { run: list },
    checkout: { run: checkout, takesArg: true },
    status: { run: status },
    pull: { run: pull, takesForce: true },
    push: { run: push, takesForce: true, takesNoShare: true },
};

const { positionals, values: flags } = parseCli();
const [name = "", ...args] = positionals;
if (flags.help || name === "help") {
    console.log(USAGE);
    process.exit(0);
}
const command = Object.hasOwn(COMMANDS, name) ? COMMANDS[name] : undefined;
if (!command) usageError(name ? `沒有「${name}」這個指令` : "少了指令");
// Refused rather than ignored: a stray word is usually a trip name that needed quotes, and
// a --force nothing reads was meant for another command. An empty argument (an unset shell
// variable) would prefix-match every trip.
if (command.takesArg && (args.length !== 1 || !args[0]?.trim())) usageError(`${name} 要接一個行程名或 tripId（名稱有空白就加引號）`);
if (!command.takesArg && args.length > 0) usageError(`${name} 不接參數`);
if (flags.force && !command.takesForce) usageError("--force 只能用在 pull / push");
if (flags["no-share"] && !command.takesNoShare) usageError("--no-share 只能用在 push");
// Node opens the localStorage file on first access and fails outright if its directory is
// missing. chmod rather than mkdir's mode, which applies only to a directory it creates:
// this one holds the refresh token and, in localStorage, a live access token.
mkdirSync(SYNC_DIR, { recursive: true });
chmodSync(SYNC_DIR, 0o700);
await command.run(args[0] ?? "").catch((error: unknown) => {
    console.error(describeError(error));
    process.exit(1);
});
