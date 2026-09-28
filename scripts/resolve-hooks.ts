import { existsSync } from "node:fs";
import { registerHooks } from "node:module";
import {
    fileURLToPath,
    pathToFileURL,
} from "node:url";

/*
 * Lets plain `node` run scripts that import from `src/lib`: Node 24 strips the types, but
 * not the two things the app's code leans on Vite for — the `$lib` alias and extensionless
 * relative imports. Preloaded with `node --import`, so it touches nothing outside those
 * script runs; `vite`, vitest and the build resolve imports on their own.
 */

const LIB = new URL("../src/lib/", import.meta.url);

registerHooks({
    resolve(specifier, context, nextResolve) {
        const aliased = specifier.startsWith("$lib/") ? new URL(specifier.slice(5), LIB).href : specifier;
        // A package's own imports never need the `.ts` guess, and anything not rewritten goes
        // back as it came: the hook also serves `require()`, whose resolver takes a
        // specifier, not the file: URL `new URL` would turn it into. The rewrites themselves
        // hand over URLs, so they serve `import` only — the app's code is never required.
        if ((aliased.startsWith("file:") || aliased.startsWith(".")) && !context.parentURL?.includes("/node_modules/")) {
            const url = new URL(aliased, context.parentURL);
            if (!url.pathname.endsWith(".ts") && existsSync(`${fileURLToPath(url)}.ts`)) {
                return nextResolve(pathToFileURL(`${fileURLToPath(url)}.ts`).href, context);
            }
        }
        return nextResolve(aliased, context);
    },
});
