/**
 * What Corrente is, for whoever sees it first: the start card on a standalone run, and the sign-in
 * screen on the hosted site (HOST-23.2.8), now a stranger's first sight too.
 */
import { SOURCE_URL } from "../hosting";
import { GitHubIcon } from "./shellIcons";

export function WelcomeHeader() {
  return (
    <div className="flex flex-col gap-1">
      <p className="text-2xl font-semibold tracking-tight text-strong">Welcome to Corrente</p>
      <p className="text-[13px] text-muted leading-snug">An open source music studio and instrument builder</p>
      {/* Inline, so the line follows whatever alignment the card it sits in has. */}
      <p className="mt-1 leading-none">
        <span
          title="Corrente is in beta: things move, and some will break"
          className="inline-block align-middle mr-2 font-mono text-[10px] font-medium uppercase tracking-wider text-you border border-you/50 bg-you/10 rounded px-1.5 py-0.5"
        >
          Beta
        </span>
        <a
          href={SOURCE_URL}
          target="_blank"
          rel="noreferrer"
          aria-label="Source on GitHub"
          title="Source on GitHub"
          className="inline-flex align-middle text-muted hover:text-ink"
        >
          <GitHubIcon />
        </a>
      </p>
    </div>
  );
}
