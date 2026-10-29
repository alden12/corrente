/**
 * The login gate. When Supabase auth is configured (`authEnabled`), the app renders here first: a brief
 * loading card while the stored session resolves, a login screen when signed out, and the app itself once
 * signed in. When auth is off it renders the app straight through (local/dev, unchanged).
 *
 * Gating ABOVE AppShell is deliberate: AppShell builds the AudioEngine/Scheduler eagerly in its state
 * initializers, so it must not mount behind the login screen. On sign-in the gate bridges the session's
 * display name into `currentUser` (the author stamped on edits); AppShell's own effects re-derive from
 * that store, so nothing else needs to know about the session.
 */
import { useEffect, useSyncExternalStore, type ReactNode } from "react";
import { BrandMark } from "./BrandMark";
import { PLUGIN_LABEL, WelcomeHeader } from "./WelcomeHeader";
import { continueSignedOut, hosting, PLUGIN_URL } from "../hosting";
import { linkClass } from "./hosting/OnThisDevice";
import { authEnabled, readAuthState, subscribeAuth, signInWithProvider, signOut, type AuthUser } from "../auth/session";
import { writeCurrentUser, DEFAULT_USER } from "./currentUser";

export function AuthGate({ children }: { children: ReactNode }) {
  // No hooks here so the early return is safe; the gated path lives in its own component.
  if (!authEnabled) return <>{children}</>;
  return <GatedApp>{children}</GatedApp>;
}

function GatedApp({ children }: { children: ReactNode }) {
  const state = useSyncExternalStore(subscribeAuth, readAuthState, readAuthState);

  // Keep the edit-author identity in step with the session (reset to the default on sign-out). We stamp
  // the EMAIL, not the display name: it's unique per account (two logins of the same person share a name
  // but not an email), so collaborators stay distinct in the feed and in colour. The readable display
  // name still drives the account avatar/panel; only edit attribution uses the email.
  const identity =
    state.status === "signed-in"
      ? (state.user.email ?? state.user.name)
      : state.status === "signed-out"
        ? DEFAULT_USER
        : null;
  useEffect(() => {
    if (identity) writeCurrentUser(identity);
  }, [identity]);

  if (state.status === "loading") return <GateCard>{<p className="text-sm text-muted">Signing in...</p>}</GateCard>;
  if (state.status === "signed-out") return <LoginScreen />;
  if (state.status === "refused") return <RefusedScreen user={state.user} />;
  return <>{children}</>;
}

/** The StartDialog-style centered card (matches src/ui/StartDialog.tsx), with the brand mark. */
export function GateCard({ children }: { children: ReactNode }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ground/85 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="auth-title"
    >
      <div className="bg-panel border border-line rounded-2xl p-8 max-w-sm mx-4 max-h-[calc(100dvh-2rem)] overflow-y-auto text-center flex flex-col items-center gap-4 shadow-2xl">
        <BrandMark size={72} />
        {children}
      </div>
    </div>
  );
}

// Invite-only during the deploy/dev window. GitHub OAuth accepts any GitHub user, which is an open-signup
// surface while the app is still unhardened (no per-owner quotas / rate-limiting yet - see HOST-8). So
// we ship Google-only: Google's "Testing" publishing mode is itself a whitelist (only test-user emails
// added in the Google Cloud console can sign in). To re-enable GitHub once things are verified: flip this
// flag AND re-enable the GitHub provider in the Supabase dashboard (both are needed).
const GITHUB_ENABLED = false;

/**
 * The hosted site's first screen, so it says what Corrente is before asking anything. Signing in is
 * invite-only, so anyone can instead continue signed out (HOST-23.2.8): the standalone app, with
 * projects kept in this browser.
 */
function LoginScreen() {
  return (
    <GateCard>
      <WelcomeHeader pluginLink={false} />
      <div className="w-full pt-4 border-t border-line flex flex-col gap-2">
        <h2 id="auth-title" className="text-base font-medium text-ink">
          Get started
        </h2>
        <p className="text-[11px] text-faint leading-relaxed">
          No account needed. Your projects stay in this browser, and you can sign in later.
        </p>
        <button
          type="button"
          onClick={continueSignedOut}
          className="w-full font-mono text-sm font-semibold px-5 py-2.5 rounded-lg bg-you text-ground cursor-pointer"
        >
          Continue signed out
        </button>
        <div className="mt-3 flex flex-col gap-2">
          <ProviderButton provider="google" label="Continue with Google" note="Invite only" />
          {GITHUB_ENABLED && <ProviderButton provider="github" label="Continue with GitHub" note="Invite only" />}
        </div>
        <p className="text-[11px] text-faint leading-relaxed">
          The online version is in developer preview
          {hosting.links.interest ? (
            <>
              :{" "}
              <a href={hosting.links.interest} target="_blank" rel="noreferrer" className={linkClass}>
                register interest
              </a>
              .
            </>
          ) : (
            ", by invitation."
          )}
        </p>
      </div>
      <div className="w-full pt-4 border-t border-line flex flex-col gap-2">
        <p className="text-[11px] text-faint leading-relaxed">Corrente&apos;s devices in your DAW, for macOS.</p>
        <a
          href={PLUGIN_URL}
          target="_blank"
          rel="noreferrer"
          className="w-full text-center font-mono text-sm font-semibold px-5 py-2.5 rounded-lg border border-line bg-card text-ink hover:border-faint"
        >
          {PLUGIN_LABEL}
        </a>
      </div>
    </GateCard>
  );
}

/**
 * Signed in, and turned away: the server does not have this account (HOST-20). Most often the phone's
 * Google account is not the one that was invited, so the way out is another account.
 */
function RefusedScreen({ user }: { user: AuthUser }) {
  return (
    <GateCard>
      <h2 id="auth-title" className="text-lg font-semibold text-strong">
        This account isn't invited yet
      </h2>
      <p className="text-sm text-muted leading-relaxed">
        You're signed in as <span className="text-ink break-all">{user.email ?? user.name}</span>, but Corrente doesn't
        have that account on its invite list. If you were invited with a different Google account, sign in with that
        one.
      </p>
      <button
        type="button"
        onClick={() => void signOut()}
        className="mt-1 w-full font-mono text-sm font-semibold px-5 py-2.5 rounded-lg border border-line bg-card text-ink hover:border-faint cursor-pointer"
      >
        Use another account
      </button>
    </GateCard>
  );
}

/** `note` says who it's for, on the button itself, since a button gets pressed before its caption is read. */
function ProviderButton({ provider, label, note }: { provider: "google" | "github"; label: string; note?: string }) {
  return (
    <button
      type="button"
      onClick={() => void signInWithProvider(provider)}
      className="w-full flex flex-col items-center px-5 py-2.5 rounded-lg border border-line bg-card text-ink hover:border-faint cursor-pointer"
    >
      <span className="font-mono text-sm font-semibold">{label}</span>
      {note && <span className="text-[11px] text-muted">{note}</span>}
    </button>
  );
}
