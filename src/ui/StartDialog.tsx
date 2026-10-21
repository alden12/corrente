/**
 * The audio-start gate. Browsers won't create/resume an AudioContext until the
 * user interacts with the page, so we make that requirement explicit with a modal
 * rather than an easy-to-miss button. Shown until the engine has started.
 */
import type { ReactNode } from "react";
import { BrandMark } from "./BrandMark";
import { SOURCE_URL } from "../hosting";
import { GitHubIcon } from "./shellIcons";

/**
 * `intro` is what a standalone run needs to know (HOST-23.2.6): said here, in the card that's shown
 * anyway, rather than in a popup of its own.
 */
export function StartDialog({ onStart, error, intro }: { onStart: () => void; error?: string; intro?: ReactNode }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ground/85 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="start-title"
    >
      {/* Scrolls inside itself on a short screen (a phone on its side), so Start stays reachable. */}
      <div className="bg-panel border border-line rounded-2xl p-8 max-w-sm mx-4 max-h-[calc(100dvh-2rem)] overflow-y-auto text-center flex flex-col items-center gap-4 shadow-2xl">
        <BrandMark size={72} />
        {/* What Corrente is, since this is the first thing anyone sees, then what a standalone run
         adds. The heading after them stays the *task*, because that is what the dialog is asking for
         and what labels it. */}
        <div className="flex flex-col gap-1">
          <p className="text-2xl font-semibold tracking-tight text-strong">Welcome to Corrente</p>
          <p className="text-[13px] text-muted leading-snug">
            An open source music studio and instrument builder{" "}
            <a
              href={SOURCE_URL}
              target="_blank"
              rel="noreferrer"
              aria-label="Source on GitHub"
              title="Source on GitHub"
              className="inline-flex mt-1 align-[-3px] text-muted hover:text-ink"
            >
              <GitHubIcon />
            </a>
          </p>
        </div>
        {intro && <div className="w-full text-left">{intro}</div>}
        <h2 id="start-title" className="w-full pt-4 border-t border-line text-base font-medium text-ink">
          Start the audio engine
        </h2>
        <p className="text-sm text-muted leading-relaxed">
          Browsers won&apos;t play sound until you&apos;ve clicked on the page, so start here.
        </p>
        <button
          type="button"
          onClick={onStart}
          autoFocus
          className="mt-1 font-mono text-sm font-semibold px-5 py-2.5 rounded-lg bg-you text-ground cursor-pointer"
        >
          ▶ Start audio
        </button>
        {/* Startup can fail for reasons the page cannot fix by retrying - most often an
            insecure context, where AudioWorklet is unavailable and the button otherwise
            just appears to do nothing. Say so rather than leaving the modal sitting there. */}
        {error && (
          <p role="alert" className="text-xs text-red-300 leading-relaxed">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
