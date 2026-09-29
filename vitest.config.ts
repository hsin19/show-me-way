import { svelte } from "@sveltejs/vite-plugin-svelte";
import {
    fileURLToPath,
    URL,
} from "node:url";
import { defineConfig } from "vitest/config";

// Standalone test config so the app's Vite/PWA plugins aren't loaded for unit tests.
// The svelte plugin is still required to compile $state runes in .svelte.ts modules.
export default defineConfig({
    resolve: {
        alias: {
            $lib: fileURLToPath(new URL("./src/lib", import.meta.url)),
        },
    },
    // Vitest's node environment runs everything through the SSR pipeline, under
    // which `$effect` and `flushSync` are silent no-ops — an `$effect`-driven
    // module (gemini-models.svelte.ts) would "pass" without its effect ever
    // running. Both halves are needed to get the client runtime, which works fine
    // without a DOM: `generate: "client"` flips what the compiler emits, and the
    // `browser` condition flips which svelte runtime that code imports.
    plugins: [svelte({ dynamicCompileOptions: () => ({ generate: "client" }) })],
    ssr: { resolve: { conditions: ["browser", "node", "import", "module", "default"] } },
    test: {
        projects: [
            {
                extends: true,
                test: { name: "unit", include: ["src/**/*.test.ts"], exclude: ["src/app-tests/**"], environment: "node" },
            },
            {
                // The whole App mounted into happy-dom and driven through the DOM, with
                // the network stubbed at `fetch` (src/app-tests/harness.ts). What
                // needs layout, real CSS, WebKit or a service worker stays in Playwright.
                extends: true,
                resolve: {
                    alias: { "virtual:pwa-register": fileURLToPath(new URL("./src/app-tests/pwa-register.ts", import.meta.url)) },
                    conditions: ["browser"],
                },
                test: {
                    name: "app",
                    include: ["src/app-tests/**/*.test.ts"],
                    environment: "happy-dom",
                    // Reduced motion as in playwright.config.ts: outros take 0ms, so a toast
                    // replaced through its dedupeKey never shares the DOM with its successor.
                    environmentOptions: { happyDOM: { url: "http://localhost:8046/", settings: { device: { prefersReducedMotion: "reduce" } } } },
                },
            },
        ],
        coverage: {
            provider: "v8",
            // `lcovonly`, not `lcov`: the latter also writes a few hundred HTML files
            // that neither CI nor `pnpm run check` reads. Pass `--coverage.reporter=html`
            // when you actually want to browse it.
            reporter: ["text-summary", "lcovonly"],
            // Components count now that the `app` project renders them. `main.ts` stays
            // out: it only mounts into index.html, which no test loads, so it would sit
            // at 0% for a reason no test could fix. Playwright's runs are not measured.
            include: ["src/**/*.{ts,svelte}"],
            exclude: ["src/**/*.test.ts", "src/**/*.d.ts", "src/main.ts", "src/lib/testing/**", "src/app-tests/**"],
        },
    },
});
