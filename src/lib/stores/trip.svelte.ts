import {
    buildLedgerCsv,
    parseLegacyExpenses,
} from "$lib/domain/ledger";
import { getLanguageConfig } from "$lib/domain/phrases";
import {
    buildShareUrl,
    buildShortShareUrl,
    clearShareHash,
    isShareSupported,
    readShareLinkFromHash,
    ShareLinkError,
} from "$lib/domain/share";
import {
    isEncryptedShareSupported,
    sealShareToken,
} from "$lib/domain/share-crypto";
import { buildDayReport } from "$lib/domain/timeline";
import {
    createChecklistItemId,
    createExpenseId,
    type DayItinerary,
    genTripId,
    serializeToYaml,
    type TripData,
    validateYaml,
} from "$lib/domain/trip";
import {
    insertAtClamped,
    toLocalIsoDate,
} from "$lib/domain/utils";
import { migrateGdriveSyncState } from "$lib/infra/http/gdrive";
import { createHopBlob } from "$lib/infra/http/hop";
import {
    fetchDefaultYamlText,
    fetchItinerary,
} from "$lib/infra/http/itinerary-loader";
import { resolveShareLink } from "$lib/infra/http/share-link";
import { downloadTextFile } from "$lib/infra/pwa/file-download";
import {
    createProfile,
    deleteProfile,
    ensureActiveProfileId,
    isActiveProfile,
    listProfiles,
    type ProfileInfo,
    switchToProfile,
    tripIdFromYaml,
} from "$lib/infra/storage/profiles";
import { importSharedTrip } from "$lib/infra/storage/share-import";
import {
    backupCurrentYaml,
    saveTripData,
    USER_YAML_KEY,
} from "$lib/infra/storage/yaml-storage";
import { SvelteDate } from "svelte/reactivity";
import { gdriveSync } from "./gdrive.svelte";
import { settingsDraft } from "./settings-draft.svelte";
import {
    shareOrCopyToClipboard,
    showToast,
} from "./toast.svelte";
import { weatherStore } from "./weather.svelte";

function exportDateStamp(): string {
    return toLocalIsoDate(new SvelteDate()).replaceAll("-", "");
}

// Older versions kept checked-state in its own localStorage keys. Runs once —
// the keys are removed on the way out — and reports whether a save is owed.
function migrateLegacyChecklistState(data: TripData): boolean {
    let migrated = false;
    const legacy: Array<["todo" | "packing", string]> = [
        ["todo", "todo_state"],
        ["packing", "packing_state"],
    ];
    for (const [listKey, storageKey] of legacy) {
        const saved = localStorage.getItem(storageKey);
        if (!saved) continue;
        try {
            const map = JSON.parse(saved) as Record<string, boolean>;
            for (const item of data[listKey]) {
                const legacyId = (item as { id?: string; }).id;
                if (legacyId && legacyId in map) item.checked = map[legacyId];
            }
            migrated = true;
        } catch (e) {
            console.error("Failed to migrate legacy checklist state:", e);
        }
        localStorage.removeItem(storageKey);
    }
    return migrated;
}

// Older versions kept expense records in their own localStorage key; in the YAML
// they travel with the trip profile instead. Runs once — the key is removed on
// the way out — and reports whether a save is owed.
function migrateLegacyLedger(data: TripData): boolean {
    const saved = localStorage.getItem("ledger_expenses");
    if (saved === null) return false;
    try {
        const parsed: unknown = JSON.parse(saved);
        if (data.expenses.length === 0) {
            data.expenses.push(...parseLegacyExpenses(parsed, toLocalIsoDate(new SvelteDate()), createExpenseId));
        }
    } catch (e) {
        console.error("Failed to migrate legacy ledger:", e);
    }
    localStorage.removeItem("ledger_expenses");
    return true;
}

/**
 * Prefer the short link, fall back to the inline one. Sharing must never fail
 * outright just because hop is unreachable: a several-thousand-character link still
 * works everywhere, it just cannot become a QR code.
 */
async function buildBestShareUrl(yaml: string): Promise<{ url: string; short: boolean; }> {
    if (isEncryptedShareSupported()) {
        const sealed = await sealShareToken(yaml);
        const created = await createHopBlob(sealed.payload);
        // The key is joined to the id here and nowhere else — it was never sent to hop.
        // Null means hop handed back an id no receiver would parse; the blob is
        // orphaned, but the inline link below still gets the trip across.
        const url = created.ok ? buildShortShareUrl(created.id, sealed.key) : null;
        if (url) return { url, short: true };
    }
    return { url: await buildShareUrl(yaml), short: false };
}

const UPLOADED_NOTE = "行程已加密上傳，分享連結 90 天內有效";

