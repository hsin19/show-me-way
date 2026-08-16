import { mount } from "svelte";
// Self-hosted rather than a Google Fonts <link>, so the service worker can cache
// them for offline. Variable fonts, so one file per unicode-range slice covers
// every weight and the browser fetches only the glyph ranges a page uses.
import "@fontsource-variable/plus-jakarta-sans/index.css";
import "@fontsource-variable/noto-sans-tc/index.css";
import "./app.css";
import App from "./App.svelte";
import { initTheme } from "./lib/theme.svelte";

// Before mount, so no component ever renders against an unresolved theme.
initTheme();

const app = mount(App, {
    target: document.getElementById("app")!,
});

export default app;
