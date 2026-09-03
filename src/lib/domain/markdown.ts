/**
 * Inline Markdown for itinerary prose: `[label](href)`, `**strong**`, `*em*`,
 * `***both***`, `` `code` ``, a `\` escape for their delimiters — and nothing
 * else. No block level (the field is already one line of a YAML list) and no raw
 * HTML, ever.
 *
 * The output is a node tree rather than an HTML string because share links import
 * *other people's* YAML: rendering a stranger's prose through `{@html}` would
 * hand them script execution on the importer's device. `RichText.svelte` walks
 * the tree with ordinary interpolation, so there is no escaping step to get
 * wrong, and `sanitizeHref` closes the other half of the hole.
 *
 * Bare URLs are deliberately not auto-linked — a URL makes a poor link label, so
 * authors write `[官方售票頁](https://…)`.
 */

export type InlineNode =
    | { type: "text"; value: string; }
    | { type: "code"; value: string; }
    | { type: "strong"; children: InlineNode[]; }
    | { type: "em"; children: InlineNode[]; }
    | { type: "link"; href: string; children: InlineNode[]; };

/** Characters `\` may escape, so prose can contain a literal delimiter. */
const ESCAPABLE = "\\`*[]()";

/**
 * A scheme, if the target names one. `.` is deliberately outside the class:
 * no real scheme carries a dot, and allowing one would read `example.com:8443`
 * as a scheme rather than as a host and port.
 */
const SCHEME = /^([a-z][a-z0-9+-]*):/i;

/** Schemes a Markdown link in prose may point at. */
const PROSE_SCHEMES = ["http", "https", "mailto"];

/**
 * Schemes an author-labeled chip (`links[].url`, `mapLink`) may point at. The
 * extra three hand the target to the phone instead of opening a page, which is
 * what an itinerary wants — a restaurant's number, a meeting point's coordinates.
 * App deep links (`line:`, `kakaomap:`) are absent on purpose: add one when a
 * trip needs it, so this stays an allowlist rather than rotting into "everything
 * except the bad ones".
 */
const CHIP_SCHEMES = [...PROSE_SCHEMES, "tel", "sms", "geo"];

/**
 * The one schemeless form worth reading as `https://…`: a dotted host with an
 * optional numeric port. Checked label by label rather than by one regex so the
 * rules stay legible — notably, a purely numeric last label means this is a
 * number (`56.23`), not a destination.
 */
