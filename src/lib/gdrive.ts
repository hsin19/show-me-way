export const GDRIVE_USER_STORAGE = "showmeway_gdrive_user";
const GDRIVE_TOKEN_STORAGE = "showmeway_gdrive_token";
/** @public */
export const GDRIVE_AUTO_SYNC_STORAGE = "showmeway_gdrive_auto_sync";
/** @public */
export const GDRIVE_FOLDER_ID_STORAGE = "showmeway_gdrive_folder_id";
/** @public */
export const GDRIVE_FILE_MAP_STORAGE = "showmeway_gdrive_file_map";

export const GDRIVE_FOLDER_NAME = "ShowMeWay";
/** @public */
export const GDRIVE_OAUTH_SCOPES = [
    "https://www.googleapis.com/auth/drive.file",
    "https://www.googleapis.com/auth/userinfo.email",
    "https://www.googleapis.com/auth/userinfo.profile",
].join(" ");

export interface GoogleUser {
    email: string;
    name: string;
    picture?: string;
}

export interface CloudTripFile {
    id: string;
    name: string;
    modifiedTime: string;
    size?: number;
    tripId?: string;
}

/** @public */
export type FileMap = Record<string, string>; // tripId -> fileId

const FALLBACK_CLIENT_ID = "849908319136-che7nc9nag6ua5gd3fipk9evme4ngjde.apps.googleusercontent.com";

export function getGdriveClientId(): string {
    const id = (typeof import.meta !== "undefined" && import.meta.env?.VITE_GOOGLE_CLIENT_ID) as string | undefined;
    if (id && id.trim()) return id.trim();
    return FALLBACK_CLIENT_ID;
}

export function loadGdriveUser(): GoogleUser | null {
    try {
        const raw = localStorage.getItem(GDRIVE_USER_STORAGE);
        if (!raw) return null;
        const parsed: unknown = JSON.parse(raw);
        if (
            parsed
            && typeof parsed === "object"
            && "email" in parsed
            && "name" in parsed
            && typeof (parsed as GoogleUser).email === "string"
            && typeof (parsed as GoogleUser).name === "string"
        ) {
            return parsed as GoogleUser;
        }
        return null;
    } catch {
        return null;
    }
}

export function saveGdriveUser(user: GoogleUser): void {
    try {
        localStorage.setItem(GDRIVE_USER_STORAGE, JSON.stringify(user));
    } catch (e) {
        console.warn("Failed to save Google Drive User", e);
    }
}

export function clearGdriveUser(): void {
    try {
        localStorage.removeItem(GDRIVE_USER_STORAGE);
    } catch (e) {
        console.warn("Failed to clear Google Drive User", e);
    }
}

export function loadGdriveAutoSync(): boolean {
    try {
        return localStorage.getItem(GDRIVE_AUTO_SYNC_STORAGE) === "true";
    } catch {
        return false;
    }
}

export function saveGdriveAutoSync(enabled: boolean): void {
    try {
        localStorage.setItem(GDRIVE_AUTO_SYNC_STORAGE, enabled ? "true" : "false");
    } catch (e) {
        console.warn("Failed to save Google Drive Auto Sync", e);
    }
}

/** @public */
export function loadGdriveFolderId(): string | null {
    try {
        return localStorage.getItem(GDRIVE_FOLDER_ID_STORAGE);
    } catch {
        return null;
    }
}

/** @public */
export function saveGdriveFolderId(folderId: string): void {
    try {
        localStorage.setItem(GDRIVE_FOLDER_ID_STORAGE, folderId);
    } catch (e) {
        console.warn("Failed to save Google Drive Folder ID", e);
    }
}

/** @public */
export function loadGdriveFileMap(): FileMap {
    try {
        const raw = localStorage.getItem(GDRIVE_FILE_MAP_STORAGE);
        if (!raw) return {};
        const parsed: unknown = JSON.parse(raw);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            return parsed as FileMap;
        }
        return {};
    } catch {
        return {};
    }
}

/** @public */
export function saveGdriveFileMap(map: FileMap): void {
    try {
        localStorage.setItem(GDRIVE_FILE_MAP_STORAGE, JSON.stringify(map));
    } catch (e) {
        console.warn("Failed to save Google Drive File Map", e);
    }
}

export function getCloudFileIdForTrip(tripId: string): string | null {
    const map = loadGdriveFileMap();
    return map[tripId] ?? null;
}

