/**
 * Playing the computer keyboard (DAW-12.1): key presses become notes or chords through
 * `LiveNotes`, the same seam the pads and hardware MIDI use, so recording and the MIDI devices
 * work without knowing a key was pressed.
 *
 * **A held key remembers what it started.** Moving the octave, changing the key or flipping to
 * chords while a key is down must still let go of the notes that key began, so the release is
 * read from what was played rather than looked up again in the layout.
 *
 * **Two keys can hold the same note** - the rows overlap by design, and chords share notes (C and
 * Am share two) - so a note is only started if nothing holds it yet and only let go once nothing
 * else does, the rule `usePadTouch` keeps for fingers.
 *
 * Shift changes the layout itself (`useShiftHeld`), so the panel shows what a key will play before
 * you press it; a key held through the change keeps sounding what it started. Losing focus (a tab switch, a dialog) lets everything go, since the key-up will never arrive.
 *
 * **Tab is the sustain pedal** while held, as in GarageBand's Musical Typing: the same `setSustain`
 * a MIDI pedal (CC64) calls, so notes let go under it ring on until Tab comes up. Space stays
 * play/stop. While the keys are live, Tab doesn't move focus between controls.
 *
 * **Which keys are down is a store the panel subscribes to, not state of the shell that owns this.**
 * A key press must not redraw the whole desktop: React renders a keydown's update before the next
 * keydown is handled, so with the held keys as shell state every key of a chord waited for the last
 * one's full render, and the notes of a chord came in one at a time. Only the panel draws them.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { isTypingTarget } from "../typingTarget";
import { isMac } from "./platform";
import { padKey, type PadNoteTarget, type PadNotes } from "../pads/usePadTouch";
import { OCTAVE_KEYS, type KeyPad } from "./keyLayout";
import { createValueStore } from "../../listeners";
import { playedPad } from "../pads/lastPlayed";

interface HeldKey {
  /** What it is sounding, which the layout may have moved on from since. */
  pitches: PadNotes;
  /** The pad it was pressed as, for lighting it. */
  pad: string;
}

/** The keys held down right now, for whatever draws them (`useHeldKeys`). */
export interface KeyboardPlaying {
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => ReadonlyMap<string, HeldKey>;
}

export interface HeldKeys {
  /** Lit by a key held down: matched by the pad's own notes, like `PadTouch.isSounding`. */
  isHeld: (pitches: PadNotes) => boolean;
  /** What a key down right now is sounding, by code: which the layout may no longer show (Shift let go). */
  heldAt: (code: string) => PadNotes | undefined;
}

function heldStore(): KeyboardPlaying & { set: (next: ReadonlyMap<string, HeldKey>) => void } {
  const held = createValueStore<ReadonlyMap<string, HeldKey>>(new Map());
  return { subscribe: held.subscribe, getSnapshot: held.read, set: held.set };
}

/** The held keys, for the component that draws them: only it re-renders as keys go down and up. */
export function useHeldKeys(keyboard: KeyboardPlaying): HeldKeys {
  const snapshot = useSyncExternalStore(keyboard.subscribe, keyboard.getSnapshot);
  const lit = new Set([...snapshot.values()].map((key) => key.pad));
  return { isHeld: (pitches) => lit.has(padKey(pitches)), heldAt: (code) => snapshot.get(code)?.pitches };
}

