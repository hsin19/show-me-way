// Stands in for `virtual:pwa-register` under the app tests (aliased in vitest.config.ts):
// the module only exists inside a Vite build with vite-plugin-pwa, and happy-dom has no
// service worker to register anyway.
export function registerSW(): (reloadPage?: boolean) => Promise<void> {
    return () => Promise.resolve();
}