export function setCloudFileIdForTrip(tripId: string, fileId: string): void {
    const map = loadGdriveFileMap();
    map[tripId] = fileId;
    saveGdriveFileMap(map);
}

export function removeCloudFileIdForTrip(tripId: string): void {
    const map = loadGdriveFileMap();
    if (map[tripId]) {
        delete map[tripId];
        saveGdriveFileMap(map);
    }
}

const GDRIVE_LOCAL_MODIFIED_PREFIX = "showmeway_gdrive_mod_";

export function getTripLocalModifiedTime(tripId: string): number {
    try {
        const val = localStorage.getItem(`${GDRIVE_LOCAL_MODIFIED_PREFIX}${tripId}`);
        if (val) {
            const num = Number(val);
            if (!isNaN(num) && num > 0) return num;
        }
    } catch {
        // ignore
    }
    return 0;
}

export function setTripLocalModifiedTime(tripId: string, timestamp?: number): void {
    try {
        localStorage.setItem(`${GDRIVE_LOCAL_MODIFIED_PREFIX}${tripId}`, String(timestamp ?? Date.now()));
    } catch (e) {
        console.warn("Failed to set local trip modified time", e);
    }
}

interface CachedTokenData {
    token: string;
    expiresAt: number;
}

export function getCachedAccessToken(): string | null {
    try {
        const raw = localStorage.getItem(GDRIVE_TOKEN_STORAGE);
        if (!raw) return null;
        const data: unknown = JSON.parse(raw);
        if (
            data
            && typeof data === "object"
            && "token" in data
            && "expiresAt" in data
            && typeof (data as CachedTokenData).token === "string"
            && typeof (data as CachedTokenData).expiresAt === "number"
        ) {
            const cached = data as CachedTokenData;
            // 60-second buffer before actual token expiration
            if (Date.now() < cached.expiresAt - 60000) {
                return cached.token;
            }
        }
        return null;
    } catch {
        return null;
    }
}

export function setCachedAccessToken(token: string, expiresInSeconds: number): void {
    try {
        const data: CachedTokenData = {
            token,
            expiresAt: Date.now() + expiresInSeconds * 1000,
        };
        localStorage.setItem(GDRIVE_TOKEN_STORAGE, JSON.stringify(data));
    } catch (e) {
        console.warn("Failed to cache Google Drive Token", e);
    }
}

export function clearCachedAccessToken(): void {
    try {
        localStorage.removeItem(GDRIVE_TOKEN_STORAGE);
    } catch (e) {
        console.warn("Failed to clear Google Drive Token", e);
    }
}

/** Dynamic loader for Google Identity Services SDK */
/** @public */
export function loadGisScript(): Promise<void> {
    if (typeof window === "undefined") return Promise.resolve();
    if (typeof (window as unknown as { google?: { accounts?: { oauth2?: unknown; }; }; }).google?.accounts?.oauth2 !== "undefined") {
        return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
        const existing = document.querySelector('script[src="https://accounts.google.com/gsi/client"]');
        if (existing) {
            existing.addEventListener("load", () => resolve());
            existing.addEventListener("error", () => reject(new Error("無法載入 Google 登入模組")));
            return;
        }
        const script = document.createElement("script");
        script.src = "https://accounts.google.com/gsi/client";
        script.async = true;
        script.defer = true;
        script.onload = () => resolve();
        script.onerror = () => reject(new Error("無法載入 Google 登入模組，請檢查網路連線"));
        document.head.appendChild(script);
    });
}

interface TokenResponse {
    access_token?: string;
    expires_in?: number;
    error?: string;
    error_description?: string;
}

