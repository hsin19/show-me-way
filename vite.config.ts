import { svelte } from "@sveltejs/vite-plugin-svelte";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

// https://vite.dev/config/
export default defineConfig({
    base: "/show-me-way/",
    // A fixed, app-specific port keeps this app's localStorage on its own origin
    // (storage is keyed by host:port), so dev data never collides with another
    // Vite app on the default 5173. strictPort fails loudly instead of silently
    // hopping to a shared port, which would defeat that isolation. 8045 derives
    // from this repo's first commit hash (804c50f7…) — a stable, low-collision
    // scheme so each project stays on its own origin.
    server: {
        port: 8045,
        strictPort: true,
    },
    preview: {
        port: 8046,
        strictPort: true,
    },
    plugins: [
        svelte(),
        tailwindcss(),
        VitePWA({
            // "prompt": the new service worker waits until the user accepts the
            // in-app update banner, instead of taking over a page in active use.
            registerType: "prompt",
            pwaAssets: {
                disabled: false,
                config: true,
            },
            manifest: {
                id: "/show-me-way/",
                lang: "zh-TW",
                dir: "ltr",
                name: "下面一way 行程小助手",
                short_name: "下面一way",
                description: "下面一way！你的旅行行程離線隨身小助手",
                categories: ["travel", "navigation"],
                background_color: "#0b0c13",
                theme_color: "#0b0c13",
                display: "standalone",
                orientation: "portrait",
            },
            workbox: {
                // Data files are enumerated exactly instead of *.yaml/*.json so
                // that files dropped into public/ later do not silently enter
                // every user's precache. woff2 deliberately stays out: fonts go
                // through the runtimeCaching route below.
                globPatterns: ["**/*.{js,css,html,svg,png,ico,webp}", "itinerary.yaml", "showmeway-schema.json"],
                // itinerary.local.yaml is personal, untracked data that local
                // builds copy into dist/ — it must never enter the precache
                // manifest. The runtime route below caches it from the second
                // online visit onward (the first-visit page is not yet
                // controlled by the service worker). Apple splash screens are
                // huge PNGs only ever fetched at install time, so they are
                // kept out of the precache as well.
                globIgnores: ["**/itinerary.local*.yaml", "**/apple-splash-*.png"],
                cleanupOutdatedCaches: true,
                // The SPA navigation fallback (navigateFallback defaults to
                // index.html) otherwise hijacks navigations to raw data files
                // and serves the app shell instead. Let .yaml/.json navigations
                // hit the network so they can be opened directly in the browser.
                navigateFallbackDenylist: [/\.ya?ml$/i, /\.json$/i],
                runtimeCaching: [
                    {
                        // Catches itinerary.local.yaml (excluded from precache
                        // above); precached YAML is served before this route.
                        urlPattern: ({ sameOrigin, url }) => sameOrigin && /\.ya?ml$/i.test(url.pathname),
                        handler: "NetworkFirst",
                        options: {
                            cacheName: "itinerary-yaml",
                            networkTimeoutSeconds: 5,
                            cacheableResponse: { statuses: [0, 200] },
                        },
                    },
                    {
                        // Self-hosted fonts: Noto Sans TC is 100+ unicode-range
                        // slices fetched on demand, so the files stay out of the
                        // precache (size) and get cached as they are used. Hashed
                        // filenames make CacheFirst safe; no maxEntries, because
                        // eviction would punch holes in offline rendering.
                        urlPattern: ({ sameOrigin, url }) => sameOrigin && /\.woff2?$/i.test(url.pathname),
                        handler: "CacheFirst",
                        options: {
                            cacheName: "app-fonts",
                            expiration: { maxAgeSeconds: 60 * 60 * 24 * 365 },
                            cacheableResponse: { statuses: [0, 200] },
                        },
                    },
                ],
            },
            devOptions: {
                enabled: false,
                navigateFallback: "index.html",
                suppressWarnings: true,
                type: "module",
            },
        }),
    ],
});
