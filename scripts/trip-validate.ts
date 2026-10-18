import {
    findUnexpectedKeys,
    type SchemaNode,
} from "$lib/domain/schema-keys";
import {
    LEGACY_HOTEL_FIELDS,
    parseYaml,
    validateYaml,
} from "$lib/domain/trip";
import {
    existsSync,
    readFileSync,
} from "node:fs";
import {
    relative,
    resolve,
} from "node:path";

/*
 * Checks itinerary YAML the way the app loads it: `validateYaml` is the gate, so a file
 * this passes is a file the app opens. On top of that it names every key the schema
 * would drop on save, because the app drops a typo like `mapLnk` without a word. A
 * hotel's older field name is not one of those — the app reads it under its new name —
 * so it is a note, not a failure. With no arguments it checks the two files the app falls
 * back to. Exits 1 when any file fails. Runs on plain `node` like gen-schema.ts (see its
 * header for the `$lib` import).
 */

const ROOT = resolve(import.meta.dirname, "..");
const DEFAULT_FILES = ["public/itinerary.yaml", "public/itinerary.local.yaml"].map(file => resolve(ROOT, file));

const schema = JSON.parse(readFileSync(resolve(ROOT, "schema/showmeway-schema.json"), "utf8")) as SchemaNode;

/** `trip.hotels[2].checkIn` → `start`; null for any other path. */
function renamedTo(path: string): string | null {
    const match = /^trip\.hotels\[\d+\]\.(\w+)$/.exec(path);
    const legacy = match?.[1];
    return legacy && Object.hasOwn(LEGACY_HOTEL_FIELDS, legacy) ? LEGACY_HOTEL_FIELDS[legacy as keyof typeof LEGACY_HOTEL_FIELDS] : null;
}

/** Why the file fails, what it should know anyway, or its one-line summary when it passes. */
function check(file: string): { problems: string[]; notes: string[]; summary: string; } {
    if (!existsSync(file)) return { problems: ["找不到這個檔案"], notes: [], summary: "" };
    const text = readFileSync(file, "utf8");
    let data;
    try {
        data = validateYaml(text);
    } catch (error) {
        return { problems: [(error as Error).message], notes: [], summary: "" };
    }
    const problems: string[] = [];
    const notes: string[] = [];
    for (const path of findUnexpectedKeys(parseYaml(text), schema)) {
        const current = renamedTo(path);
        if (current) notes.push(`${path}：舊欄位名，讀成 ${current}，存檔時改寫成 ${current}`);
        else problems.push(`${path}：不在 schema 裡（可能拼錯，或是已移除的欄位），存檔時會被丟掉`);
    }
    return { problems, notes, summary: `${data.days.length} 天、${data.trip.hotels.length} 間住宿` };
}

const requested = process.argv.slice(2).map(file => resolve(file));
const files = requested.length > 0 ? requested : DEFAULT_FILES.filter(existsSync);
if (files.length === 0) {
    console.error("沒有可檢查的行程檔：請指定路徑，例如 pnpm run trip:validate public/itinerary.local.yaml");
    process.exit(1);
}

let failed = false;
for (const file of files) {
    const { problems, notes, summary } = check(file);
    const inside = relative(process.cwd(), file);
    const name = inside.startsWith("..") ? file : inside;
    if (problems.length === 0) {
        console.log(`✓ ${name}（${summary}）`);
        for (const note of notes) console.log(`  ${note}`);
        continue;
    }
    failed = true;
    console.log(`✗ ${name}`);
    for (const problem of problems) console.log(`  ${problem.replaceAll("\n", "\n  ")}`);
    for (const note of notes) console.log(`  ${note}`);
}
process.exit(failed ? 1 : 0);
