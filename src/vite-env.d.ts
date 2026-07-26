// `vite/client` and `vite-plugin-pwa/client` are already in tsconfig.app.json's
// `types`, so this file only has to declare what vite.config.ts injects.
declare const __APP_VERSION__: string;
declare const __BUILD_TIME__: string;
