import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vitest/config";

// Standalone test config so the app's Vite/PWA plugins aren't loaded for unit tests.
// The svelte plugin is still required to compile $state runes in .svelte.ts modules.
export default defineConfig({
    plugins: [svelte()],
    test: {
        include: ["src/**/*.test.ts"],
        environment: "node",
    },
});
