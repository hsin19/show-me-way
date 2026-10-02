// The App's look without the App: main.ts imports it, and so does the privacy page
// `pnpm dev` serves (vite.config.ts), which has to look like the built one.
//
// Self-hosted rather than a Google Fonts <link>, so the service worker can cache
// them for offline. Variable fonts, so one file per unicode-range slice covers
// every weight and the browser fetches only the glyph ranges a page uses.
import "@fontsource-variable/plus-jakarta-sans/index.css";
import "@fontsource-variable/noto-sans-tc/index.css";
import "./app.css";
