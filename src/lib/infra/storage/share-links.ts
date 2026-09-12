// The sender's memory of the persistent share link each trip has, keyed by profile slot
// like the Drive binding is. Without it a second tap on 分享行程 would mint a second id
// and a second key, and the QR code already printed would go on serving the old version.
//
// The record deliberately holds the decryption key next to the id. The privacy rule is
// that the two never meet *off* the device — hop's logs, a URL query, a crash report.
// This device already holds the plaintext YAML the key protects, so a local copy of the
// pair adds nothing an attacker on this device did not have; it is what lets the same
// link be updated at all. The `editToken` is a bearer secret that authorizes overwriting
// or deleting the ciphertext on hop, so nothing here may ever leak into the YAML that
// gets exported, shared or sent to Gemini.

export const SHARE_LINKS_KEY = "showmeway_share_links";

export interface ShareLinkRecord {
    /** hop blob id — the half of `#h=<id>.<key>` hop knows. */
    id: string;
    /** base64url AES key — the half hop must never know. */
    key: string;
    /** hop's bearer secret for PUT / DELETE on this id. */
    editToken: string;
    /** ISO date-time the link was first minted. */
    createdAt: string;
    /** ISO date-time the ciphertext was last replaced. */
    updatedAt: string;
    /** ISO date-time hop will drop the blob, or null when hop did not say. */
    expiresAt: string | null;
}

export type ShareLinkMap = Record<string, ShareLinkRecord>;

function isRecord(value: unknown): value is ShareLinkRecord {
    if (!value || typeof value !== "object") return false;
    const r = value as ShareLinkRecord;
    return typeof r.id === "string" && typeof r.key === "string" && typeof r.editToken === "string"
        && typeof r.createdAt === "string" && typeof r.updatedAt === "string"
        && (r.expiresAt === null || typeof r.expiresAt === "string");
}

/** Unreadable or malformed storage yields {}; a malformed entry is dropped, not the map. */
export function loadShareLinkMap(): ShareLinkMap {
    try {
        const raw = localStorage.getItem(SHARE_LINKS_KEY);
        if (!raw) return {};
        const parsed: unknown = JSON.parse(raw);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
        const out: ShareLinkMap = {};
        for (const [profileId, value] of Object.entries(parsed as Record<string, unknown>)) {
            if (isRecord(value)) out[profileId] = value;
        }
        return out;
    } catch {
        return {};
    }
}

/** Throws on a refused write (quota, blocked storage) so the caller can say the link was minted but not remembered. */
export function saveShareLinkMap(map: ShareLinkMap): void {
    if (Object.keys(map).length === 0) {
        localStorage.removeItem(SHARE_LINKS_KEY);
        return;
    }
    localStorage.setItem(SHARE_LINKS_KEY, JSON.stringify(map));
}

/**
 * The `appProperties` a trip's Drive file carries this record in, so a link minted on one
 * device can be updated from another instead of forking into a second id. Metadata, never
 * file content: the YAML is what reaches a recipient, Gemini and every export, and the
 * whole point is that this pair never travels with it.
 *
 * Two keys rather than one because Drive caps each property at 124 bytes of key plus
 * value, and hop decides how long an `editToken` is. Times ride as base-36 epoch seconds
 * for the same reason; they are labels, so a file written without them still yields a
 * usable link.
 */
export const SHARE_LINK_PROPERTY = "shareLink";
export const SHARE_LINK_TIMES_PROPERTY = "shareLinkAt";
const DRIVE_PROPERTY_MAX_BYTES = 124;

function fitsDriveProperty(name: string, value: string): boolean {
    return new TextEncoder().encode(name + value).length <= DRIVE_PROPERTY_MAX_BYTES;
}

function toEpoch36(iso: string): string {
    const ms = Date.parse(iso);
    return Number.isNaN(ms) ? "" : Math.floor(ms / 1000).toString(36);
}

function fromEpoch36(value: string | undefined): string | null {
    if (!value) return null;
    const seconds = parseInt(value, 36);
    return Number.isNaN(seconds) ? null : new Date(seconds * 1000).toISOString();
}

/**
 * Null when the record cannot be expressed inside Drive's per-property cap — an
 * `editToken` longer than this encoding can carry costs the trip its cross-device link,
 * never its upload.
 */
export function encodeShareLinkProperties(record: ShareLinkRecord): { shareLink: string; shareLinkAt: string; } | null {
    if ([record.id, record.key, record.editToken].some(part => !part || part.includes("."))) return null;
    const shareLink = `${record.id}.${record.key}.${record.editToken}`;
    const shareLinkAt = `${toEpoch36(record.createdAt)}.${toEpoch36(record.updatedAt)}.${record.expiresAt ? toEpoch36(record.expiresAt) : ""}`;
    if (!fitsDriveProperty(SHARE_LINK_PROPERTY, shareLink) || !fitsDriveProperty(SHARE_LINK_TIMES_PROPERTY, shareLinkAt)) return null;
    return { shareLink, shareLinkAt };
}

/** Null unless all three secrets are present — a half-written pair is not a link this device can use. */
export function decodeShareLinkProperties(shareLink?: string, shareLinkAt?: string): ShareLinkRecord | null {
    const [id, key, editToken] = (shareLink ?? "").split(".");
    if (!id || !key || !editToken) return null;
    const [created, updated, expires] = (shareLinkAt ?? "").split(".");
    // Stamped now when the times are absent: they only drive the labels in 行程管理, and
    // refusing the link over them would lose the one thing worth carrying.
    const fallback = new Date().toISOString();
    return {
        id,
        key,
        editToken,
        createdAt: fromEpoch36(created) ?? fallback,
        updatedAt: fromEpoch36(updated) ?? fallback,
        expiresAt: fromEpoch36(expires),
    };
}
