import {
    combinePresetAndAppleSplashScreens,
    defaultSplashScreenName,
    defineConfig,
    minimal2023Preset as preset,
} from "@vite-pwa/assets-generator/config";

export default defineConfig({
    headLinkOptions: {
        preset: "2023",
    },
    // assets-generator 1.0.2 的檔名產生傳 dark: undefined、head link 卻把 dark
    // 正規化成 boolean，預設命名因此分歧（light- 前綴）造成 link 404；
    // 自訂 name 統一正規化成 boolean，讓檔名與 href 一致。
    preset: combinePresetAndAppleSplashScreens(preset, {
        name: (landscape, size, dark) => defaultSplashScreenName(landscape, size, dark === true),
        resizeOptions: { background: "#0b0c13" },
    }),
    images: ["public/icon.svg"],
});
