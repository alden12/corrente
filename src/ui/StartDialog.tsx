/**
 * The audio-start gate. Browsers won't create/resume an AudioContext until the
 * user interacts with the page, so we make that requirement explicit with a modal
 * rather than an easy-to-miss button. Shown until the engine has started.
 */
import type { ReactNode } from "react";
import { BrandMark } from "./BrandMark";

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
        {/* The name, since this is the first thing anyone sees (the intro welcomes by name instead).
         The heading under it stays the *task*, because that is what the dialog is asking for and
         what labels it. */}
        {intro ? (
          <div className="w-full text-left pb-4 border-b border-line">{intro}</div>
        ) : (
          <p className="-mt-1 text-2xl font-semibold tracking-tight text-strong">Corrente</p>
        )}
        <h2 id="start-title" className={`${intro ? "" : "-mt-2"} text-base font-medium text-ink`}>
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