export class TripStore {
    data = $state<TripData | null>(null);
    isLoading = $state(true);
    loadError = $state<string | null>(null);
    profiles = $state<ProfileInfo[]>([]);
    /** Drives the loading copy: a scanned QR spends this time on the app's first screen. */
    sharedLinkLoading = $state(false);
    /** True while a share link is being built — a hop round trip, so the buttons disable on it. */
    isSharing = $state(false);

    prepDone = $derived(this.data ? [...this.data.todo, ...this.data.packing].filter(i => i.checked).length : 0);
    prepTotal = $derived(this.data ? this.data.todo.length + this.data.packing.length : 0);
    langConfig = $derived(getLanguageConfig(this.data?.trip.lang));

    /**
     * Remove `id` from a `_id`-keyed list, persist, and offer an undo toast that
     * reinserts it — reading the list fresh via `getList` both times.
     */
    private deleteWithUndo<T extends { _id?: string; }>(
        getList: () => T[] | null,
        setList: (next: T[]) => void,
        id: string,
        toastMessage: (removed: T) => string,
    ) {
        const list = getList();
        if (!list) return;
        const index = list.findIndex(i => i._id === id);
        if (index < 0) return;
        const removed = { ...list[index] };
        setList(list.filter(i => i._id !== id));
        this.persist();
        const profileIdAtDelete = ensureActiveProfileId();
        showToast({
            message: toastMessage(removed),
            actionLabel: "復原",
            onAction: () => {
                if (!isActiveProfile(profileIdAtDelete)) {
                    showToast("行程已切換，無法復原");
                    return;
                }
                const current = getList();
                if (!current) return;
                setList(insertAtClamped(current, index, removed));
                this.persist();
            },
        });
    }

    async load(): Promise<void> {
        settingsDraft.yaml = null;
        this.isLoading = true;
        this.loadError = null;
        try {
            const data = await fetchItinerary();
            this.data = data;
            ensureActiveProfileId();
            this.profiles = listProfiles();
            weatherStore.loadTrip(data.days, data.trip.city);

            migrateGdriveSyncState();
            let migrated = migrateLegacyChecklistState(data);
            if (migrateLegacyLedger(data)) migrated = true;
            const storedYaml = localStorage.getItem(USER_YAML_KEY);
            if (storedYaml !== null && tripIdFromYaml(storedYaml) !== data.trip.id) migrated = true;
            if (migrated) this.persist();
        } catch (err) {
            console.error("Failed to load trip data:", err);
            this.loadError = "無法載入或解析行程資料。請開啟設定確認 YAML 語法。";
        } finally {
            this.isLoading = false;
        }
    }

    persist(): boolean {
        if (!this.data) return false;
        try {
            const yaml = serializeToYaml(this.data);
            saveTripData(this.data, yaml);
            const activeId = ensureActiveProfileId();
            gdriveSync.scheduleSync(yaml, activeId);
            return true;
        } catch (err) {
            console.error("Failed to persist trip data:", err);
            showToast("儲存失敗，請稍後再試");
            return false;
        }
    }

    async maybeImportSharedItinerary(): Promise<void> {
        const link = readShareLinkFromHash();
        if (!link) return;

        let yaml: string;
        try {
            this.sharedLinkLoading = link.kind === "short";
            yaml = await resolveShareLink(link);
        } catch (err) {
            if (err instanceof ShareLinkError && err.retryable) {
                // The address bar holds the only copy of the decryption key on this
                // device, so a retryable failure must leave the hash alone. Clearing
                // it here would destroy the link the user just scanned.
                showToast(err.message);
                return;
            }
            console.error("Failed to read shared itinerary:", err);
            showToast(err instanceof ShareLinkError ? err.message : "分享連結內容無效，已略過");
            clearShareHash();
            return;
        } finally {
            this.sharedLinkLoading = false;
        }

        try {
            const outcome = importSharedTrip(validateYaml(yaml));
            if (outcome.kind === "overwritten") showToast("已用分享連結更新行程，可在行程管理還原前一版");
            else if (outcome.kind === "imported") showToast("已匯入分享的行程");
        } catch (err) {
            console.error("Failed to import shared itinerary:", err);
            showToast("分享連結內容無效，已略過");
        } finally {
            clearShareHash();
        }
    }

    toggleChecklistItem(list: "todo" | "packing", id: string) {
        if (!this.data) return;
        const item = this.data[list].find(i => i._id === id);
        if (!item) return;
        item.checked = !item.checked;
        this.persist();
    }

    addChecklistItem(list: "todo" | "packing", text: string) {
        if (!this.data) return;
        this.data[list].push({
            _id: createChecklistItemId(list === "todo" ? "todo" : "pack"),
            text,
            checked: false,
        });
        this.persist();
    }

