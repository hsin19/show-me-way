/**
 * A deliberately small inline-Markdown parser for itinerary prose (an event's
 * `desc` / `bullets`, an alternative's `note`, a checklist item's `text`).
 *
 * Supported, and nothing else: `[label](href)`, `**strong**`, `*em*`,
 * `***both***`, `` `code` ``, and a `\` escape for any of their delimiters.
 * There is no block level — headings, lists and tables have no place in a
 * field that is already one line of a YAML list — and **no raw HTML**, ever.
 *
 * It returns a node tree rather than an HTML string because share links import
 * *other people's* YAML: rendering someone else's prose through `{@html}` would
 * hand them script execution on the importer's device. `RichText.svelte` walks
 * this tree with ordinary interpolation, so there is no escaping step to get
 * wrong. `sanitizeHref` closes the other half of that hole — a `javascript:`
 * URL in a shared itinerary must never become a live link.
 *
 * Bare URLs are NOT auto-linked. Write `[官方售票頁](https://…)` and the label
 * is what the reader sees; a URL typed on its own stays plain text.
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
 * extra four hand the target to the phone rather than opening a page, which is
 * exactly what a travel itinerary wants — a restaurant's number, a meeting
 * point's coordinates. Deep links into specific apps (`line:`, `kakaomap:`)
 * are NOT here: add one only when a trip actually needs it, so the list stays
 * an allowlist and cannot rot into "everything except the bad ones".
 */
const CHIP_SCHEMES = [...PROSE_SCHEMES, "tel", "sms", "geo"];

/**
 * True for the one schemeless form worth reading as `https://…`: a dotted host
 * with an optional numeric port. The host is checked label by label rather
 * than by one regex so the rules stay legible — in particular a purely numeric
 * last label means this is a number (`56.23`), not a destination.
 */
function isBareDomain(target: string): boolean {
    const authority = target.split(/[/?#]/, 1)[0];
    const [host, port, ...extra] = authority.split(":");
    if (extra.length > 0 || (port !== undefined && !/^\d+$/.test(port))) return false;
    const labels = host.split(".");
    // A backslash is excluded with `@`: browsers fold it into `/` inside an
    // authority, so `\\evil.com` would resolve somewhere other than it reads.
    if (labels.length < 2 || labels.some(label => !label || /[\\@]/.test(label))) return false;
    return !/^\d+$/.test(labels[labels.length - 1]);
}

function sanitize(raw: unknown, allowed: readonly string[]): string | null {
    // Not typed `string`, because the fields these guard are user YAML that
    // `normalizeTripData` cannot promise anything about on an older save.
    if (typeof raw !== "string") return null;
    const href = raw.trim();
    if (!href || /\s/.test(href)) return null;
    if ([...href].some(ch => ch.charCodeAt(0) < 0x20 || ch.charCodeAt(0) === 0x7f)) return null;

    const scheme = SCHEME.exec(href)?.[1].toLowerCase();
    if (scheme) {
        if (!allowed.includes(scheme)) return null;
        // `https:`, `http://` and `mailto:` name a scheme and no destination.
        return href.slice(scheme.length + 1).replace(/^\/\//, "") ? href : null;
    }
    if (href.startsWith("//")) return isBareDomain(href.slice(2)) ? `https:${href}` : null;
    return isBareDomain(href) ? `https://${href}` : null;
}

/**
 * Normalizes a Markdown link's target, or returns null to leave the whole
 * `[…](…)` as literal text. Only `http(s)` / `mailto` and bare domains
 * survive; anything carrying whitespace or control characters is rejected
 * outright, since in an href those only show up in attempts to smuggle a
 * scheme past the check.
 *
 * A root-relative path (`/docs/x.html`), a fragment (`#a.b`) or a query
 * (`?q=1`) is not a destination in someone else's itinerary either — there is
 * nothing on this origin to point at — so those stay literal text too.
 */
export function sanitizeHref(raw: unknown): string | null {
    return sanitize(raw, PROSE_SCHEMES);
}

/**
 * The same guard for an href the author labeled themselves — `links[].url` and
 * `mapLink` — where `tel:` / `sms:` / `geo:` are useful and were accepted long
 * before any of this existed. Prose stays on the narrower list: a sentence in
 * an imported trip has no business dialing anything.
 */
export function sanitizeLinkHref(raw: unknown): string | null {
    return sanitize(raw, CHIP_SCHEMES);
}

/** True when `c` is absent or whitespace — used for the flanking rule below. */
function isBlank(c: string | undefined): boolean {
    return c === undefined || /\s/.test(c);
}

/**
 * Finds where a run of exactly `len` asterisks closes the emphasis opened by
 * the same-length run, or -1.
 *
 * Emphasis needs some flanking rule or `3 * 4 * 5` turns italic, but
 * CommonMark's full version leans on word boundaries that Chinese does not
 * have. The rule here is the part that survives translation: no whitespace
 * just inside either delimiter. That keeps `**5"×9"×1" 以內**` working with no
 * spaces anywhere, while leaving spaced-out arithmetic alone.
 *
 * Runs are measured whole and stepped over whole, which is what the two other
 * rules depend on: a `**` inside a `*…*` cannot half-match (its second star
 * would otherwise close the italic and strand the rest), and `卡號 ****1234`
 * finds no closer at all rather than eating its own asterisks into an empty
 * `<strong>` — hence also `i > from`, since a closer at the opening delimiter
 * itself is an empty span, not a match.
 *
 * Code spans and link targets are stepped over for the same reason they win in
 * `parse`: their contents are not markup. Without that, `` **注意 `a**b` 結束**``
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
 * Drops the `\` from every escaped delimiter. A link's label gets this for
 * free by going through `parse`; its href does not, and leaving the slashes in
 * sends `[x](https://a.com/p\(1\))` — the one form the escape exists for — to
 * a different URL than it reads.
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

        if (c === "\\" && i + 1 < src.length && ESCAPABLE.includes(src[i + 1])) {
            buf += src[i + 1];
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
 * Parses one line of prose. Text with no markup comes back as a single text
 * node; empty text as an empty array.
 *
 * Undefined is in the signature because the fields this backs are optional at
 * the gate; the `typeof` is a runtime guard on top, because those fields come
 * from user YAML and an event that omits `desc` used to render an empty
 * paragraph. Throwing here instead would take out the whole day panel, so
 * anything that is not a non-empty string degrades to nothing at all.
 * `normalizeTripData` is what tells the author their `desc: 123` is wrong;
 * this only keeps the app on its feet.
 */
export function parseInline(text: string | undefined): InlineNode[] {
    return typeof text === "string" && text ? parse(text, true) : [];
}
