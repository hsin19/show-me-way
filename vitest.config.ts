import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vitest/config";

// Standalone test config so the app's Vite/PWA plugins aren't loaded for unit tests.
// The svelte plugin is still required to compile $state runes in .svelte.ts modules.
export default defineConfig({
    plugins: [svelte()],
    test: {
        include: ["src/**/*.test.ts"],
        environment: "node",
        coverage: {
            provider: "v8",
            // `lcovonly`, not `lcov`: the latter also writes a few hundred HTML files
            // that neither CI nor `pnpm run check` reads. Pass `--coverage.reporter=html`
            // when you actually want to browse it.
            reporter: ["text-summary", "lcovonly"],
            // Only what this layer can actually reach. `environment: "node"` means
            // there is no component-test layer at all, so including `.svelte` (or
            // `App.svelte`'s helpers) would report every one of them at 0% and bury
            // the number this is here to track -- Playwright is their coverage.
            include: ["src/lib/**/*.ts"],
            exclude: ["src/lib/**/*.test.ts"],
        },
    },
});