    deleteChecklistItem(list: "todo" | "packing", id: string) {
        this.deleteWithUndo(
            () => this.data?.[list] ?? null,
            next => {
                if (this.data) this.data[list] = next;
            },
            id,
            removed => {
                const text = removed.text ?? "";
                const label = text.length > 10 ? `${text.slice(0, 10)}…` : text;
                return `已刪除「${label}」`;
            },
        );
    }

    setEventStatus(id: string, nextStatus: "done" | "skipped" | undefined) {
        if (!this.data) return;
        for (const day of this.data.days) {
            const event = day.timeline.find(e => e._id === id);
            if (!event) continue;
            if (nextStatus === undefined) delete event.status;
            else event.status = nextStatus;
            this.persist();
            return;
        }
    }

    addTripWallet(name: string) {
        if (!this.data) return;
        if (!this.data.trip.wallets) {
            this.data.trip.wallets = [];
        }
        if (!this.data.trip.wallets.includes(name)) {
            this.data.trip.wallets.push(name);
            this.persist();
        }
    }

    addExpense(name: string, amount: number, type: string, date?: string) {
        if (!this.data) return;
        this.data.expenses.unshift({
            _id: createExpenseId(),
            name,
            amount,
            type,
            date: date || toLocalIsoDate(new SvelteDate()),
        });
        this.persist();
    }

    deleteExpense(id: string) {
        this.deleteWithUndo(
            () => this.data?.expenses ?? null,
            next => {
                if (this.data) this.data.expenses = next;
            },
            id,
            () => "紀錄已刪除",
        );
    }

    resetLedger() {
        if (!this.data) return;
        this.data.expenses = [];
        this.persist();
    }

    applyAiEdit(yaml: string): boolean {
        let parsed: TripData;
        try {
            parsed = validateYaml(yaml);
        } catch (err) {
            console.error("Failed to apply AI edit:", err);
            showToast("AI 的修改內容無效，已略過");
            return false;
        }
        if (this.data) parsed.trip.id = this.data.trip.id;
        const previousYaml = localStorage.getItem(USER_YAML_KEY);
        const profileIdAtEdit = ensureActiveProfileId();
        backupCurrentYaml();
        this.data = parsed;
        this.persist();
        weatherStore.loadTrip(parsed.days, parsed.trip.city);
        if (previousYaml) {
            showToast({
                message: "已套用 AI 修改的行程",
                actionLabel: "復原",
                onAction: () => {
                    if (!isActiveProfile(profileIdAtEdit)) {
                        showToast("行程已切換，無法復原");
                        return;
                    }
                    let restored: TripData;
                    try {
                        restored = validateYaml(previousYaml);
                    } catch (err) {
                        console.error("Failed to undo AI edit:", err);
                        showToast("復原失敗，可到行程管理還原備份");
                        return;
                    }
                    backupCurrentYaml();
                    this.data = restored;
                    this.persist();
                    weatherStore.loadTrip(restored.days, restored.trip.city);
                    showToast("已復原為套用前的行程");
                },
            });
        } else {
            showToast("已套用 AI 修改的行程");
        }
        return true;
    }

    async shareCurrentTrip() {
        if (!this.data || this.isSharing) return;
        if (!isShareSupported()) {
            showToast("此瀏覽器不支援連結壓縮，無法產生分享連結");
            return;
        }
        this.isSharing = true;
        try {
            // expenses stripped: this link is for whoever it reaches. exportTripUrl
            // makes the opposite choice for a link the user sends to themselves, and
            // the two are deliberately not deduped.
            const { url, short } = await buildBestShareUrl(serializeToYaml({ ...this.data, expenses: [] }));
            // Say the upload happened, on both the clipboard and the share-sheet path.
            // This button reached no server before, and the privacy policy promises
            // the user is told when data leaves the device.
            const copyMsg = short
                ? `分享連結已複製！${UPLOADED_NOTE}，可直接做成 QR code`
                : "分享連結已複製！網址較長，可用短網址服務縮短";
            await shareOrCopyToClipboard({ url }, url, copyMsg, short ? UPLOADED_NOTE : undefined);
        } catch (err) {
            console.error("Failed to build share link:", err);
            showToast("無法產生分享連結，請稍後再試");
        } finally {
            this.isSharing = false;
        }
    }

    async shareDayReport(dayData: DayItinerary) {
        if (!this.data) return;
        const text = buildDayReport(dayData, this.data.trip.hotels, this.data.trip.name);
        await shareOrCopyToClipboard({ text }, text, "已複製今日行程，可直接貼上分享");
    }

