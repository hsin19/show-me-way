import { yamlFingerprint } from "$lib/domain/utils";
import {
    describe,
    expect,
    it,
} from "vitest";
import {
    buildRebindRecord,
    decideSyncAction,
    rebindFor,
} from "./drive-sync";

describe("decideSyncAction", () => {
    // Both sides agreed on md5-a / hash-a at the last sync.
    const agreed = {
        record: { fileId: "file-1", remoteMd5: "md5-a", localHash: "hash-a", remoteHash: "hash-a" },
        remoteExists: true,
        remoteMd5: "md5-a",
        remoteHash: "hash-a",
        localHash: "hash-a",
    };

    it("pushes when the trip has no Drive file yet", () => {
        expect(decideSyncAction({ ...agreed, record: null })).toBe("push");
    });

    it("pushes when the bound file is gone from Drive", () => {
        expect(decideSyncAction({ ...agreed, remoteExists: false })).toBe("push");
    });

    it("pushes a record migrated from the timestamp scheme, which agreed on nothing", () => {
        // The one case that can overwrite a remote another device advanced — documented.
        expect(decideSyncAction({ ...agreed, record: { fileId: "file-1" } })).toBe("push");
    });

    it("compares the recorded hashes when the record predates md5 but has one", () => {
        // Narrower than "no remoteMd5 means push": a hash on both sides is a usable base.
        const record = { fileId: "file-1", localHash: "hash-a", remoteHash: "hash-a" };
        expect(decideSyncAction({ ...agreed, record, remoteMd5: null })).toBe("up_to_date");
        expect(decideSyncAction({ ...agreed, record, remoteMd5: null, remoteHash: "hash-b", localHash: "hash-b" }))
            .toBe("up_to_date");
    });

    describe("with md5 saying the remote moved", () => {
        const moved = { ...agreed, remoteMd5: "md5-b" };

        it("pulls when only the remote moved, whatever the remote hash claims", () => {
            // Rule 1 outranks rule 2: equal hashes against a moved md5 means the hash is
            // stale — someone wrote the file outside this app — and the bytes win.
            expect(decideSyncAction({ ...moved, remoteHash: "hash-a" })).toBe("pull");
            expect(decideSyncAction({ ...moved, remoteHash: "hash-b" })).toBe("pull");
            expect(decideSyncAction({ ...moved, remoteHash: null })).toBe("pull");
        });

        it("resolves to up_to_date when both sides moved to identical content", () => {
            expect(decideSyncAction({ ...moved, remoteHash: "hash-b", localHash: "hash-b" })).toBe("up_to_date");
        });

        it("reports a conflict when both sides moved apart", () => {
            expect(decideSyncAction({ ...moved, remoteHash: "hash-c", localHash: "hash-b" })).toBe("conflict");
            expect(decideSyncAction({ ...moved, remoteHash: null, localHash: "hash-b" })).toBe("conflict");
        });
    });

    describe("with md5 saying the remote stood still", () => {
        it("does nothing when neither side moved", () => {
            expect(decideSyncAction(agreed)).toBe("up_to_date");
        });

        it("pushes local changes", () => {
            expect(decideSyncAction({ ...agreed, localHash: "hash-b" })).toBe("push");
            expect(decideSyncAction({ ...agreed, localHash: "hash-b", remoteHash: null })).toBe("push");
        });

        it("skips the upload when the local edit landed back on the remote's content", () => {
            expect(decideSyncAction({
                ...agreed,
                record: { ...agreed.record, localHash: "hash-b", remoteHash: "hash-a" },
            })).toBe("up_to_date");
        });
    });

    describe("with the remote's movement unknowable", () => {
        // Drive reporting no md5 for a live file, and no recorded hash to fall back on.
        const unknowable = { ...agreed, remoteMd5: null, record: { fileId: "file-1", remoteMd5: "md5-a", localHash: "hash-a" } };

        it("derives the direction from the content comparison when it can", () => {
            // An agreement is only ever recorded from bytes both sides hold, so local
            // standing still while the contents differ can only mean the remote moved.
            expect(decideSyncAction({ ...unknowable, remoteHash: "hash-b" })).toBe("pull");
            expect(decideSyncAction({ ...unknowable, remoteHash: "hash-b", localHash: "hash-b" })).toBe("up_to_date");
            expect(decideSyncAction({ ...unknowable, remoteHash: "hash-c", localHash: "hash-b" })).toBe("conflict");
        });

        it("never pushes blind with nothing at all to compare", () => {
            // Unknowable, not unchanged — pushing here would be last-writer-wins.
            expect(decideSyncAction({ ...unknowable, remoteHash: null, localHash: "hash-b" })).toBe("conflict");
            expect(decideSyncAction({ ...unknowable, remoteHash: null })).toBe("up_to_date");
        });
    });

    it("treats a record with no local fingerprint as locally changed", () => {
        const record = { fileId: "file-1", remoteMd5: "md5-a" };
        expect(decideSyncAction({ ...agreed, record, remoteHash: null })).toBe("push");
        expect(decideSyncAction({ ...agreed, record, remoteMd5: "md5-b", remoteHash: null })).toBe("conflict");
    });

    describe("with an unresolved rebind on the record", () => {
        // What buildRebindRecord writes when the two copies differ: a binding, no base.
        const rebound = { fileId: "file-1", remoteMd5: "md5-a", remoteHash: "hash-a", diverged: true };

        it("refuses to push past it even though nothing moved since", () => {
            // The whole point: without the flag this is indistinguishable from a legacy
            // record, and "assume local moved" would overwrite a cloud copy the user has
            // never seen. It has to survive the reload that drops any in-memory conflict.
            expect(decideSyncAction({ ...agreed, record: rebound, localHash: "hash-b" })).toBe("conflict");
        });

        it("still refuses when only the remote has moved on", () => {
            expect(decideSyncAction({ ...agreed, record: rebound, remoteMd5: "md5-b", remoteHash: "hash-c", localHash: "hash-b" }))
                .toBe("conflict");
        });

        it("settles itself when the two sides turn out to hold the same content", () => {
            // The one resolution that needs no decision — nothing would be discarded.
            expect(decideSyncAction({ ...agreed, record: rebound, remoteHash: "hash-b", localHash: "hash-b" }))
                .toBe("up_to_date");
        });

        it("leaves a legacy record without one pushing as before", () => {
            // Records migrated from the timestamp scheme also lack a localHash; only the
            // flag distinguishes them, and their documented behaviour is to push.
            const legacy = { fileId: "file-1", remoteMd5: "md5-a", remoteHash: "hash-a" };
            expect(decideSyncAction({ ...agreed, record: legacy, localHash: "hash-b" })).toBe("push");
        });
    });
});

