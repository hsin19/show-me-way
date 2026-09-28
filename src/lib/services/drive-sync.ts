// The sync decision the app's `gdriveSync` store and `trip:sync` share, so a rule changed
// here reaches both. The pure half — which way a sync goes (`decideSyncAction`), what a
// rebind records (`buildRebindRecord`), when a binding is rebuilt (`rebindFor`) —
// needs no network; `planCloudSync` reads the remote live and hands back the transfer as a
// thunk, so nothing moves until the caller runs it on a tap. The Drive calls themselves are
// `infra/http/gdrive.ts`.

import { yamlFingerprint } from "$lib/domain/utils";
import {
    type CloudTripFile,
    downloadCloudTripYaml,
    fetchCloudTripMeta,
    type TripSyncRecord,
    uploadOrUpdateCloudTrip,
} from "$lib/infra/http/gdrive";
import {
    tripIdFromYaml,
    tripNameFromYaml,
} from "$lib/infra/storage/profiles";
import type { ShareLinkRecord } from "$lib/infra/storage/share-links";

/** What a sync should do, given what both sides last agreed on. */
export type SyncDecision = "push" | "pull" | "up_to_date" | "conflict";

/**
 * Whether the remote copy moved since the last agreement, or `null` when neither side of
 * the comparison is available.
 *
 * Drive's md5 is asked first and is final: it measures the bytes, so it catches an edit
 * made outside this app — in Drive's own UI, by a desktop sync client, or by restoring a
 * version — which `contentHash` cannot, being a value this app writes and only refreshes
 * when it writes the file itself.
 */
function remoteMoved(record: TripSyncRecord, remoteMd5: string | null, remoteHash: string | null): boolean | null {
    if (record.remoteMd5 && remoteMd5) return remoteMd5 !== record.remoteMd5;
    if (record.remoteHash && remoteHash) return remoteHash !== record.remoteHash;
    return null;
}

/**
 * The whole sync direction decision, kept pure so the truth table is testable.
 *
 * Three memories drive it. Two are per-side history: `record.localHash` says what the
 * local YAML looked like at the last successful sync, `record.remoteMd5`/`remoteHash` what
 * Drive held at that same moment. Comparing each against its current value answers "did
 * this side move" without ever comparing two clocks — the device's clock and Google's are
 * not comparable, and doing so is what used to discard whichever side the phone's clock
 * disagreed with. The third is `remoteHash` vs `localHash`, which answers a question no
 * history can: whether the two sides are byte-identical *right now*. It exists only
 * because `yamlFingerprint` runs on both sides; Drive's md5 has no local counterpart
 * (`crypto.subtle` has no MD5).
 *
 * Rule order, and why the first one comes first:
 *   1. remote moved, local did not              → pull
 *   2. contents are equal                       → up_to_date
 *   3. remote moved (so local did too)          → conflict
 *   4. remote did not move                      → push / up_to_date
 *   5. unknowable, but contents differ          → conflict / pull
 *   6. unknowable                               → conflict / up_to_date
 * Rule 1 outranks rule 2 deliberately: equal hashes with a moved md5 is the signature of
 * an edit made outside this app, where the hash is stale and the bytes are authoritative.
 * Taking the remote there loses nothing; trusting the hash would silently overwrite that
 * edit on the next push.
 *
 * Rule 5 reads the equality backwards to recover a direction the history could not supply:
 * an agreement is only ever recorded from bytes both sides hold, so "local has not moved
 * and the contents now differ" can only mean the remote did.
 *
 * `push` covers creating the file too: no record, or a record whose Drive copy is gone,
 * both mean there is nothing to overwrite.
 *
 * Two deliberate asymmetries:
 * - A record with no remote memory at all (migrated from the timestamp scheme) resolves to
 *   `push`. This is the ONE case that can overwrite a remote another device advanced: with
 *   nothing agreed there is nothing to compare, and the alternative — prompting every
 *   upgrading install on its first sync — trades a rare loss for certain noise.
 * - A live remote that reports neither md5 nor `contentHash` is unknowable rather than
 *   unchanged, so it never silently pushes: it asks, or does nothing.
 */
