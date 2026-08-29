/**
 * Hand a generated file (YAML export, ledger CSV) to the device. On an iOS
 * standalone PWA it arrives via the Files app / share sheet rather than a
 * downloads folder.
 */
export function downloadTextFile(filename: string, content: string, mimeType: string): void {
    const url = URL.createObjectURL(new Blob([content], { type: mimeType }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    // Revoking synchronously races the click on WebKit, which reads the blob async.
    window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
