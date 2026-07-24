import { mount } from "svelte";
// Self-hosted fonts (replaces the Google Fonts <link>): Latin UI text in Plus
// Jakarta Sans, Traditional Chinese in Noto Sans TC. Variable fonts cover the
// whole weight range in one file per unicode-range slice, and the browser only
// fetches the glyph ranges a page actually uses; the service worker caches
// them for offline (vite.config.ts).
import "@fontsource-variable/plus-jakarta-sans/index.css";
import "@fontsource-variable/noto-sans-tc/index.css";
import "./app.css";
import App from "./App.svelte";
import { initTheme } from "./lib/theme.svelte";

// Adopt the stored theme preference and start following the OS. The inline
// script in index.html already set data-theme before paint; this wires up the
// live `prefers-color-scheme` listener and the module's reactive state.
initTheme();

const app = mount(App, {
    target: document.getElementById("app")!,
});

export default app;
