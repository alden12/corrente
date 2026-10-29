/**
 * What Corrente is, for whoever sees it first: the start card on a standalone run, and the sign-in
 * screen on the hosted site (HOST-23.2.8), now a stranger's first sight too.
 */
import { PLUGIN_URL, SOURCE_URL } from "../hosting";
import { BetaChip } from "./BetaChip";
import { GitHubIcon } from "./shellIcons";

/** The plugin's formats, named rather than shown: their logos come with their owners' terms. */
export const PLUGIN_LABEL = "Get the plugin (VST3 / CLAP)";
const PLUGIN_TITLE = "Corrente's devices in your DAW, as a VST3 or CLAP plugin for macOS";

/** `pluginLink`: the plugin as a text link in the line under the name; a screen with a button for it leaves it out. */
export function WelcomeHeader({ pluginLink = true }: { pluginLink?: boolean }) {
  return (
    <div className="flex flex-col gap-1">
      <p className="text-2xl font-semibold tracking-tight text-strong">Welcome to Corrente</p>
      <p className="text-[13px] text-muted leading-snug">An open source music studio and instrument builder</p>
      {/* Inline, so the line follows whatever alignment the card it sits in has; one gap between all three. */}
      <p className="mt-1 leading-none">
        <span className="inline-flex items-center gap-3 align-middle">
          <BetaChip />
          <a
            href={SOURCE_URL}
            target="_blank"
            rel="noreferrer"
            aria-label="Source on GitHub"
            title="Source on GitHub"
            className="inline-flex text-muted hover:text-ink"
          >
            <GitHubIcon />
          </a>
          {pluginLink && (
            <a
              href={PLUGIN_URL}
              target="_blank"
              rel="noreferrer"
              title={PLUGIN_TITLE}
              className="text-[12px] text-muted hover:text-ink hover:underline underline-offset-2"
            >
              {PLUGIN_LABEL}
            </a>
          )}
        </span>
      </p>
    </div>
  );
}
