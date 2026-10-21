/**
 * The welcome (HOST-23.2.6), in the start card every standalone load shows anyway (browsers need a
 * click before audio), so it costs no extra step and the storage warning keeps being seen: what
 * Corrente is, that this copy keeps everything in the browser, where the online version is, and how
 * an agent joins in. Short, in a few labelled blocks, because a wall of text on a first screen goes
 * unread (Alden, 2026-10-21). The details stay in the "Saved in browser" panel and Account settings.
 */
import { useSyncExternalStore } from "react";
import { hosting, SOURCE_URL } from "../../hosting";
import { readStorageRisk, subscribeStorageRisk } from "../../hosting/storageRisk";
import { linkClass } from "./OnThisDevice";

/** The README's section on driving the app from Claude Code over MCP. */
const AGENT_GUIDE_URL = `${SOURCE_URL}#working-with-an-ai-assistant`;

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
      <div className="flex flex-col gap-1 text-center">
        <p className="text-2xl font-semibold tracking-tight text-strong">Welcome to Corrente</p>
        <p className="text-muted">
          An open source music studio and instrument builder (<External href={SOURCE_URL}>source</External>).
        </p>
      </div>

      <section aria-label="Local only" className="rounded-lg border border-line bg-ground px-3 py-2.5">
        <p>
          <strong className="font-semibold text-strong">Local only.</strong> Your projects are saved in this browser,
          which can clear them, so export your projects regularly.
          {risk === "week" &&
            " Safari deletes them after 7 days without a visit, unless Corrente is on your Home Screen or Dock."}
        </p>
      </section>

      {(interest || hostedApp) && (
        <p>
          {interest && (
            <>
              The online version is in developer preview: <External href={interest}>register interest</External>.{" "}
            </>
          )}
          {hostedApp && (
            <>
              Developers: <External href={hostedApp}>sign in online</External>.
            </>
          )}
        </p>
      )}

      <p className="pt-3 border-t border-line">
        <strong className="font-semibold text-strong">With an agent.</strong> Run Corrente from its source and Claude
        Code connects to it over MCP, to build instruments and mix with you.{" "}
        <External href={AGENT_GUIDE_URL}>How to set it up</External>
      </p>
    </div>
  );
}
