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
        // Type-aware rules scoped to src; config .js files stay untyped.
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
    {
        // Only the promise rules, not the full recommendedTypeChecked set: the
        // `no-unsafe-*` rules fire on the `any`s svelte2tsx emits for template
        // bindings, not on real code. `no-misused-promises` cannot check
        // template attributes (it only knows JSX), so `onclick={asyncFn}` still
        // passes; these three cover the `<script>` block.
        files: ["src/**/*.svelte"],
        languageOptions: {
            parserOptions: {
                projectService: true,
                tsconfigRootDir: import.meta.dirname,
            },
        },
        rules: {
            "@typescript-eslint/await-thenable": "error",
            "@typescript-eslint/no-floating-promises": "error",
            "@typescript-eslint/no-misused-promises": "error",
        },
    },
    {
        files: ["src/**/*.{ts,js,svelte}", "e2e/**/*.ts"],
        rules: {
            "no-restricted-imports": [
                "error",
                {
                    patterns: [
                        {
                            group: ["../*"],
                            message: "Use '$lib/...' instead of cross-directory relative paths ('../'). Sibling imports may use './'.",
                        },
                    ],
                },
            ],
        },
    },
    {
        files: ["src/lib/domain/**/*.{ts,js}"],
        rules: {
            "no-restricted-imports": [
                "error",
                {
                    patterns: [
                        {
                            group: [
                                "../*",
                                "$lib/infra",
                                "$lib/infra/*",
                                "$lib/stores",
                                "$lib/stores/*",
                                "$lib/ui",
                                "$lib/ui/*",
                            ],
                            message: "domain/ is a pure calculation layer and must not depend on outer modules ($lib/infra, $lib/stores, $lib/ui).",
                        },
                    ],
                },
            ],
        },
    },
);
