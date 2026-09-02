/**
 * The one place a `ShareLink` becomes YAML text. Both import paths — the URL hash
 * at startup and a link pasted into 行程管理's editor — call this, so the failure
 * classification and its zh-TW copy live once. The two used to be written twice
 * and had already drifted apart in the same commit.
 */

import {
    decodeShareToken,
    type ShareLink,
    ShareLinkError,
} from "$lib/domain/share";
import {
    isEncryptedShareSupported,
    openShareToken,
} from "$lib/domain/share-crypto";
import { fetchHopBlob } from "./hop";

/**
 * Rejects only with `ShareLinkError`. A `retryable` one means the same link may
 * still open later (offline, hop down, a browser without SubtleCrypto), so the
 * caller must not discard the link — for a `#h=` link the address bar holds the
 * only copy of the key. A non-retryable one is a dead or corrupt link.
 */
export async function resolveShareLink(link: ShareLink): Promise<string> {
    if (link.kind === "inline") return decodeShareToken(link.token);

    // The link itself is fine; this browser is not. Retryable so the hash survives
    // for the user to reopen it over https or in another browser.
    if (!isEncryptedShareSupported()) {
        throw new ShareLinkError("此瀏覽器無法解開加密的分享連結，請改用 https 或其他瀏覽器開啟", { retryable: true });
    }

    const res = await fetchHopBlob(link.id);
    if (!res.ok) {
        throw res.reason === "gone"
            ? new ShareLinkError("這個分享連結已失效或過期")
            : new ShareLinkError("目前無法取得分享的行程，請檢查網路後再試一次", { retryable: true });
    }
    return openShareToken(res.cipher, link.key);
}
