import { defineConfig } from "vitest/config";

// Standalone test config so the app's Vite/PWA plugins aren't loaded for unit tests.
export default defineConfig({
    test: {
        include: ["src/**/*.test.ts"],
        environment: "node",
    },
});
