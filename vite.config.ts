import { svelte } from "@sveltejs/vite-plugin-svelte";
import tailwindcss from "@tailwindcss/vite";
import { execSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { readFile } from "node:fs/promises";
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
    type ViteDevServer,
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
// and that address is what Google's OAuth consent screen links to, from outside this repo.
// The build writes it: the finished index.html with PrivacyPolicy.svelte rendered into
// #app and the module script taken out, so it is a static page that keeps the app's
// stylesheet, the pre-paint theme script and the head links, and runs no app code.
// `pnpm dev` answers the same address with the same page, rendered per request, its
// entry swapped for the stylesheet alone (src/styles.ts).
//
// The build renders with a throwaway Vite server built from this same config, so the
// aliases and Svelte settings are the app's own. Only the component is loaded, so
// nothing else in the app has to be importable outside a browser.
function renderPrivacyPage(): Plugin {
    // One word for the address and the file: the hosts answer /privacy with privacy.html.
    const page = "privacy";
    const policyModule = "/src/lib/ui/privacy/PrivacyPolicy.svelte";

    function replaceOnce(html: string, from: RegExp | string, to: string): string {
        const next = html.replace(from, () => to);
        if (next === html) throw new Error(`privacy-page: replacing ${String(from)} changed nothing`);
        return next;
    }

    // The App's page with the policy in it, given a shell whose entry script is already
    // dealt with. The theme-color metas hold the dark default that initTheme() corrects in
    // the App; nothing runs here to correct it, so the browser picks its own instead.
    async function privacyPage(server: ViteDevServer, shell: string): Promise<string> {
        // svelte/server through the same loader: a second copy of svelte's internals fails
        // on a context it never received.
        const { default: Policy } = await server.ssrLoadModule(policyModule) as { default: Component; };
        const { render } = await server.ssrLoadModule("svelte/server") as { render: typeof renderToString; };
        const { head, body } = render(Policy);
        const steps: [RegExp | string, string][] = [
            [/<title>[^<]*<\/title>/, ""],
            ["</head>", `${head}</head>`],
            ['<div id="app"></div>', `<div id="app">${body}</div>`],
        ];
        return steps.reduce((page, [from, to]) => replaceOnce(page, from, to), shell).replace(/<meta name="theme-color"[^>]*>/g, "");
    }

    let resolved: ResolvedConfig;
    return {
        name: "showmeway:privacy-page",
        // After vite:build-html has put the finished index.html into the bundle.
        enforce: "post",
        configResolved(config) {
            resolved = config;
        },
        configureServer(server) {
            const address = `${server.config.base}${page}`;
            const component = path.join(server.config.root, policyModule);
            // The component lives only in the server's module graph, so HMR never tells the
            // page that the policy changed.
            server.watcher.on("change", file => {
                if (file === component) server.ws.send({ type: "full-reload" });
            });
            server.middlewares.use(async (req, res, next) => {
                if (req.url?.split("?")[0] !== address) return next();
                try {
                    const source = await readFile(path.join(server.config.root, "index.html"), "utf8");
                    const shell = await server.transformIndexHtml(req.url, replaceOnce(source, '"/src/main.ts"', '"/src/styles.ts"'));
                    res.setHeader("Content-Type", "text/html");
                    res.end(await privacyPage(server, shell));
                } catch (error) {
                    next(error);
                }
            });
        },
        async generateBundle(_options, bundle) {
            const shell = bundle["index.html"];
            if (shell?.type !== "asset") throw new Error("privacy-page: index.html is not in the bundle");
            const server = await createServer({
                root: resolved.root,
                configFile: resolved.configFile,
                mode: resolved.mode,
                // Not the cache `pnpm dev` serves from: its config hash covers NODE_ENV, so a
                // server sharing it would delete the dev prebundle and write a production one
                // under a running dev server.
                cacheDir: path.join(resolved.cacheDir, "privacy-page"),
                server: { middlewareMode: true, watch: null, hmr: false },
                appType: "custom",
                logLevel: "silent",
            });
            try {
                const source = typeof shell.source === "string" ? shell.source : new TextDecoder().decode(shell.source);
                const html = await privacyPage(server, replaceOnce(source, /<script type="module"[^>]*><\/script>/, ""));
                this.emitFile({ type: "asset", fileName: `${page}.html`, source: html });
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
        renderPrivacyPage(),
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
