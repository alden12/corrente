/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
  /** Sync-server base URL. When set, the app uses the remote project store (else OPFS). */
  readonly VITE_DAW_API_URL?: string;
  /** Supabase project URL. Set (with the anon key) to enable the login gate + real per-user auth. */
  readonly VITE_SUPABASE_URL?: string;
  /** Supabase anon/public key (safe in the client). Pairs with VITE_SUPABASE_URL. */
  readonly VITE_SUPABASE_ANON_KEY?: string;
  /** Corrente online, linked from a standalone run for what it can't do (sharing, collaboration). */
  readonly VITE_HOSTED_APP_URL?: string;
  /** Where to register interest in the online app while it's invite-only. */
  readonly VITE_INTEREST_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
