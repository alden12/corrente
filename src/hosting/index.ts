/**
 * Where this run of Corrente lives, decided in one place (HOST-23.2.4). The open build and the hosted
 * app are the same client: with no API configured it is **standalone**, keeping projects, the library
 * and favourites on this device; with one it is **hosted**, syncing them to the account. Everything
 * that differs between the two gates on `hosting.mode` rather than reading the build's settings itself.
 *
 * It's a value read once at startup, not a build-time constant, because the mode is also a choice:
 * the hosted site's sign-in screen offers "Continue signed out" (HOST-23.2.8), which runs this same
 * client standalone, with no account and nothing sent to the server. The choice is kept on this device
 * and read here beside the build's settings; making or undoing it reloads, so everything that read the
 * mode at startup reads the new one.
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
  | {
      mode: "standalone";
      /** A hosted build run signed out by choice, so signing in is a reload away, on this site. */
      canSignIn: boolean;
    }
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

/**
 * The hosting a set of build settings describes, and whether this device chose to continue signed
 * out. Pure, so tests can try any combination.
 */
export function hostingFrom(env: HostingEnv, signedOut = false): Hosting {
  const apiUrl = setting(env.VITE_DAW_API_URL);
  const authUrl = setting(env.VITE_SUPABASE_URL);
  const anonKey = setting(env.VITE_SUPABASE_ANON_KEY);
  const shared = {
    auth: authUrl && anonKey ? { url: authUrl, anonKey } : undefined,
    links: { hostedApp: setting(env.VITE_HOSTED_APP_URL), interest: setting(env.VITE_INTEREST_URL) },
  };
  if (!apiUrl) return { mode: "standalone", canSignIn: false, ...shared };
  // Signed out is the standalone app: no sign-in to set up, as with no server at all.
  if (signedOut) return { mode: "standalone", canSignIn: true, ...shared, auth: undefined };
  return { mode: "hosted", apiUrl, ...shared };
}

/**
 * Where Supabase's OAuth server sends a person to approve an app, such as Claude, connecting to
 * Corrente's hosted MCP server (AGENT-28). The Supabase project's OAuth server settings point here.
 */
export const OAUTH_CONSENT_PATH = "/oauth/consent";

/** Whether a path is the consent page, forgiving a trailing or doubled slash: a Site URL ending in
 *  `/` joined to the authorization path gives `//oauth/consent`, which must not open the DAW. */
export const isConsentPath = (pathname: string): boolean =>
  pathname.replace(/\/{2,}/g, "/").replace(/\/$/, "") === OAUTH_CONSENT_PATH;

const SIGNED_OUT_KEY = "corrente:signed-out";

/**
 * Whether this device chose to continue signed out. Not on the consent page, which approves an app
 * for an account and so always needs the sign-in.
 */
function readSignedOut(): boolean {
  try {
    return localStorage.getItem(SIGNED_OUT_KEY) === "true" && !isConsentPath(location.pathname);
  } catch {
    return false; // no storage (a private window, or not a browser): the build's mode
  }
}

/** Run signed out on this device from now on, reloading into it. */
export function continueSignedOut(): void {
  localStorage.setItem(SIGNED_OUT_KEY, "true");
  location.reload();
}

/** Back to the sign-in screen, leaving this device's signed-out projects where they are. */
export function signInHere(): void {
  localStorage.removeItem(SIGNED_OUT_KEY);
  location.reload();
}

/** This run's hosting. */
export const hosting: Hosting = hostingFrom(import.meta.env ?? {}, readSignedOut());

/** Whether this run is the hosted site signed out, where signing in means going back to its screen. */
export const canSignInHere = hosting.mode === "standalone" && hosting.canSignIn;

/** The open source's home: the app's own repository, so nothing private. */
export const SOURCE_URL = "https://github.com/alden12/corrente";
