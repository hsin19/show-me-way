import {
    expect,
    test,
} from "./fixtures";

// dist/privacy.html is written by the build (prerenderPrivacyPage in vite.config.ts), so
// only the built app has it, and only a fetch that runs no script can tell whether it
// carries the policy or an empty app shell. That fetch is what a link checker, a crawler
// or the review of Google's consent screen gets, and `request` makes exactly that one.
test("隱私權政策網址的原始 HTML 不靠腳本就帶著標題與本文", async ({ request }) => {
    const response = await request.get("/privacy");
    expect(response.ok()).toBe(true);
    const html = await response.text();

    expect(html).toContain("<title>隱私權政策 (Privacy Policy) - ShowMeWay</title>");
    // One anchor from each thing a reviewer looks for: the Limited Use statement, the
    // scopes it covers, and the disclosure of what leaves the device.
    expect(html).toContain("Limited Use requirements");
    expect(html).toContain("https://www.googleapis.com/auth/drive.file");
    expect(html).toContain("加密分享連結");
});
