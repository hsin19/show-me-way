// The one page with an address of its own: /privacy.
//
// The app has no router and wants none — the tabs are state (`activeTab` in App.svelte)
// and nothing else deserves a URL. The privacy policy is the exception because Google's
// OAuth consent screen links to it, and that link lives in the Google Cloud console,
// outside this repo: renaming the path below breaks it without a test noticing. It is a
// real path rather than a hash route because a fragment never reaches the server, so a
// crawler following the link would land on the home page; the fragment also belongs to
// share links (`#s=` / `#h=`), whose parsing and clearing both keep the pathname.
//
// The URL is the state. `version` only tells Svelte it moved, since `pushState` fires
// no event of its own.
//
// A first visit to /privacy is answered by a file, not by a fallback: the build writes
// privacy.html (vite.config.ts), and Cloudflare Pages and GitHub Pages both serve a file
// of that name at the extensionless address. The app boots from that file and lands on
// this route. Nothing else has a file behind it, so no other path is a route.

const PRIVACY_PATH = "privacy";

/** The privacy page under the deploy's base path (`/`, or `/<repo>/` on GitHub Pages). */
export const PRIVACY_URL = `${import.meta.env.BASE_URL}${PRIVACY_PATH}`;

// A host that does not redirect the file to its extensionless address serves it here.
const PRIVACY_PATHS = [PRIVACY_URL, `${PRIVACY_URL}.html`];

/** Marks a history entry the app pushed itself, so "back" has somewhere inside the app to go. */
interface AppHistoryState {
    fromApp: true;
}

class RouteState {
    private version = $state(0);

    /** Whether the address is the privacy page. */
    get privacy(): boolean {
        void this.version;
        return PRIVACY_PATHS.includes(location.pathname);
    }

    /** The `popstate` handler: back and forward move the address without telling Svelte. */
    refresh = () => {
        this.version++;
    };

    openPrivacy() {
        history.pushState({ fromApp: true } satisfies AppHistoryState, "", PRIVACY_URL);
        this.refresh();
    }

    /** Back to where the user came from; a direct visit has no such place, so it lands on the home page. */
    closePrivacy() {
        if ((history.state as Partial<AppHistoryState> | null)?.fromApp) {
            history.back();
            return;
        }
        history.replaceState(null, "", import.meta.env.BASE_URL);
        this.refresh();
    }
}

export const route = new RouteState();
