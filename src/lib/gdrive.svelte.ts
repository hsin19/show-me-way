import {
    clearCachedAccessToken,
    clearGdriveUser,
    type CloudTripFile,
    deleteCloudTrip,
    downloadCloudTripYaml,
    fetchGoogleUserInfo,
    getCachedAccessToken,
    getCloudFileIdForTrip,
    getGdriveClientId,
    type GoogleUser,
    listCloudTrips,
    loadGdriveAutoSync,
    loadGdriveUser,
    requestGoogleAccessToken,
    saveGdriveAutoSync,
    saveGdriveUser,
    uploadOrUpdateCloudTrip,
} from "./gdrive";
import { showToast } from "./toast.svelte";

class GDriveSyncState {
    user = $state<GoogleUser | null>(loadGdriveUser());
    autoSync = $state<boolean>(loadGdriveAutoSync());
    isSyncing = $state<boolean>(false);
    isConnecting = $state<boolean>(false);
    lastSyncedAt = $state<string | null>(null);
    error = $state<string | null>(null);
    cloudFiles = $state<CloudTripFile[]>([]);

    clientId = $derived<string>(getGdriveClientId());
    isConnected = $derived<boolean>(!!this.user);

    setAutoSync(enabled: boolean) {
        this.autoSync = enabled;
        saveGdriveAutoSync(enabled);
    }

    async getValidToken(interactive = true): Promise<string> {
        if (!this.clientId) {
            throw new Error("請先在 App 設定中填入 Google OAuth Client ID");
        }
        const cached = getCachedAccessToken();
        if (cached) return cached;

        if (!interactive) {
            throw new Error("尚未登入 Google 或登入憑證已過期");
        }

        const res = await requestGoogleAccessToken(this.clientId, "");
        return res.token;
    }

    async connect(): Promise<boolean> {
        if (!this.clientId) {
            this.error = "請先設定 Google Client ID";
            return false;
        }
        this.isConnecting = true;
        this.error = null;
        try {
            const { token } = await requestGoogleAccessToken(this.clientId, "consent");
            const userInfo = await fetchGoogleUserInfo(token);
            saveGdriveUser(userInfo);
            this.user = userInfo;
            showToast(`Google 雲端硬碟已連線 (${userInfo.email})`);
            void this.refreshFiles();
            return true;
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.error("Google connect failed:", err);
            this.error = msg;
            showToast(`連線失敗: ${msg}`);
            return false;
        } finally {
            this.isConnecting = false;
        }
    }

    disconnect() {
        clearGdriveUser();
        clearCachedAccessToken();
        this.user = null;
        this.cloudFiles = [];
        this.lastSyncedAt = null;
        this.error = null;
        showToast("已取消 Google 雲端硬碟連線");
    }

    async refreshFiles(): Promise<CloudTripFile[]> {
        if (!this.isConnected) return [];
        this.isSyncing = true;
        this.error = null;
        try {
            const token = await this.getValidToken(false);
            const files = await listCloudTrips(token);
            this.cloudFiles = files;
            return files;
        } catch (err) {
            console.warn("Refresh cloud files failed:", err);
            // Don't show toast on background silent failure unless user initiated
            return [];
        } finally {
            this.isSyncing = false;
        }
    }

    async syncTrip(
        tripName: string,
        yamlContent: string,
        tripId?: string,
        showFeedback = true,
    ): Promise<CloudTripFile | null> {
        if (!this.isConnected) return null;
        this.isSyncing = true;
        this.error = null;
        try {
            const token = await this.getValidToken(true);
            const fileId = tripId ? getCloudFileIdForTrip(tripId) ?? undefined : undefined;
            const res = await uploadOrUpdateCloudTrip(token, tripName, yamlContent, { fileId, tripId });
            this.lastSyncedAt = new Date().toISOString();
            if (showFeedback) {
                showToast(`已同步「${res.name}」到 Google Drive`);
            }
            void this.refreshFiles();
            return res;
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            this.error = msg;
            if (showFeedback) {
                showToast(`雲端同步失敗: ${msg}`);
            }
            return null;
        } finally {
            this.isSyncing = false;
        }
    }

    async loadTripYaml(fileId: string): Promise<string | null> {
        this.isSyncing = true;
        this.error = null;
        try {
            const token = await this.getValidToken(true);
            const yaml = await downloadCloudTripYaml(token, fileId);
            return yaml;
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            this.error = msg;
            showToast(`下載雲端行程失敗: ${msg}`);
            return null;
        } finally {
            this.isSyncing = false;
        }
    }

    async deleteTrip(fileId: string): Promise<boolean> {
        this.isSyncing = true;
        this.error = null;
        try {
            const token = await this.getValidToken(true);
            await deleteCloudTrip(token, fileId);
            showToast("已從 Google Drive 刪除行程");
            void this.refreshFiles();
            return true;
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            this.error = msg;
            showToast(`刪除失敗: ${msg}`);
            return false;
        } finally {
            this.isSyncing = false;
        }
    }
}

export const gdriveSync = new GDriveSyncState();
