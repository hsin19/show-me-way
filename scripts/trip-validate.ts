import {
    findUnexpectedKeys,
    type SchemaNode,
} from "$lib/domain/schema-keys";
import {
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
 * would drop on save, because the app drops a typo like `mapLnk` without a word. With no
 * arguments it checks the two files the app falls back to. Exits 1 when any file fails.
 * Runs on plain `node` like gen-schema.ts (see its header for the `$lib` import).
 */

const ROOT = resolve(import.meta.dirname, "..");
const DEFAULT_FILES = ["public/itinerary.yaml", "public/itinerary.local.yaml"].map(file => resolve(ROOT, file));

const schema = JSON.parse(readFileSync(resolve(ROOT, "schema/showmeway-schema.json"), "utf8")) as SchemaNode;

/** Why the file fails, or its one-line summary when it does not. */
function check(file: string): { problems: string[]; summary: string; } {
    if (!existsSync(file)) return { problems: ["找不到這個檔案"], summary: "" };
    const text = readFileSync(file, "utf8");
    let data;
    try {
        data = validateYaml(text);
    } catch (error) {
        return { problems: [(error as Error).message], summary: "" };
    }
    const problems = findUnexpectedKeys(parseYaml(text), schema).map(path => `${path}：不在 schema 裡（可能拼錯，或是已移除的欄位），存檔時會被丟掉`);
    return { problems, summary: `${data.days.length} 天、${data.trip.hotels.length} 間住宿` };
}

const requested = process.argv.slice(2).map(file => resolve(file));
const files = requested.length > 0 ? requested : DEFAULT_FILES.filter(existsSync);
if (files.length === 0) {
    console.error("沒有可檢查的行程檔：請指定路徑，例如 pnpm run trip:validate public/itinerary.local.yaml");
    process.exit(1);
}

let failed = false;
for (const file of files) {
    const { problems, summary } = check(file);
    const inside = relative(process.cwd(), file);
    const name = inside.startsWith("..") ? file : inside;
    if (problems.length === 0) {
        console.log(`✓ ${name}（${summary}）`);
        continue;
    }
    failed = true;
    console.log(`✗ ${name}`);
    for (const problem of problems) console.log(`  ${problem.replaceAll("\n", "\n  ")}`);
}
process.exit(failed ? 1 : 0);
