import { createLocalStorageStub } from "$lib/testing/stubs";
import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from "vitest";
import {
    initTheme,
    readThemePref,
    resolveTheme,
    setThemePref,
    theme,
    THEME_KEY,
} from "./theme.svelte";

// Stand-ins for --color-bg-main per theme; apply() reads the live value out of
// the stylesheet, so these only need to be distinguishable.
const DARK_CHROME = "#0f172a";
const LIGHT_CHROME = "#ece5d8";

/** Fake `prefers-color-scheme: dark` list whose `matches` can be flipped, and
 *  whose registered change listener can be fired by hand. */
function createMediaStub(matches: boolean) {
    const listeners: ((event: { matches: boolean; }) => void)[] = [];
    const mql = {
        matches,
        addEventListener: (_type: string, fn: (event: { matches: boolean; }) => void) => void listeners.push(fn),
    };
    return {
        mql,
        /** Simulate the OS flipping its appearance. */
        emit(next: boolean) {
            mql.matches = next;
            for (const fn of listeners) fn({ matches: next });
        },
        get listenerCount() {
            return listeners.length;
        },
    };
}

// The module writes straight to <html> and the theme-color metas; node has
// neither, so stand in with the smallest shape it touches. Two metas on
// purpose: production has index.html's plus the one vite-plugin-pwa injects
// from manifest.theme_color, and only updating the first would leave a stale
// value behind.
function createDomStub() {
    const metas = [0, 1].map(() => ({
        content: "",
        setAttribute(_name: string, value: string) {
            this.content = value;
        },
    }));
    return {
        metas,
        document: {
            documentElement: { dataset: {} as Record<string, string> },
            querySelectorAll: () => metas,
        },
    };
}

describe("theme store", () => {
    let storage: ReturnType<typeof createLocalStorageStub>;
    let media: ReturnType<typeof createMediaStub>;
    let dom: ReturnType<typeof createDomStub>;

    function install(osPrefersDark: boolean) {
        media = createMediaStub(osPrefersDark);
        vi.stubGlobal("window", { matchMedia: () => media.mql });
        vi.stubGlobal("document", dom.document);
        // apply() reads --color-bg-main back from the stylesheet instead of
        // holding its own copy of the color; stand in for the cascade by keying
        // off the data-theme it just set.
        vi.stubGlobal("getComputedStyle", () => ({
            getPropertyValue: (prop: string) =>
                prop === "--color-bg-main"
                    ? (dom.document.documentElement.dataset.theme === "light" ? LIGHT_CHROME : DARK_CHROME)
                    : "",
        }));
    }

    beforeEach(() => {
        storage = createLocalStorageStub();
        dom = createDomStub();
        vi.stubGlobal("localStorage", storage);
        install(true);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    describe("readThemePref", () => {
        it("預設為 system", () => {
            expect(readThemePref()).toBe("system");
        });

        it("讀回已儲存的偏好", () => {
            for (const pref of ["system", "dark", "light"] as const) {
                storage.setItem(THEME_KEY, pref);
                expect(readThemePref()).toBe(pref);
            }
        });

        it("無效的值退回 system", () => {
            storage.setItem(THEME_KEY, "neon");
            expect(readThemePref()).toBe("system");
        });

        it("localStorage 讀取拋錯時退回 system（私密瀏覽）", () => {
            vi.stubGlobal("localStorage", {
                getItem: () => {
                    throw new Error("SecurityError");
                },
            });
            expect(readThemePref()).toBe("system");
        });
    });

    describe("resolveTheme", () => {
        it("明確的偏好不看系統設定", () => {
            install(true);
            expect(resolveTheme("light")).toBe("light");
            install(false);
            expect(resolveTheme("dark")).toBe("dark");
        });

        it("system 跟隨 prefers-color-scheme", () => {
            install(true);
            expect(resolveTheme("system")).toBe("dark");
            install(false);
            expect(resolveTheme("system")).toBe("light");
        });
    });

    describe("setThemePref", () => {
        it("持久化偏好並更新 data-theme 與 theme-color", () => {
            setThemePref("light");
            expect(storage.getItem(THEME_KEY)).toBe("light");
            expect(theme.pref).toBe("light");
            expect(theme.resolved).toBe("light");
            expect(dom.document.documentElement.dataset.theme).toBe("light");
            expect(dom.metas.map(m => m.content)).toEqual([LIGHT_CHROME, LIGHT_CHROME]);

            setThemePref("dark");
            expect(theme.resolved).toBe("dark");
            expect(dom.document.documentElement.dataset.theme).toBe("dark");
            expect(dom.metas.map(m => m.content)).toEqual([DARK_CHROME, DARK_CHROME]);
        });

        it("選 system 時解析成當下的系統外觀", () => {
            install(false);
            setThemePref("system");
            expect(theme.pref).toBe("system");
            expect(theme.resolved).toBe("light");
        });

        it("localStorage 寫入拋錯不影響即時切換（配額／私密瀏覽）", () => {
            vi.stubGlobal("localStorage", {
                getItem: () => null,
                setItem: () => {
                    throw new Error("QuotaExceededError");
                },
            });
            expect(() => setThemePref("light")).not.toThrow();
            expect(theme.resolved).toBe("light");
            expect(dom.document.documentElement.dataset.theme).toBe("light");
        });
    });

    describe("initTheme", () => {
        it("採用已儲存的偏好", () => {
            storage.setItem(THEME_KEY, "light");
            install(true); // OS 偏好深色也要被明確的 light 覆蓋
            initTheme();
            expect(theme.pref).toBe("light");
            expect(theme.resolved).toBe("light");
            expect(dom.document.documentElement.dataset.theme).toBe("light");
        });

        it("pref 為 system 時，系統切換會即時跟隨", () => {
            install(true);
            initTheme();
            expect(theme.resolved).toBe("dark");

            media.emit(false);
            expect(theme.resolved).toBe("light");
            expect(dom.document.documentElement.dataset.theme).toBe("light");
            expect(dom.metas.map(m => m.content)).toEqual([LIGHT_CHROME, LIGHT_CHROME]);
        });

        it("pref 為明確值時，系統切換不影響畫面", () => {
            storage.setItem(THEME_KEY, "dark");
            install(true);
            initTheme();

            media.emit(false); // OS 轉淺色
            expect(theme.resolved).toBe("dark");
            expect(dom.document.documentElement.dataset.theme).toBe("dark");
        });

        it("使用者改回 system 後，先前註冊的監聽器會恢復作用", () => {
            storage.setItem(THEME_KEY, "dark");
            install(true);
            initTheme();
            media.emit(false);
            expect(theme.resolved).toBe("dark"); // 被明確偏好鎖住

            setThemePref("system");
            media.emit(false);
            expect(theme.resolved).toBe("light");
        });
    });
});