function isBareDomain(target: string): boolean {
    const authority = target.split(/[/?#]/, 1)[0] ?? "";
    const [host = "", port, ...extra] = authority.split(":");
    if (extra.length > 0 || (port !== undefined && !/^\d+$/.test(port))) return false;
    const labels = host.split(".");
    // A backslash is excluded with `@`: browsers fold it into `/` inside an
    // authority, so `\\evil.com` would resolve somewhere other than it reads.
    if (labels.length < 2 || labels.some(label => !label || /[\\@]/.test(label))) return false;
    return !/^\d+$/.test(labels[labels.length - 1] ?? "");
}

function sanitize(raw: unknown, allowed: readonly string[]): string | null {
    // Not typed `string`, because the fields these guard are user YAML that
    // `normalizeTripData` cannot promise anything about on an older save.
    if (typeof raw !== "string") return null;
    const href = raw.trim();
    if (!href || /\s/.test(href)) return null;
    if ([...href].some(ch => ch.charCodeAt(0) < 0x20 || ch.charCodeAt(0) === 0x7f)) return null;

    const scheme = SCHEME.exec(href)?.[1]?.toLowerCase();
    if (scheme) {
        if (!allowed.includes(scheme)) return null;
        // `https:`, `http://` and `mailto:` name a scheme and no destination.
        return href.slice(scheme.length + 1).replace(/^\/\//, "") ? href : null;
    }
    if (href.startsWith("//")) return isBareDomain(href.slice(2)) ? `https:${href}` : null;
    return isBareDomain(href) ? `https://${href}` : null;
}

/**
 * A safe absolute URL for a link in prose, or null — meaning the caller leaves
 * the whole `[…](…)` as literal text. Only `http(s)`, `mailto` and bare domains
 * survive. Anything with whitespace or control characters is rejected outright:
 * in an href those only appear in attempts to smuggle a scheme past the check.
 * A root-relative path, fragment or query is not a destination in someone else's
 * itinerary either — there is nothing on this origin to point at.
 */
export function sanitizeHref(raw: unknown): string | null {
    return sanitize(raw, PROSE_SCHEMES);
}

/**
 * The same guard for an href the author labeled themselves (`links[].url`,
 * `mapLink`), which may also be `tel:` / `sms:` / `geo:`. Prose stays on the
 * narrower list: a sentence in an imported trip has no business dialing anything.
 */
export function sanitizeLinkHref(raw: unknown): string | null {
    return sanitize(raw, CHIP_SCHEMES);
}

function isBlank(c: string | undefined): boolean {
    return c === undefined || /\s/.test(c);
}

/**
 * Emphasis needs some flanking rule, or `3 * 4 * 5` turns italic — but
 * CommonMark's leans on word boundaries Chinese does not have. What survives
 * translation is "no whitespace just inside either delimiter": `**5"×9"×1" 以內**`
 * keeps working with no spaces anywhere, spaced-out arithmetic stays arithmetic.
 *
 * Asterisk runs are measured and stepped over whole, which is what keeps a `**`
 * inside a `*…*` from half-matching, and what leaves `卡號 ****1234` its
 * asterisks instead of eating them into an empty `<strong>` (hence `i > from`
 * too — a closer at the opening delimiter is an empty span, not a match).
 *
 * Code spans and link targets are skipped for the same reason they win in
 * `parse`: their contents are not markup. Otherwise `` **注意 `a**b` 結束** ``
 * would close the bold inside the code span, and a `*` in a URL would tear the
 * anchor in half.
 */
function findEmphasisCloser(src: string, from: number, len: number): number {
    for (let i = from; i < src.length; i++) {
        if (src[i] === "\\") {
            i++;
            continue;
        }
        if (src[i] === "`") {
            const end = src.indexOf("`", i + 1);
            if (end > i + 1) {
                i = end;
                continue;
            }
        }
        if (src[i] === "[") {
            const labelEnd = findMatching(src, i + 1, "[", "]");
            if (labelEnd !== -1 && src[labelEnd + 1] === "(") {
                const hrefEnd = findMatching(src, labelEnd + 2, "(", ")");
                if (hrefEnd !== -1) {
                    i = hrefEnd;
                    continue;
                }
            }
        }
        if (src[i] !== "*") continue;
        let run = 1;
        while (src[i + run] === "*") run++;
        if (run === len && i > from && !isBlank(src[i - 1])) return i;
        i += run - 1;
    }
    return -1;
}

/**
 * A link's label gets its escapes dropped for free by going through `parse`; its
 * href does not, and leaving the slashes in sends `[x](https://a.com/p\(1\))` —
 * the one form the escape exists for — somewhere other than it reads.
 */
function unescapeDelimiters(src: string): string {
    let out = "";
    for (let i = 0; i < src.length; i++) {
        if (src[i] === "\\" && ESCAPABLE.includes(src[i + 1] ?? "")) i++;
        out += src[i];
    }
    return out;
}

/** Scans a bracketed run, honoring nesting and escapes. Returns the closer's index, or -1. */
function findMatching(src: string, from: number, open: string, close: string): number {
    let depth = 1;
    for (let i = from; i < src.length; i++) {
        const c = src[i];
        if (c === "\\") {
            i++;
            continue;
        }
        if (c === open) depth++;
        else if (c === close && --depth === 0) return i;
    }
    return -1;
}

function parse(src: string, allowLink: boolean): InlineNode[] {
    const out: InlineNode[] = [];
    let buf = "";
    let i = 0;

    const flush = () => {
        if (buf) {
            out.push({ type: "text", value: buf });
            buf = "";
        }
    };

    while (i < src.length) {
        const c = src[i];
        const next = src[i + 1];

        if (c === "\\" && next !== undefined && ESCAPABLE.includes(next)) {
            buf += next;
            i += 2;
            continue;
        }

        // Code spans win over everything else: their content is literal.
        if (c === "`") {
            const end = src.indexOf("`", i + 1);
            if (end > i + 1) {
                flush();
                out.push({ type: "code", value: src.slice(i + 1, end) });
                i = end + 1;
                continue;
            }
        }

        if (c === "[" && allowLink) {
            const labelEnd = findMatching(src, i + 1, "[", "]");
            if (labelEnd !== -1 && src[labelEnd + 1] === "(") {
                const hrefEnd = findMatching(src, labelEnd + 2, "(", ")");
                if (hrefEnd !== -1) {
                    const href = sanitizeHref(unescapeDelimiters(src.slice(labelEnd + 2, hrefEnd)));
                    const label = src.slice(i + 1, labelEnd);
                    if (href && label) {
                        flush();
                        // allowLink: false — a link inside a link is not a thing.
                        out.push({ type: "link", href, children: parse(label, false) });
                        i = hrefEnd + 1;
                        continue;
                    }
                }
            }
        }

        if (c === "*") {
            // 1 = em, 2 = strong, 3 = both. A longer run cannot open anything,
            // and capping at 3 lets it fail the closer search and fall through
            // to literal text one star at a time.
            let run = 1;
            while (src[i + run] === "*") run++;
            const len = Math.min(run, 3);
            const inner = i + len;
            if (!isBlank(src[inner])) {
                const close = findEmphasisCloser(src, inner, len);
                if (close !== -1) {
                    const children = parse(src.slice(inner, close), allowLink);
                    flush();
                    out.push(
                        len === 1
                            ? { type: "em", children }
                            : len === 2
                            ? { type: "strong", children }
                            : { type: "em", children: [{ type: "strong", children }] },
                    );
                    i = close + len;
                    continue;
                }
            }
        }

        buf += c;
        i++;
    }

    flush();
    return out;
}

/**
 * Parse one line of prose. Never throws: the fields it backs are optional at the
 * gate and come from hand-written YAML, and taking the whole day panel down over
 * a `desc: 123` is not worth it — anything that is not a non-empty string
 * degrades to `[]`. `normalizeTripData` is what tells the author it was wrong.
 */
export function parseInline(text: string | undefined): InlineNode[] {
    return typeof text === "string" && text ? parse(text, true) : [];
}
