import {
    combinePresetAndAppleSplashScreens,
    defaultSplashScreenName,
    defineConfig,
    minimal2023Preset as preset,
} from "@vite-pwa/assets-generator/config";

// icon.svg 是滿版方形、底色畫在圖裡，iOS 與 Android 各自套圓角或圓形遮罩；
// 產生器預設替 apple / maskable 補 30% 白邊，主畫面會變成白框裡一顆小圖。
// 圖形收在中心 80% 的圓內，maskable 不補邊也不會被裁到。
const fullBleed = { padding: 0, resizeOptions: { background: "#0f172a" } };

export default defineConfig({
    headLinkOptions: {
        preset: "2023",
    },
    // assets-generator 1.0.2 的檔名產生傳 dark: undefined、head link 卻把 dark
    // 正規化成 boolean，預設命名因此分歧（light- 前綴）造成 link 404；
    // 自訂 name 統一正規化成 boolean，讓檔名與 href 一致。
    preset: combinePresetAndAppleSplashScreens({
        transparent: { ...preset.transparent, ...fullBleed },
        maskable: { ...preset.maskable, ...fullBleed },
        apple: { ...preset.apple, ...fullBleed },
    }, {
        name: (landscape, size, dark) => defaultSplashScreenName(landscape, size, dark === true),
        // 與 icon 底色相同，方形邊緣才會融進啟動畫面，只露出中間的路標。
        resizeOptions: { background: "#0f172a" },
    }),
    images: ["public/icon.svg"],
});
