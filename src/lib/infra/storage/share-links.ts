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
