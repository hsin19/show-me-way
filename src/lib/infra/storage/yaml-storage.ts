import {
    serializeToYaml,
    type TripData,
} from "../../domain/trip";

export const USER_YAML_KEY = "showmeway_user_yaml";
export const YAML_BACKUPS_KEY = "showmeway_yaml_backups";
const MAX_YAML_BACKUPS = 5;

export interface YamlBackup {
    savedAt: string; // ISO date-time
    yaml: string;
}

/**
 * A localStorage key holding a JSON array, filtered down to elements `isValid`
 * accepts. Missing, unparseable, non-array, or otherwise unreadable storage all
 * come back as `[]` rather than throwing — every caller's storage is optional.
 */
export function readJsonArray<T>(key: string, isValid: (value: unknown) => value is T): T[] {
    try {
        const raw = localStorage.getItem(key);
        if (!raw) return [];
        const parsed: unknown = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];
        return parsed.filter(isValid);
    } catch {
        return [];
    }
}

/** Newest first. Unreadable or malformed storage yields []. */
export function listYamlBackups(): YamlBackup[] {
    return readJsonArray(YAML_BACKUPS_KEY, (entry): entry is YamlBackup =>
        !!entry && typeof entry === "object"
        && typeof (entry as YamlBackup).savedAt === "string"
        && typeof (entry as YamlBackup).yaml === "string");
}

/** The localStorage keys the backup ring occupies, for the storage accounting in App 設定. */
export function yamlBackupKeys(): string[] {
    return localStorage.getItem(YAML_BACKUPS_KEY) === null ? [] : [YAML_BACKUPS_KEY];
}

/**
 * Irreversible — unlike the caches, nothing refetches these — so callers must
 * confirm first. Returns whether there was anything to drop.
 */
export function clearYamlBackups(): boolean {
    const existed = yamlBackupKeys().length > 0;
    localStorage.removeItem(YAML_BACKUPS_KEY);
    return existed;
}

export function getYamlBackup(savedAt: string): string | null {
    return listYamlBackups().find(b => b.savedAt === savedAt)?.yaml ?? null;
}

/**
 * Snapshot the user YAML before overwriting it — this ring is the only undo there
 * is, so every destructive path owes it a call. Repeated calls on unchanged
 * content are free, and it never throws: losing a backup must not block the save
 * it was protecting.
 */
export function backupCurrentYaml(): void {
    const yaml = localStorage.getItem(USER_YAML_KEY);
    if (!yaml) return;
    const backups = listYamlBackups();
    if (backups[0]?.yaml === yaml) return;
    backups.unshift({ savedAt: new Date().toISOString(), yaml });
    try {
        localStorage.setItem(YAML_BACKUPS_KEY, JSON.stringify(backups.slice(0, MAX_YAML_BACKUPS)));
    } catch (err) {
        console.warn("[yaml-storage] Failed to save YAML backup:", err);
    }
}

export function saveTripData(data: TripData, yaml: string = serializeToYaml(data)): void {
    localStorage.setItem(USER_YAML_KEY, yaml);
}
