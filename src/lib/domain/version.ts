export const APP_VERSION = typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "dev";

export const REPO_URL = "https://github.com/hsin19/show-me-way";

/**
 * GitHub commit page for this build, or null when there is no SHA to link
 * ("dev" fallback builds). GitHub resolves the short 7-char SHA.
 */
export function versionCommitUrl(version: string = APP_VERSION): string | null {
    return version === "dev" ? null : `${REPO_URL}/commit/${version}`;
}

export function formatBuildDate(
    iso = typeof __BUILD_TIME__ !== "undefined" ? __BUILD_TIME__ : new Date().toISOString(),
): string {
    const d = new Date(iso);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