export function decideSyncAction(state: {
    record: TripSyncRecord | null;
    remoteExists: boolean;
    remoteMd5: string | null;
    remoteHash: string | null;
    localHash: string;
}): SyncDecision {
    const { record } = state;
    if (!record || !state.remoteExists) return "push";
    if (!record.remoteMd5 && !record.remoteHash) return "push";

    // No recorded fingerprint means the last sync predates them: assume local moved.
    const localChanged = record.localHash === undefined || record.localHash !== state.localHash;
    const remoteChanged = remoteMoved(record, state.remoteMd5, state.remoteHash);
    const sameContent = state.remoteHash === null ? null : state.remoteHash === state.localHash;

    // An unresolved rebind outranks every direction below: the record deliberately holds
    // no base, so those rules would read it as "local moved" and overwrite a cloud copy
    // the user has never seen. Only the two sides turning out to hold the same content
    // settles it without a decision — see `buildRebindRecord`.
    if (record.diverged) return sameContent === true ? "up_to_date" : "conflict";

    if (remoteChanged === true && !localChanged) return "pull";
    if (sameContent === true) return "up_to_date";
    if (remoteChanged === true) return "conflict";
    if (remoteChanged === false) return localChanged ? "push" : "up_to_date";
    if (sameContent === false) return localChanged ? "conflict" : "pull";
    return localChanged ? "conflict" : "up_to_date";
}

/**
 * The record to write for a Drive file that names this trip but which this device holds no
 * binding for — after a sign-out, a reinstall, or storage being evicted. Kept pure and
 * separate from `decideSyncAction` because the question is a different one: not "which way
 * should this sync go" but "is there an agreement here to record at all".
 *
 * Whether they agree is the whole point of publishing `contentHash`: the two copies can be compared
 * without downloading either, so the common rebind — you signed back in and nothing had
 * changed — costs one listing and recovers a complete merge base.
 *
 * When they differ there is no agreement to record, and `localHash` is deliberately left
 * out rather than filled with the current value: writing it would claim the two sides
 * agreed on contents they never shared, and the next sync would call that up_to_date and
 * quietly overwrite one of them. The record still names the file, which is what stops a
 * duplicate being created, and carries `diverged` so it holds the trip by itself —
 * `decideSyncAction` refuses to push past it until the user picks a side. The flag is on
 * the record rather than in the caller's UI state because a missing `localHash` decides
 * `push`, and anything the caller keeps in memory stops holding it at the next reload.
 */
export function buildRebindRecord(
    file: { id: string; md5Checksum?: string; contentHash?: string; },
    localHash: string,
): TripSyncRecord {
    const agreed = !!file.contentHash && file.contentHash === localHash;
    return {
        fileId: file.id,
        remoteMd5: file.md5Checksum,
        remoteHash: file.contentHash,
        ...(agreed ? { localHash } : { diverged: true }),
    };
}

/**
 * The record for a copy both sides hold right now — just sent, just received, or proven
 * equal through `contentHash` — so one fingerprint stands for both memories. Recording it
 * on anything weaker claims an agreement that never happened. A received copy is recorded
 * as it crossed the wire although the app stores it canonical: for a file the app did not
 * write the two differ, and reading as a local edit is how that file gets repaired.
 */
export function agreedRecord(fileId: string, yaml: string, remoteMd5?: string): TripSyncRecord {
    const hash = yamlFingerprint(yaml);
    return { fileId, remoteMd5, localHash: hash, remoteHash: hash };
}

/**
 * The rebind `key`'s trip is due, given a fresh listing — the one rule the app's
 * `reconcileBindings` and `trip:sync` both apply. Null while its record names a file still
 * listed, when its YAML has no `tripId`, or when no listed file carrying that id is free.
 * A record whose file has left the listing is as stale as none: another device may already
 * have uploaded the trip again, and a push through the dead binding would create a second
 * copy beside it; left alone when nothing replaced it, so that push re-creates the file.
 *
 * A file some other key's record names is not free, so a caller binding several keys from
 * one listing must write each record before asking for the next: keys holding one trip id
 * then take its listed copies in turn, newest first, instead of all claiming the same one.
 */
