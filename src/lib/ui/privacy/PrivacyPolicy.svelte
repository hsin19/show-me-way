<script lang="ts">
import {
    hopBaseUrl,
    REPO_URL,
    SITE_URL,
} from "$lib/config";
import ChevronLeft from "@lucide/svelte/icons/chevron-left";

// Rendered only on the server, into privacy.html by the build and per request by
// `pnpm dev` (vite.config.ts) — the page Google's OAuth consent screen links to. Nothing
// in the App mounts it, so it gets no props and runs no script on the client, and a
// <style> block would reach neither the app's stylesheet nor the page: Tailwind and
// app.css only.
//
// The text reads as a policy rather than as app copy: bilingual headings, and the
// Limited Use statement in section 3. The places that say the itinerary leaves the
// device (here, the README, the share toasts and the editor note in 行程管理) have to
// agree with what sync and the short link actually upload.

const hopHost = new URL(hopBaseUrl()).host;
</script>

<svelte:head>
    <title>隱私權政策 (Privacy Policy) - ShowMeWay</title>
</svelte:head>

<!-- Only the card scrolls, so 回到 App stays on screen however far down the reader is. The
     page is the whole document, so it takes the height App.svelte's shell does, for the
     installed-PWA reason written there. -->
<div class="h-dvh standalone:h-screen max-w-3xl mx-auto w-full flex flex-col px-5 pt-[calc(8px+var(--safe-top))] pb-[calc(20px+var(--safe-bottom))]">
    <a
        href={import.meta.env.BASE_URL}
        class="
            shrink-0 self-start -ml-2 mb-2 min-h-[44px] px-2 inline-flex items-center gap-1 rounded-xl
            text-xs font-bold text-text-secondary hover:text-text-primary transition-colors
        "
    >
        <ChevronLeft size={16} aria-hidden="true" />回到 App
    </a>

    <article
        class="
            panel rounded-2xl p-5 flex-1 min-h-0 overflow-y-auto overscroll-contain text-sm leading-relaxed text-text-secondary break-words
            [&_h2]:mt-8 [&_h2]:mb-2 [&_h2]:text-base [&_h2]:font-bold [&_h2]:text-text-primary
            [&_section>p]:my-2 [&_section>ul]:my-2 [&_section>ul]:list-disc [&_section>ul]:space-y-2 [&_section>ul]:pl-5
            [&_strong]:font-semibold [&_strong]:text-text-primary
            [&_a]:text-accent [&_a]:underline [&_a]:underline-offset-2
            [&_code]:rounded [&_code]:bg-tint-2 [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[0.9em] [&_code]:text-accent
        "
    >
        <header class="border-b border-line-faint pb-4">
            <h1 class="text-xl font-extrabold tracking-tight text-text-primary">ShowMeWay 隱私權政策 (Privacy Policy)</h1>
            <p class="mt-1 text-xs text-text-muted">最後更新日期 (Last Updated)：2026 年 9 月</p>
        </header>

        <section>
            <h2>1. 簡介 (Introduction)</h2>
            <p>
                歡迎使用 <strong>ShowMeWay</strong>（以下簡稱「本應用程式」，網址：<a href={SITE_URL}>{SITE_URL}</a>）。 本應用程式是一款以純前端運行為主的旅行行程輔助漸進式網頁應用（PWA）；唯一的第一方後端是產生分享連結時使用的加密短連結服務，詳見第 4 節。我們非常重視您的個人隱私，並致力於保護您的個人資料安全。
            </p>
        </section>

        <section>
            <h2>2. 資料收集與儲存方式 (Data Collection & Storage)</h2>
            <div class="my-3 rounded-lg border border-line-faint bg-well p-3">
                <strong>重點承諾：</strong>您的行程資料預設完整儲存在您自己的裝置上。我們<strong>不會收集、記錄或追蹤</strong>您的個人資料與行程內容；<strong>行程資料</strong>只有在您<strong>主動</strong>使用分享連結、Google 雲端硬碟同步或 AI 功能時才會離開您的裝置（天氣查詢與新版本檢查除外，見下方說明），其中分享連結的內容<strong>在離開裝置前已於您的瀏覽器完成加密</strong>。
            </div>
            <ul>
                <li>
                    <strong>本機儲存 (Local Storage)：</strong>您的所有行程資料（YAML）、待辦與行李清單及個人偏好設定，均僅儲存在您裝置的瀏覽器本機儲存空間（<code>localStorage</code>）中。
                </li>
                <li>
                    <strong>不進行非必要的資料轉移：</strong>除了您主動啟用的 Google 雲端硬碟同步、AI 功能，以及您主動產生的加密分享連結外，本應用程式不會將行程資料傳送至外部伺服器。您沒有操作時，App 只會自動做兩種查詢：行程填了城市時，開啟 App 會向 Open-Meteo 查詢天氣（只送出城市名稱與座標，見第 4 節）；已連線 Google 雲端硬碟，或匯入過別人的分享連結時，開啟 App 會向 Google 或短連結服務查詢有沒有新版本。後者只是查詢，不會上傳行程，套用新版本與上傳都要由您按下才會進行。
                </li>
            </ul>
        </section>

        <section>
            <h2>3. Google 帳號與 Google Drive 授權聲明 (Google API & OAuth)</h2>
            <p>當您選擇使用「Google Drive 雲端同步」功能時，本應用程式會請求以下必要的 Google 權限：</p>
            <ul>
                <li>
                    <code>https://www.googleapis.com/auth/drive.file</code>：僅用於在您自己的 Google Drive 建立與管理名為 <code>ShowMeWay</code> 的專屬資料夾，以備份及同步您的行程檔案。<strong>本應用程式無法且絕不會存取您雲端硬碟中的其他非本應用程式建立的檔案。</strong>
                </li>
                <li>
                    <code>https://www.googleapis.com/auth/userinfo.email</code> 與 <code>https://www.googleapis.com/auth/userinfo.profile</code>：僅用於在應用程式介面中顯示您目前登入的 Google 帳號名稱與頭像，以方便您確認同步狀態。
                </li>
            </ul>
            <div class="my-3 rounded-lg border border-line-faint bg-well p-3">
                <strong>Google API 政策遵循聲明 (Google API Services User Data Policy Compliance)：</strong><br>
                ShowMeWay's use and transfer to any other app of information received from Google APIs will adhere to the <a href="https://developers.google.com/terms/api-services-user-data-policy" target="_blank" rel="noopener noreferrer">Google API Services User Data Policy</a>, including the Limited Use requirements.
            </div>
        </section>

        <section>
            <h2>4. 第三方服務與外部 API (Third-Party Services)</h2>
            <ul>
                <li>
                    <strong>Google Gemini API (可選)：</strong>若您自行在設定中填入個人 Gemini API Key 使用 AI 助手功能，對話與行程修改請求將直接由您的瀏覽器端發送至 Google Gemini 官方 API 端點，不經由任何第三方轉發。每次請求都會附上目前完整的行程內容（包含您填寫的訂位代碼、姓名與地址等）作為背景資料；Google 如何處理這些內容，依您所使用的 API 金鑰所屬方案的條款而定。
                </li>
                <li>
                    <strong>天氣資訊 (Open-Meteo)：</strong>行程填了城市時，開啟 App 會自動根據城市名稱，向公開的 Open-Meteo API 查詢天氣預報；送出的只有城市名稱與該城市的座標，不含行程內容與日期。本應用程式<strong>不會</strong>要求或存取您的裝置 GPS 定位權限，查詢過程亦不包含任何使用者個人資訊。
                </li>
            </ul>

            <h2>加密分享連結 (Encrypted Share Links)</h2>
            <p>
                當您主動點選「分享行程」時，行程內容會先在您的瀏覽器中以 <code>AES-GCM</code> 128 位元金鑰加密，<strong>僅有加密後的密文</strong>會上傳至我們自行運作的短連結服務（<code>{hopHost}</code>）以換取一組短代碼。
            </p>
            <div class="my-3 rounded-lg border border-line-faint bg-well p-3">
                <strong>解密金鑰只存在於連結網址的片段</strong>（<code>#</code> 之後的部分）。依照瀏覽器規範，網址片段不會隨任何網路請求送出，因此該短連結服務及其 CDN 只會看到<strong>無法解讀的密文</strong>。<br><br>
                相對地，這也代表<strong>任何取得完整連結的人都能解密並讀取該行程</strong>，請只分享給您信任的對象。
            </div>
            <ul>
                <li>
                    每趟行程只有一條分享連結：再次點選「分享行程」時，會以<strong>同一把金鑰</strong>重新加密目前的行程，並覆寫服務上同一組短代碼的密文，因此已分享出去的連結與 QR code 會顯示最新版本。為了做到這點，您的瀏覽器會在本機保存該連結的短代碼、金鑰與一組僅供覆寫或刪除密文的更新憑證；這些資料<strong>不會寫進行程檔</strong>，因此不會隨匯出、分享給他人的行程內容或 AI 助手離開裝置。若您啟用 Google 雲端硬碟同步，它們會以檔案屬性（<code>appProperties</code>）存放在您自己 Drive 中的該行程檔案上（<strong>不在檔案內容裡</strong>），好讓您的其他裝置更新同一條連結，而不是各自產生一條；該檔案本來就存有您的完整行程，且此屬性僅本應用程式讀得到。
                </li>
                <li>
                    密文會在最後一次更新後 <strong>一年</strong>自動刪除，屆時該連結將失效。您也可以隨時在「行程管理」撤銷分享連結，服務上的密文會立即刪除。<strong>刪除行程或重置本機資料不會撤銷分享連結</strong>：這台裝置會忘記更新憑證，之後無法再更新或撤銷，已分享出去的連結會維持最後一版，直到一年後自動失效；若要先讓連結失效，請在刪除前先撤銷。
                </li>
                <li>
                    當您<strong>開啟</strong>一條分享連結時，瀏覽器會向該服務請求對應的密文，其伺服器紀錄可能包含您的 IP 位址與存取時間。
                </li>
                <li>
                    當您<strong>匯入</strong>別人分享給您的行程時，您的瀏覽器會在本機保存該連結的短代碼與金鑰，好讓本應用程式日後能主動檢查對方是否更新了行程並詢問您要不要套用；這組資料<strong>只留在您的裝置上</strong>，也不包含任何可以覆寫或刪除對方密文的憑證。您刪除該行程時，這筆紀錄會一併移除。
                </li>
                <li>若該服務暫時無法連線，本應用程式會自動改用不經過任何伺服器的完整連結（網址較長）。</li>
            </ul>
        </section>

        <section>
            <h2>5. 資料刪除與權限撤銷 (Data Deletion & Revocation)</h2>
            <ul>
                <li>
                    <strong>清除本機資料：</strong>您可隨時透過本應用程式「設定」中的「重置全部本機資料」功能，或直接清除瀏覽器快取與儲存空間，即可徹底刪除裝置上的所有資料。
                </li>
                <li>
                    <strong>撤銷 Google 授權：</strong>在應用程式設定中點擊「登出」只會清除這台裝置上的登入狀態；要撤銷 ShowMeWay 的存取授權，請前往 <a href="https://myaccount.google.com/permissions" target="_blank" rel="noopener noreferrer">Google 帳戶安全性設定</a>。
                </li>
            </ul>
        </section>

        <section>
            <h2>6. 聯絡開發者 (Contact Us)</h2>
            <p>若您對本隱私權政策或 ShowMeWay 有任何疑問或建議，歡迎透過以下方式聯絡開發者：</p>
            <ul>
                <li>開發者：Eric Yeh</li>
                <li>電子郵件 (Email)：<a href="mailto:eric91343@gmail.com">eric91343@gmail.com</a></li>
                <li>專案原始碼 (GitHub)：<a href={REPO_URL} target="_blank" rel="noopener noreferrer">{REPO_URL}</a></li>
            </ul>
        </section>

        <footer class="mt-8 border-t border-line-faint pt-4 text-center text-xs text-text-muted">
            &copy; 2026 ShowMeWay. All rights reserved.
        </footer>
    </article>
</div>
