export const APP_VERSION = typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "dev";

export function formatBuildDate(
    iso = typeof __BUILD_TIME__ !== "undefined" ? __BUILD_TIME__ : new Date().toISOString(),
): string {
    const d = new Date(iso);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