    exportTripYaml() {
        if (!this.data) {
            showToast("目前沒有可匯出的行程");
            return;
        }
        try {
            downloadTextFile(`show-me-way-行程-${exportDateStamp()}.yaml`, serializeToYaml(this.data), "application/yaml;charset=utf-8");
            showToast("已匯出行程 YAML");
        } catch (err) {
            console.error("Failed to export trip YAML:", err);
            showToast("匯出失敗，請稍後再試");
        }
    }

    async exportTripUrl() {
        if (!this.data) {
            showToast("目前沒有可匯出的行程");
            return;
        }
        if (this.isSharing) return;
        if (!isShareSupported()) {
            showToast("此瀏覽器不支援連結壓縮，無法產生連結");
            return;
        }
        this.isSharing = true;
        try {
            // The whole trip, ledger included — this one is the user moving their own
            // data between their own devices. Not deduped with shareCurrentTrip.
            const { url, short } = await buildBestShareUrl(serializeToYaml(this.data));
            const copyMsg = short
                ? `已複製跨裝置連結（含記帳），${UPLOADED_NOTE}，在另一台裝置貼上即可`
                : "已複製跨裝置連結（含記帳），在另一台裝置貼上即可";
            await shareOrCopyToClipboard({ url }, url, copyMsg, short ? UPLOADED_NOTE : undefined);
        } catch (err) {
            console.error("Failed to build transfer link:", err);
            showToast("無法產生連結，請稍後再試");
        } finally {
            this.isSharing = false;
        }
    }

    exportLedgerCsv() {
        try {
            const csv = buildLedgerCsv(this.data?.expenses ?? []);
            if (csv === null) {
                showToast("尚無記帳紀錄可匯出");
                return;
            }
            downloadTextFile(`show-me-way-記帳-${exportDateStamp()}.csv`, csv, "text/csv;charset=utf-8");
            showToast("已匯出記帳 CSV");
        } catch (err) {
            console.error("Failed to export ledger CSV:", err);
            showToast("匯出失敗，請稍後再試");
        }
    }

    async createProfile(onSuccess?: () => void) {
        if (!this.data) return;
        let yaml: string;
        try {
            yaml = await fetchDefaultYamlText();
        } catch (err) {
            console.error("Failed to prepare new profile:", err);
            showToast("無法建立新行程，請稍後再試");
            return;
        }
        if (!this.persist()) return;
        try {
            createProfile(yaml);
        } catch (err) {
            console.error("Failed to create profile:", err);
            showToast("建立新行程失敗，請稍後再試");
            return;
        }
        await this.load();
        showToast("已建立新行程，請填入行程內容");
        onSuccess?.();
    }

    async branchLocalCopy(localYaml: string) {
        let forked: TripData;
        try {
            forked = validateYaml(localYaml);
        } catch (err) {
            console.error("Failed to branch the local copy:", err);
            showToast("保留本機版本失敗：內容無法解析");
            return;
        }
        forked.trip.id = genTripId();
        forked.trip.name = `${forked.trip.name}（本機版）`;
        try {
            createProfile(serializeToYaml(forked));
        } catch (err) {
            console.error("Failed to branch the local copy:", err);
            showToast("保留本機版本失敗，請稍後再試");
            return;
        }
        await this.load();
        showToast(`已保留兩份，這台裝置的版本另存為「${forked.trip.name}」`);
    }

    async switchProfile(id: string, onSuccess?: () => void) {
        if (!this.data) return;
        if (!this.persist()) return;
        try {
            switchToProfile(id);
        } catch (err) {
            console.error("Failed to switch profile:", err);
            showToast(err instanceof Error ? err.message : "切換行程失敗，請稍後再試");
            this.profiles = listProfiles();
            return;
        }
        showToast("已切換行程");
        await this.load();
        onSuccess?.();
    }

    deleteProfile(id: string) {
        deleteProfile(id);
        gdriveSync.unbindTrip(id);
        this.profiles = listProfiles();
        showToast("已刪除行程");
    }

    async loadCloudTrip(fileId: string, fileName: string, onSuccess?: () => void, onValidationError?: () => void) {
        const result = await gdriveSync.importCloudTripAsProfile(fileId, () => this.persist());
        if (!result) return;
        if (!result.ok) {
            console.error("Cloud YAML validation failed:", result.error);
            showToast("此雲端行程格式有誤，請到行程管理修正");
            onValidationError?.();
            return;
        }
        await this.load();
        showToast(`已從 Google Drive 載入「${fileName.replace(/\.ya?ml$/i, "")}」`);
        onSuccess?.();
    }

    async deleteCloudTrip(fileId: string) {
        await gdriveSync.deleteTrip(fileId);
    }
}

export const tripStore = new TripStore();
