/**
 * What each track is playing right now (MOBILE-13): the notes its voices are sounding, as the engine
 * reports them, its MIDI devices' notes included (an arpeggiator's, not the key that started it). What
 * lights the keys and pads with a clip playing back, so you can play along and learn a part. DOM-free.
 *
 * The audio thread reports a block as it renders it, which is ahead of the speakers by the output
 * latency, so a report is applied that much later: the keys light as the note is heard.
 */
import { createListeners } from "../../listeners";

const NONE: ReadonlySet<number> = new Set();

export class TrackNotes {
  private readonly notes = new Map<string, ReadonlySet<number>>();
  private readonly listeners = createListeners<[]>();

  /** The notes `trackId` is sounding now. */
  get(trackId: string): ReadonlySet<number> {
    return this.notes.get(trackId) ?? NONE;
  }

  /** `trackId` is sounding `notes` from `delayMs` from now. */
  report(trackId: string, notes: number[], delayMs = 0): void {
    const apply = () => {
      this.notes.set(trackId, new Set(notes));
      this.listeners.emit();
    };
    if (delayMs > 0) setTimeout(apply, delayMs);
    else apply();
  }

  /** A track went: forget it. */
  drop(trackId: string): void {
    if (this.notes.delete(trackId)) this.listeners.emit();
  }

  subscribe = (listener: () => void): (() => void) => this.listeners.subscribe(listener);
}
