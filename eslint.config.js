import js from "@eslint/js";
import svelte from "eslint-plugin-svelte";
import {
    defineConfig,
    globalIgnores,
} from "eslint/config";
import globals from "globals";
import ts from "typescript-eslint";
import svelteConfig from "./svelte.config.js";

export default defineConfig(
    globalIgnores(["dist/", "dev-dist/", "node_modules/", ".svelte-check/"]),
    js.configs.recommended,
    ts.configs.recommended,
    svelte.configs.recommended,
    {
        languageOptions: {
            globals: { ...globals.browser, ...globals.node },
        },
    },
    {
        // Type-aware rules scoped to src TypeScript only; config .js files stay untyped.
        files: ["src/**/*.ts"],
        extends: [ts.configs.recommendedTypeChecked],
        languageOptions: {
            parserOptions: {
                projectService: true,
                tsconfigRootDir: import.meta.dirname,
            },
        },
    },
    {
        files: ["**/*.svelte", "**/*.svelte.ts", "**/*.svelte.js"],
        languageOptions: {
            parserOptions: {
                parser: ts.parser,
                extraFileExtensions: [".svelte"],
                svelteConfig,
            },
        },
    },
);