export function rebindFor(
    records: Record<string, TripSyncRecord>,
    key: string,
    tripId: string | null,
    localYaml: string,
    files: CloudTripFile[],
): { record: TripSyncRecord; file: CloudTripFile; } | null {
    const bound = records[key];
    if (bound && files.some(file => file.id === bound.fileId)) return null;
    if (!tripId) return null;
    const taken = new Set(Object.values(records).map(record => record.fileId));
    // Newest wins: `listCloudTrips` orders by modifiedTime, and duplicates sharing one trip
    // id are exactly what a missing rebind used to produce.
    const file = files.find(candidate => candidate.tripId === tripId && !taken.has(candidate.id));
    return file ? { record: buildRebindRecord(file, yamlFingerprint(localYaml)), file } : null;
}

/**
 * What one sync of one trip found. `decision` is what a plain sync does; `push` and `pull` are
 * the transfers themselves — the one `decision` names, or the other as the user's answer to a
 * conflict, which needs no second look at the remote and so cannot act on a newer one than was
 * decided against. Nothing moves until the caller runs one, and the records they hand back are
 * the caller's to store — a pulled one only after the bytes have landed on its side.
 */
export interface CloudSyncPlan {
    decision: SyncDecision;
    /** The live remote; null when the trip has no file or its file is gone, which only `push` can follow. */
    remoteFile: CloudTripFile | null;
    push: (shareLink: ShareLinkRecord | undefined) => Promise<{ file: CloudTripFile; record: TripSyncRecord; }>;
    /** Null without a live remote to take. */
    pull: (() => Promise<{ yaml: string; record: TripSyncRecord; }>) | null;
    /** For `up_to_date` proven by equal content, the agreement to store; null otherwise. */
    settled: TripSyncRecord | null;
}

/** Reads a trip's Drive copy live and decides the direction against `record`. Transfers nothing. */
export async function planCloudSync(token: string, record: TripSyncRecord | null, localYaml: string): Promise<CloudSyncPlan> {
    const remoteFile = record ? await fetchCloudTripMeta(token, record.fileId) : null;
    const localHash = yamlFingerprint(localYaml);
    const decision = decideSyncAction({
        record,
        remoteExists: !!remoteFile,
        remoteMd5: remoteFile?.md5Checksum ?? null,
        remoteHash: remoteFile?.contentHash ?? null,
        localHash,
    });
    return {
        decision,
        remoteFile,
        push: async shareLink => {
            const file = await uploadOrUpdateCloudTrip(token, tripNameFromYaml(localYaml), localYaml, {
                // A record whose Drive copy is gone has to create a new file rather than
                // PATCH the id that just answered 404.
                fileId: remoteFile?.id,
                // The trip's own id out of the YAML: it is what another device, or this
                // one after losing its local state, recognises the file by.
                tripId: tripIdFromYaml(localYaml) ?? undefined,
                shareLink,
            });
            // Fingerprinted from the bytes actually sent, not from whatever the editor
            // holds by now: a save that landed mid-upload is not in `localYaml`, and
            // recording the current content would mark that edit as sent.
            return { file, record: agreedRecord(file.id, localYaml, file.md5Checksum) };
        },
        pull: remoteFile
            ? async () => {
                const yaml = await downloadCloudTripYaml(token, remoteFile.id);
                return { yaml, record: agreedRecord(remoteFile.id, yaml, remoteFile.md5Checksum) };
            }
            : null,
        // Both sides having moved to the same content decides as up_to_date, but leaves the
        // recorded base naming the copies they moved away from — the next real edit would
        // then read as "both changed" and raise a conflict nobody caused. Re-recorded only on
        // proven content equality: up_to_date is also reached with the remote's movement
        // unknowable, and stamping an unverified base there is exactly what the checksums
        // exist to prevent.
        settled: decision === "up_to_date" && remoteFile?.contentHash === localHash
            ? agreedRecord(remoteFile.id, localYaml, remoteFile.md5Checksum)
            : null,
    };
}