/** Request OAuth access token using Google Identity Services */
export async function requestGoogleAccessToken(
    clientId: string,
    prompt: "" | "consent" = "",
): Promise<{ token: string; expiresIn: number; }> {
    const cached = getCachedAccessToken();
    if (cached && prompt !== "consent") {
        return { token: cached, expiresIn: 3600 };
    }

    await loadGisScript();

    const google = (window as unknown as {
        google?: {
            accounts?: {
                oauth2?: {
                    initTokenClient: (config: {
                        client_id: string;
                        scope: string;
                        prompt?: string;
                        callback: (resp: TokenResponse) => void;
                        error_callback?: (err: unknown) => void;
                    }) => { requestAccessToken: (opts?: { prompt?: string; }) => void; };
                };
            };
        };
    }).google;

    if (!google?.accounts?.oauth2) {
        throw new Error("Google Identity Services 未正確初始化");
    }

    return new Promise((resolve, reject) => {
        try {
            const client = google.accounts!.oauth2!.initTokenClient({
                client_id: clientId,
                scope: GDRIVE_OAUTH_SCOPES,
                prompt,
                callback: (resp: TokenResponse) => {
                    if (resp.error) {
                        reject(new Error(`Google 登入失敗: ${resp.error_description || resp.error}`));
                        return;
                    }
                    if (!resp.access_token) {
                        reject(new Error("Google 登入未回傳有效 Token"));
                        return;
                    }
                    const expiresIn = resp.expires_in ?? 3599;
                    setCachedAccessToken(resp.access_token, expiresIn);
                    resolve({ token: resp.access_token, expiresIn });
                },
                error_callback: (err: unknown) => {
                    reject(new Error(`Google 登入發生錯誤: ${String(err)}`));
                },
            });

            client.requestAccessToken({ prompt });
        } catch (e) {
            reject(e instanceof Error ? e : new Error(String(e)));
        }
    });
}

/** Fetch user profile info using the access token */
export async function fetchGoogleUserInfo(token: string): Promise<GoogleUser> {
    const res = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
        headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
        throw new Error(`無法取得 Google 使用者資訊 (${res.status})`);
    }
    const data = await res.json() as { email?: string; name?: string; picture?: string; };
    if (!data.email) {
        throw new Error("取得 Google 帳號失敗：未包含 Email 資訊");
    }
    return {
        email: data.email,
        name: data.name || data.email.split("@")[0],
        picture: data.picture,
    };
}

/** Find or create the dedicated ShowMeWay folder in Google Drive */
export async function findOrCreateAppFolder(token: string): Promise<string> {
    const cachedFolderId = loadGdriveFolderId();
    if (cachedFolderId) {
        // Verify it exists
        try {
            const checkRes = await fetch(`https://www.googleapis.com/drive/v3/files/${cachedFolderId}?fields=id,trashed`, {
                headers: { Authorization: `Bearer ${token}` },
            });
            if (checkRes.ok) {
                const folderData = await checkRes.json() as { id?: string; trashed?: boolean; };
                if (folderData.id && !folderData.trashed) {
                    return folderData.id;
                }
            }
        } catch {
            // Re-search below
        }
    }

    // Query folder
    const query = `name = '${GDRIVE_FOLDER_NAME}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
    const searchRes = await fetch(
        `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=files(id,name)&spaces=drive`,
        { headers: { Authorization: `Bearer ${token}` } },
    );

    if (searchRes.ok) {
        const searchData = await searchRes.json() as { files?: { id: string; }[]; };
        if (Array.isArray(searchData.files) && searchData.files.length > 0) {
            const folderId = searchData.files[0].id;
            saveGdriveFolderId(folderId);
            return folderId;
        }
    }

    // Create folder
    const createRes = await fetch("https://www.googleapis.com/drive/v3/files", {
        method: "POST",
        headers: {
            "Authorization": `Bearer ${token}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            name: GDRIVE_FOLDER_NAME,
            mimeType: "application/vnd.google-apps.folder",
        }),
    });

    if (!createRes.ok) {
        throw new Error(`無法在 Google Drive 建立 ${GDRIVE_FOLDER_NAME} 資料夾 (${createRes.status})`);
    }

    const created = await createRes.json() as { id: string; };
    saveGdriveFolderId(created.id);
    return created.id;
}

interface RawDriveFile {
    id?: string;
    name?: string;
    modifiedTime?: string;
    size?: string;
    appProperties?: { showmewayTripId?: string; };
}

