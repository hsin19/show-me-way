import { mount } from "svelte";
import "./styles";
import { initTheme } from "$lib/stores/theme.svelte";
import App from "./App.svelte";

// Before mount, so no component ever renders against an unresolved theme.
initTheme();

const app = mount(App, {
    target: document.getElementById("app")!,
});

export default app;
