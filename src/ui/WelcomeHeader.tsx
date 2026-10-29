/**
 * What Corrente is, for whoever sees it first: the start card on a standalone run, and the sign-in
 * screen on the hosted site (HOST-23.2.8), now a stranger's first sight too.
 */
import { PLUGIN_URL, SOURCE_URL } from "../hosting";
import { BetaChip } from "./BetaChip";
import { GitHubIcon } from "./shellIcons";

export function WelcomeHeader() {
  return (
    <div className="flex flex-col gap-1">
      <p className="text-2xl font-semibold tracking-tight text-strong">Welcome to Corrente</p>
      <p className="text-[13px] text-muted leading-snug">An open source music studio and instrument builder</p>
      {/* Inline, so the line follows whatever alignment the card it sits in has. */}
      <p className="mt-1 leading-none">
        <BetaChip className="align-middle mr-2" />
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
        <a
          href={PLUGIN_URL}
          target="_blank"
          rel="noreferrer"
          title="Corrente's devices in your DAW, as a VST3 or CLAP plugin for macOS"
          className="ml-3 align-middle text-[12px] text-muted hover:text-ink hover:underline underline-offset-2"
        >
          Get the plugin
        </a>
      </p>
    </div>
  );
}
