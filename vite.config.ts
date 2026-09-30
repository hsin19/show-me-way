import { svelte } from "@sveltejs/vite-plugin-svelte";
import tailwindcss from "@tailwindcss/vite";
import { execSync } from "node:child_process";
import { realpathSync } from "node:fs";
import path from "node:path";
import {
    fileURLToPath,
    URL,
} from "node:url";
import type { Component } from "svelte";
import type { render as renderToString } from "svelte/server";
import {
    createServer,
    defineConfig,
    type Plugin,
    type ResolvedConfig,
} from "vite";
import { VitePWA } from "vite-plugin-pwa";

const basePath = process.env.BASE_PATH?.replace(/^\/+|\/+$/g, "");
const base = basePath ? `/${basePath}/` : "/";

// CI passes the commit via VITE_GIT_SHA (github.sha); local builds fall back to
// the short SHA. __BUILD_TIME__ stays a raw UTC ISO string — the frontend formats
// it in the viewer's local timezone.
function resolveGitSha(): string {
    const fromEnv = process.env.VITE_GIT_SHA;
    if (fromEnv) return fromEnv.slice(0, 7);
    try {
        // stderr silenced: outside a git checkout this throws anyway, and the
        // raw "fatal: not a git repository" would just be noise in the log.
        return execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] })
            .toString()
            .trim();
    } catch {
        return "dev";
    }
}

// Vite keeps public/ out of the module graph and only notices files being added
// or removed there, so editing the itinerary a device without a saved trip falls
// back to never reloads the page. The symlink is re-resolved on every event
// because `trip:sync checkout` repoints it. A trip saved in localStorage still
// wins over these files after the reload (fetchItinerary).
function reloadOnItineraryEdit(): Plugin {
    const publicDir = fileURLToPath(new URL("./public", import.meta.url));
    const localLink = path.join(publicDir, "itinerary.local.yaml");
    const bundled = path.join(publicDir, "itinerary.yaml");
    return {
        name: "showmeway:reload-on-itinerary-edit",
        apply: "serve",
        configureServer(server) {
            server.watcher.on("all", (_event, file) => {
                let target: string | null;
                try {
                    target = realpathSync(localLink);
                } catch {
                    target = null;
                }
                if (file === localLink || file === bundled || file === target) server.ws.send({ type: "full-reload" });
            });
        },
    };
}

// Cloudflare Pages and GitHub Pages both answer /privacy with a file named privacy.html,
// so the build writes one: index.html with the policy's own <title> and its text in a
// <noscript>. The app still boots from it and renders the route on the client; the text
// is for readers that run no script — a link checker, a crawler, the review of the Google
// consent screen's privacy link — which would otherwise get an empty app shell.
//
// The text is rendered by a throwaway Vite server built from this same config, so the
// aliases and Svelte settings are the app's own. PrivacyPolicy.svelte therefore has to
// render without a browser, and the build fails rather than ship a page without its text.
function prerenderPrivacyPage(): Plugin {
    let resolved: ResolvedConfig;
    return {
        name: "showmeway:prerender-privacy",
        // The nested server below is a `serve`, so the plugin cannot start itself again.
        apply: "build",
        // After vite:build-html has put the finished index.html into the bundle.
        enforce: "post",
        configResolved(config) {
            resolved = config;
        },
        async generateBundle(_options, bundle) {
            const shell = bundle["index.html"];
            if (shell?.type !== "asset") throw new Error("prerender-privacy: index.html is not in the bundle");
            const server = await createServer({
                root: resolved.root,
                configFile: resolved.configFile,
                mode: resolved.mode,
                server: { middlewareMode: true, watch: null, hmr: false },
                appType: "custom",
                logLevel: "silent",
            });
            try {
                // Both through the server's loader: rendered by a second copy of svelte's
                // internals, the page fails on a context it never received.
                const page = await server.ssrLoadModule("/src/lib/ui/privacy/PrivacyPolicy.svelte") as {
                    default: Component<{ onBack: () => void; }>;
                    PRIVACY_TITLE: string;
                };
                const { render } = await server.ssrLoadModule("svelte/server") as { render: typeof renderToString; };
                const { body } = render(page.default, { props: { onBack: () => {} } });

                const source = typeof shell.source === "string" ? shell.source : new TextDecoder().decode(shell.source);
                const titled = source.replace(/<title>[^<]*<\/title>/, () => `<title>${page.PRIVACY_TITLE}</title>`);
                const html = titled.replace('<div id="app"></div>', () => `<div id="app"></div>\n        <noscript>${body}</noscript>`);
                if (titled === source || html === titled) throw new Error('prerender-privacy: index.html no longer has a <title> and a <div id="app">');
                this.emitFile({ type: "asset", fileName: "privacy.html", source: html });
            } finally {
                await server.close();
            }
        },
    };
}

const appVersion = resolveGitSha();
const buildTime = new Date().toISOString();

export default defineConfig({
    base,
    resolve: {
        alias: {
            $lib: fileURLToPath(new URL("./src/lib", import.meta.url)),
        },
    },
    define: {
        __APP_VERSION__: JSON.stringify(appVersion),
        __BUILD_TIME__: JSON.stringify(buildTime),
    },
    // A fixed, app-specific port keeps this app's localStorage on its own origin
    // (storage is keyed by host:port), so dev data never collides with another
    // Vite app on the default 5173. strictPort fails loudly instead of silently
    // hopping to a shared port, which would defeat that isolation. 8045 derives
    // from this repo's first commit hash (804c50f7…) — a stable, low-collision
    // scheme so each project stays on its own origin.
    server: {
        port: 8045,
        strictPort: true,
        fs: {
            // An allowlist: the page needs its source, public/ and its dependencies (the
            // self-hosted fonts are read out of node_modules), and nothing else at the root may
            // go out — least of all trip:sync's refresh token and Drive token cache in
            // .trip-sync/. public/itinerary.local.yaml, a symlink into there, still reaches the
            // page: the public-dir handler serves it without consulting this list.
            allow: ["src", "public", "node_modules"],
        },
    },
    preview: {
        port: 8046,
        strictPort: true,
    },
    plugins: [
        reloadOnItineraryEdit(),
        svelte(),
        tailwindcss(),
        prerenderPrivacyPage(),
        VitePWA({
            // "prompt": the new service worker waits until the user accepts the
            // in-app update banner, instead of taking over a page in active use.
            registerType: "prompt",
            pwaAssets: {
                disabled: false,
                config: true,
            },
            manifest: {
                id: base,
                lang: "zh-TW",
                dir: "ltr",
                name: "下面一way 行程小助手",
                short_name: "下面一way",
                description: "下面一way！你的旅行行程離線隨身小助手",
                categories: ["travel", "navigation"],
                background_color: "#0f172a",
                theme_color: "#0f172a",
                display: "standalone",
                orientation: "portrait",
            },
            workbox: {
                // Data files are enumerated exactly instead of *.yaml/*.json so
                // that files dropped into public/ later do not silently enter
                // every user's precache. woff2 deliberately stays out: fonts go
                // through the runtimeCaching route below.
                globPatterns: ["**/*.{js,css,html,svg,png,ico,webp}", "itinerary.yaml"],
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