describe("buildRebindRecord", () => {
    const file = { id: "file-1", md5Checksum: "md5-a", contentHash: "hash-a" };

    it("records a complete agreement when the two copies match", () => {
        // The payoff of publishing contentHash: a full merge base without downloading.
        expect(buildRebindRecord(file, "hash-a")).toEqual({
            fileId: "file-1",
            remoteMd5: "md5-a",
            remoteHash: "hash-a",
            localHash: "hash-a",
        });
    });

    it("binds the file but marks it diverged when the two copies differ", () => {
        // A localHash here would claim the two sides once shared contents they never did,
        // and the next sync would read that as up_to_date. `diverged` is what holds it
        // instead, and it is on the record so a reload cannot lose it.
        expect(buildRebindRecord(file, "hash-b")).toEqual({
            fileId: "file-1",
            remoteMd5: "md5-a",
            remoteHash: "hash-a",
            diverged: true,
        });
    });

    it("cannot agree with a file that published no hash", () => {
        expect(buildRebindRecord({ id: "file-1", md5Checksum: "md5-a" }, "hash-a")).toEqual({
            fileId: "file-1",
            remoteMd5: "md5-a",
            remoteHash: undefined,
            diverged: true,
        });
    });
});

describe("rebindFor", () => {
    const YAML = "trip:\n  name: 東京\n  id: t-tokyo\n";
    const file = (id: string, tripId = "t-tokyo") => ({ id, name: "東京", modifiedTime: "2026-09-01T00:00:00Z", tripId, md5Checksum: `md5-${id}`, contentHash: yamlFingerprint(YAML) });
    const bound = (fileId: string) => ({ fileId, remoteMd5: "md5-x", localHash: yamlFingerprint(YAML), remoteHash: yamlFingerprint(YAML) });

    it("leaves a binding alone while its file is still listed", () => {
        expect(rebindFor({ p1: bound("file-1") }, "p1", "t-tokyo", YAML, [file("file-2"), file("file-1")])).toBeNull();
    });

    // Deleted, then uploaded again by another device: pushing through the dead binding would make a second copy.
    it("rebinds a binding whose file left the listing to the one that replaced it", () => {
        expect(rebindFor({ p1: bound("file-deleted") }, "p1", "t-tokyo", YAML, [file("file-2")])?.record.fileId).toBe("file-2");
    });

    it("leaves a dead binding alone when nothing replaced it, so the push re-creates the file", () => {
        expect(rebindFor({ p1: bound("file-deleted") }, "p1", "t-tokyo", YAML, [file("file-9", "t-other")])).toBeNull();
    });

    it("never takes a file another record names, so two holders of one trip id cannot share it", () => {
        expect(rebindFor({ p1: bound("file-1") }, "p2", "t-tokyo", YAML, [file("file-1")])).toBeNull();
    });

    // Two local copies of one trip (made before copies were re-identified) against two copies on Drive.
    it("gives each key holding one trip id its own copy in turn, once the first record is written", () => {
        const records = {};
        const first = rebindFor(records, "p1", "t-tokyo", YAML, [file("file-new"), file("file-old")]);
        const second = rebindFor({ p1: first!.record }, "p2", "t-tokyo", YAML, [file("file-new"), file("file-old")]);

        expect([first?.record.fileId, second?.record.fileId]).toEqual(["file-new", "file-old"]);
    });

    it("binds the newest listed copy, the first in listing order", () => {
        expect(rebindFor({}, "p1", "t-tokyo", YAML, [file("file-new"), file("file-old")])?.record.fileId).toBe("file-new");
    });

    it("has nothing to match a trip without an id on", () => {
        expect(rebindFor({}, "p1", null, YAML, [file("file-1")])).toBeNull();
    });
});
