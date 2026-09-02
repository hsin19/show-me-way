declare const __APP_VERSION__: string;
declare const __BUILD_TIME__: string;

interface ImportMetaEnv {
    readonly VITE_GOOGLE_CLIENT_ID?: string;
    /** Overrides the hop base URL for local development; production uses the default in `infra/http/hop.ts`. */
    readonly VITE_HOP_BASE_URL?: string;
}

interface ImportMeta {
    readonly env: ImportMetaEnv;
}