export function useKeyboardPlaying({
  pads,
  target,
  enabled,
  onOctave,
  velocity,
}: {
  /** The current layout's pads by key code (`padsByCode`). */
  pads: Map<string, KeyPad>;
  /** Where notes go, and the sustain pedal Tab holds down (`LiveNotes`). */
  target: PadNoteTarget & { setSustain?: (down: boolean) => void };
  /** Off until audio has started, and while the chord editor has the pads. */
  enabled: boolean;
  onOctave: (direction: -1 | 1) => void;
  /** The velocity a key strikes at, read at the press (the panel's velocity strip). */
  velocity: () => number;
}): KeyboardPlaying {
  const held = useRef(new Map<string, HeldKey>());
  const [store] = useState(heldStore);

  // The listeners read the latest layout and octave handler through refs, so a key change does
  // not tear them down mid-press and lose the key-up.
  const padsRef = useRef(pads);
  const onOctaveRef = useRef(onOctave);
  const velocityRef = useRef(velocity);
  useLayoutEffect(() => {
    padsRef.current = pads;
    onOctaveRef.current = onOctave;
    velocityRef.current = velocity;
  });

  const publish = useCallback(() => store.set(new Map(held.current)), [store]);
  const heldNotes = useCallback(() => new Set([...held.current.values()].flatMap((key) => [...key.pitches])), []);

  const releaseAll = useCallback(() => {
    const everything = heldNotes();
    held.current.clear();
    // Tab's key-up won't arrive either: lift the pedal after the notes, so nothing rings on.
    everything.forEach((pitch) => target.noteOff(pitch));
    target.setSustain?.(false);
    publish();
  }, [heldNotes, publish, target]);

  useEffect(() => {
    if (!enabled) return;
    const onDown = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target)) return;
      // A shortcut (Cmd+A selects all in the roll), not a note. Ctrl+Shift on a Mac is the second lift
      // (`useLift`), so its keys play.
      const lifting = event.ctrlKey && event.shiftKey && isMac();
      if (event.metaKey || event.altKey || (event.ctrlKey && !lifting)) return;
      if (event.code === "Tab") {
        event.preventDefault();
        if (!event.repeat) target.setSustain?.(true);
        return;
      }
      const octave = OCTAVE_KEYS[event.code];
      const pad = padsRef.current.get(event.code);
      if (octave === undefined && !pad) return;
      // Ours, so no Firefox quick-find on `/` or `'`.
      event.preventDefault();
      if (event.repeat) return;
      if (octave !== undefined) return onOctaveRef.current(octave);
      if (!pad || held.current.has(event.code)) return;
      const sounding = heldNotes();
      const strike = velocityRef.current();
      pad.pitches.filter((pitch) => !sounding.has(pitch)).forEach((pitch) => target.noteOn(pitch, strike));
      held.current.set(event.code, { pitches: pad.pitches, pad: padKey(pad.pitches) });
      playedPad(pad.pitches);
      publish();
    };
    const onUp = (event: KeyboardEvent) => {
      if (event.code === "Tab") target.setSustain?.(false);
      const key = held.current.get(event.code);
      if (!key) return;
      held.current.delete(event.code);
      const stillHeld = heldNotes();
      key.pitches.filter((pitch) => !stillHeld.has(pitch)).forEach((pitch) => target.noteOff(pitch));
      publish();
    };
    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);
    window.addEventListener("blur", releaseAll);
    return () => {
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("keyup", onUp);
      window.removeEventListener("blur", releaseAll);
      releaseAll();
    };
  }, [enabled, heldNotes, publish, releaseAll, target]);

  return store;
}

/**
 * How far the held modifiers lift the keys (keyLayout's `lift`): 1 with Shift, 2 with Ctrl+Shift
 * where `twoUp` allows it (chords mode on a Mac), else 0. Read off every key event's modifier state
 * rather than the modifiers' own events, so one pressed before the window had focus still counts at
 * the next key.
 *
 * Ctrl+Shift only on a Mac: elsewhere the browser keeps Ctrl+Shift+W, T, N and Q for itself (W closes
 * the window) and a page can't stop it, and Cmd+Shift on a Mac would be worse (while Cmd is held a
 * Mac browser sends no key-ups for other keys, so notes stick, and Cmd+Shift+3, 4 and 5 are the
 * system's screenshots). So off a Mac, rows nine and up are reached by clicking (DAW-12.1.2).
 */
export function useLift(enabled: boolean, twoUp: boolean): number {
  const [lift, setLift] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    const read = (event: KeyboardEvent) =>
      setLift(!event.getModifierState("Shift") ? 0 : twoUp && event.getModifierState("Control") ? 2 : 1);
    // A modifier's key-up may land in another window.
    const drop = () => setLift(0);
    window.addEventListener("keydown", read);
    window.addEventListener("keyup", read);
    window.addEventListener("blur", drop);
    return () => {
      window.removeEventListener("keydown", read);
      window.removeEventListener("keyup", read);
      window.removeEventListener("blur", drop);
    };
  }, [enabled, twoUp]);
  return enabled ? lift : 0;
}
