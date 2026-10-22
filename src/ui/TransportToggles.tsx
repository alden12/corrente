/**
 * The transport's two switches, Loop and Metronome, as buttons any surface can show: the desktop
 * transport bar, and the project page (DAW-78), where a phone reaches them. Each is a preference
 * kept per device; the transport bar, always mounted, is the one that tells the scheduler.
 */
import { IconButton } from "./controls/IconButton";
import { useLooping, useMetronome } from "./transportPrefs";

export function LoopButton({ hidden, className }: { hidden?: boolean; className?: string }) {
  const [looping, setLooping] = useLooping();
  return (
    <IconButton
      label="Loop"
      tone="you"
      hidden={hidden}
      className={className}
      active={looping}
      title={looping ? "Loop on: play comes round" : "Loop off: play stops at the end"}
      onClick={() => setLooping(!looping)}
    >
      {/* two arrows chasing round */}
      <svg
        width="15"
        height="15"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
        strokeLinecap="round"
        aria-hidden="true"
      >
        <path d="M3 7.5 V6.5 A2.5 2.5 0 0 1 5.5 4 H12.5" />
        <path d="M10.5 2 L12.5 4 L10.5 6" />
        <path d="M13 8.5 V9.5 A2.5 2.5 0 0 1 10.5 12 H3.5" />
        <path d="M5.5 14 L3.5 12 L5.5 10" />
      </svg>
    </IconButton>
  );
}

export function MetronomeButton({ hidden }: { hidden?: boolean }) {
  const [metronome, setMetronome] = useMetronome();
  return (
    <IconButton
      label="Metronome"
      tone="you"
      hidden={hidden}
      active={metronome}
      title={metronome ? "Metronome on" : "Metronome off"}
      onClick={() => setMetronome(!metronome)}
    >
      {/* a small metronome: trapezoid body + pendulum */}
      <svg
        width="15"
        height="15"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
        strokeLinecap="round"
        aria-hidden="true"
      >
        <path d="M6 2 H10 L12.5 14 H3.5 Z" />
        <line x1="4.3" y1="10" x2="11.7" y2="10" />
        <line x1="8" y1="10" x2="11" y2="3.5" />
      </svg>
    </IconButton>
  );
}
