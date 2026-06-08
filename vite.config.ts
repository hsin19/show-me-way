import { svelte } from "@sveltejs/vite-plugin-svelte";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

// https://vite.dev/config/
export default defineConfig({
    base: "/show-me-way/",
    plugins: [
        svelte(),
        tailwindcss(),
        VitePWA({
            registerType: "autoUpdate",
            pwaAssets: {
                disabled: false,
                config: true,
            },
            manifest: {
                name: "下面一way 行程小助手",
                short_name: "下面一way",
                description: "下面一way！你的旅行行程離線隨身小助手",
                background_color: "#0a0b10",
                theme_color: "#0a0b10",
                display: "standalone",
                orientation: "portrait",
            },
            workbox: {
                globPatterns: ["**/*.{js,css,html,svg,png,ico,webp}"],
                cleanupOutdatedCaches: true,
                // The SPA navigation fallback (navigateFallback defaults to
                // index.html) otherwise hijacks navigations to raw data files
                // and serves the app shell instead. Let .yaml/.json navigations
                // hit the network so they can be opened directly in the browser.
                navigateFallbackDenylist: [/\.ya?ml$/i, /\.json$/i],
            },
            devOptions: {
                enabled: false,
                navigateFallback: "index.html",
                suppressWarnings: true,
                type: "module",
            },
        }),
    ],
    resolve: {
        alias: {
            "@": path.resolve(__dirname, "./src"),
        },
    },
});
