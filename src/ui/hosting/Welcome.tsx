/**
 * What the start card's welcome adds on a standalone run (HOST-23.2.6), on every load since the card
 * shows anyway (browsers need a click before audio), so it costs no extra step and the storage
 * warning keeps being seen: that this copy keeps everything in the browser, where the online version
 * is, and how an agent joins in. Short, in a few labelled blocks, because a wall of text on a first screen goes
 * unread (Alden, 2026-10-21). The details stay in the "Saved in browser" panel and Account settings.
 */
import { useSyncExternalStore } from "react";
import { canSignInHere, hosting, MCP_GUIDE_URL } from "../../hosting";
import { readStorageRisk, subscribeStorageRisk } from "../../hosting/storageRisk";
import { linkClass } from "./OnThisDevice";
import { SignInHere } from "./SignInHere";

/** The guide to driving the app from Claude Code over MCP. */

const External = ({ href, children }: { href: string; children: string }) => (
  <a href={href} target="_blank" rel="noreferrer" className={linkClass}>
    {children}
  </a>
);

export function Welcome() {
  const { risk } = useSyncExternalStore(subscribeStorageRisk, readStorageRisk, readStorageRisk);
  const { interest, hostedApp } = hosting.links;
  return (
    <div className="flex flex-col gap-3 text-[13px] leading-snug text-ink">
      <section aria-label="Local only" className="rounded-lg border border-line bg-ground px-3 py-2.5">
        <p>
          <strong className="font-semibold text-strong">Local only.</strong> Your projects are saved in this browser,
          which can clear them, so export your projects regularly.
          {risk === "week" &&
            " Safari deletes them after 7 days without a visit, unless Corrente is on your Home Screen or Dock."}
        </p>
      </section>

      <ul className="flex flex-col gap-1.5 list-disc pl-5 marker:text-faint">
        {(interest || hostedApp || canSignInHere) && (
          <li>
            {interest && (
              <>
                The online version is in developer preview: <External href={interest}>register interest</External>.{" "}
              </>
            )}
            {canSignInHere ? (
              <>
                Invited? <SignInHere>Sign in</SignInHere>.
              </>
            ) : (
              hostedApp && (
                <>
                  Developers: <External href={hostedApp}>sign in online</External>.
                </>
              )
            )}
          </li>
        )}
        <li>
          To run the Corrente MCP with an agent, follow the <External href={MCP_GUIDE_URL}>setup instructions</External>
          .
        </li>
      </ul>
    </div>
  );
}