/** List all trip files stored in the ShowMeWay Google Drive folder */
export async function listCloudTrips(token: string, folderId?: string): Promise<CloudTripFile[]> {
    const parentFolderId = folderId || await findOrCreateAppFolder(token);
    const query = `'${parentFolderId}' in parents and trashed = false and mimeType != 'application/vnd.google-apps.folder'`;
    const url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=files(id,name,modifiedTime,size,appProperties)&orderBy=modifiedTime+desc`;

    const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
    });

    if (!res.ok) {
        throw new Error(`無法讀取 Google Drive 行程列表 (${res.status})`);
    }

    const data = await res.json() as { files?: RawDriveFile[]; };
    if (!Array.isArray(data.files)) return [];

    return data.files
        .filter((f): f is RawDriveFile & { id: string; name: string; modifiedTime: string; } => typeof f.id === "string" && typeof f.name === "string" && typeof f.modifiedTime === "string")
        .map(f => ({
            id: f.id,
            name: f.name.replace(/\.ya?ml$/i, ""),
            modifiedTime: f.modifiedTime,
            size: f.size ? parseInt(f.size, 10) : undefined,
            tripId: f.appProperties?.showmewayTripId,
        }));
}

function buildMultipartBody(boundary: string, metadata: Record<string, unknown>, content: string): string {
    return [
        `--${boundary}`,
        "Content-Type: application/json; charset=UTF-8",
        "",
        JSON.stringify(metadata),
        `--${boundary}`,
        "Content-Type: text/yaml; charset=UTF-8",
        "",
        content,
        `--${boundary}--`,
    ].join("\r\n");
}

/** Upload a new trip or update an existing one in Google Drive */
export async function uploadOrUpdateCloudTrip(
    token: string,
    tripName: string,
    yamlContent: string,
    options: { fileId?: string; tripId?: string; folderId?: string; } = {},
): Promise<CloudTripFile> {
    const boundary = `-------ShowMeWayBoundary${Date.now()}`;
    const fileName = `${tripName.trim() || "未命名行程"}.yaml`;

    const appProperties: Record<string, string> = {
        updatedAt: new Date().toISOString(),
    };
    if (options.tripId) {
        appProperties.showmewayTripId = options.tripId;
    }

    if (options.fileId) {
        // Update existing file
        const metadata = {
            name: fileName,
            appProperties,
        };
        const body = buildMultipartBody(boundary, metadata, yamlContent);

        const res = await fetch(`https://www.googleapis.com/upload/drive/v3/files/${options.fileId}?uploadType=multipart&fields=id,name,modifiedTime,size,appProperties`, {
            method: "PATCH",
            headers: {
                "Authorization": `Bearer ${token}`,
                "Content-Type": `multipart/related; boundary=${boundary}`,
            },
            body,
        });

        if (!res.ok) {
            throw new Error(`無法更新 Google Drive 行程檔案 (${res.status})`);
        }

        const data = await res.json() as RawDriveFile;
        if (options.tripId && data.id) {
            setCloudFileIdForTrip(options.tripId, data.id);
        }
        return {
            id: data.id!,
            name: (data.name || fileName).replace(/\.ya?ml$/i, ""),
            modifiedTime: data.modifiedTime || new Date().toISOString(),
            tripId: options.tripId,
        };
    } else {
        // Create new file in folder
        const parentFolderId = options.folderId || await findOrCreateAppFolder(token);
        const metadata = {
            name: fileName,
            parents: [parentFolderId],
            mimeType: "text/yaml",
            appProperties,
        };
        const body = buildMultipartBody(boundary, metadata, yamlContent);

        const res = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,modifiedTime,size,appProperties", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${token}`,
                "Content-Type": `multipart/related; boundary=${boundary}`,
            },
            body,
        });

        if (!res.ok) {
            throw new Error(`無法上傳行程至 Google Drive (${res.status})`);
        }

        const data = await res.json() as RawDriveFile;
        if (options.tripId && data.id) {
            setCloudFileIdForTrip(options.tripId, data.id);
        }
        return {
            id: data.id!,
            name: (data.name || fileName).replace(/\.ya?ml$/i, ""),
            modifiedTime: data.modifiedTime || new Date().toISOString(),
            tripId: options.tripId,
        };
    }
}

/** Download YAML content from a Google Drive file */
export async function downloadCloudTripYaml(token: string, fileId: string): Promise<string> {
    const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
        headers: { Authorization: `Bearer ${token}` },
    });

    if (!res.ok) {
        throw new Error(`無法下載 Google Drive 檔案 (${res.status})`);
    }

    return await res.text();
}

/** Delete a file in Google Drive */
export async function deleteCloudTrip(token: string, fileId: string): Promise<void> {
    const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
    });

    if (!res.ok && res.status !== 404) {
        throw new Error(`無法刪除 Google Drive 檔案 (${res.status})`);
    }
}
