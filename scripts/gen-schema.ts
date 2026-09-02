import { toJsonSchema } from "@valibot/to-json-schema";
import {
    readFileSync,
    writeFileSync,
} from "node:fs";
import { resolve } from "node:path";
import type { MetadataAction } from "valibot";
import { itinerarySchema } from "../src/lib/domain/trip-schema.ts";

/*
 * Writes `schema/showmeway-schema.json` from `itinerarySchema` so the editor
 * validates the same shape the app loads. It lives outside `public/` on purpose:
 * the app never reads it, and editors fetch it from GitHub raw (see `SCHEMA_LINE`
 * in `trip.ts`), so shipping it with the site would only add a dead asset. `--check` (CI, `pnpm run ci`) only
 * compares and fails when the file is stale; `pnpm run check` and the
 * pre-commit hook regenerate it. Run with plain `node`: Node 24 strips types
 * natively, which is why the relative import carries its `.ts` extension.
 */

const OUTPUT = resolve(import.meta.dirname, "../schema/showmeway-schema.json");

const { $schema, ...converted } = toJsonSchema(itinerarySchema, {
    // Editor-only hints (`deprecated`, `readOnly`, `maxLength`, `enum`) the app does not enforce.
    overrideAction: ({ valibotAction, jsonSchema }) => valibotAction.type === "metadata" ? { ...jsonSchema, ...(valibotAction as MetadataAction<unknown, Record<string, unknown>>).metadata } : jsonSchema,
    // The app strips an unknown key on save, so the editor is the only place a typo like `mapLnk` can be seen.
    overrideSchema: ({ valibotSchema, jsonSchema }) => {
        if (valibotSchema.type !== "object") return jsonSchema;
        const { required, ...rest } = jsonSchema;
        return { ...rest, ...(Array.isArray(required) && required.length > 0 ? { required } : {}), additionalProperties: false };
    },
});

const json = `${JSON.stringify({ $schema, title: "下面一way 行程 Schema", ...converted }, null, 2)}\n`;

if (process.argv.includes("--check")) {
    if (readFileSync(OUTPUT, "utf8") !== json) {
        console.error("schema/showmeway-schema.json 與 src/lib/domain/trip-schema.ts 不一致，請執行 pnpm run schema:gen");
        process.exit(1);
    }
} else {
    writeFileSync(OUTPUT, json);
}
