/**
 * Where this run of Corrente lives, decided in one place (HOST-23.2.4). The open build and the hosted
 * app are the same client: with no API configured it is **standalone**, keeping projects, the library
 * and favourites on this device; with one it is **hosted**, syncing them to the account. Everything
 * that differs between the two gates on `hosting.mode` rather than reading the build's settings itself.
 *
 * It's a value read once at startup, not a build-time constant, because the mode will also be a
 * choice: the hosted site's sign-in screen is to offer "Continue signed out" (HOST-23.2.8), which
 * runs this same client standalone. That choice is read here too when it lands, beside the build's.
 */

/** The build settings this reads (the `VITE_*` values in `vite-env.d.ts`). */
export type HostingEnv = Partial<
  Pick<
    ImportMetaEnv,
    "VITE_DAW_API_URL" | "VITE_SUPABASE_URL" | "VITE_SUPABASE_ANON_KEY" | "VITE_HOSTED_APP_URL" | "VITE_INTEREST_URL"
  >
>;

/** Pages that live outside the app, each a build setting so the open repo carries none of them. */
export interface HostingLinks {
  /** Corrente online, for what a standalone run can't do (sharing, collaboration). */
  hostedApp?: string;
  /** Where to register interest while the online app is invite-only. */
  interest?: string;
}

export type Hosting = (
  | { mode: "standalone" }
  | {
      mode: "hosted";
      /** The sync API's base URL. */
      apiUrl: string;
    }
) & {
  /** Supabase sign-in, when configured. A hosted dev server may run without it (the open dev stub). */
  auth?: { url: string; anonKey: string };
  links: HostingLinks;
};

/** A setting's value, with a blank one counted as unset (`.env.test` blanks them to turn them off). */
const setting = (value: string | undefined): string | undefined => value?.trim() || undefined;

/** The hosting a set of build settings describes. Pure, so tests can try any combination. */
export function hostingFrom(env: HostingEnv): Hosting {
  const apiUrl = setting(env.VITE_DAW_API_URL);
  const authUrl = setting(env.VITE_SUPABASE_URL);
  const anonKey = setting(env.VITE_SUPABASE_ANON_KEY);
  const shared = {
    auth: authUrl && anonKey ? { url: authUrl, anonKey } : undefined,
    links: { hostedApp: setting(env.VITE_HOSTED_APP_URL), interest: setting(env.VITE_INTEREST_URL) },
  };
  return apiUrl ? { mode: "hosted", apiUrl, ...shared } : { mode: "standalone", ...shared };
}

/** This run's hosting. */
export const hosting: Hosting = hostingFrom(import.meta.env ?? {});
