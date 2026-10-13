/**
 * Which voice slot plays each note, for one track (INST-36.5). The engine has a fixed number of
 * slots per track (the definition's `voices`); this picks one for each note on and finds it again
 * for the note off.
 *
 * - **A note already sounding restrikes its own slot**, held or releasing, so one key never stacks
 *   copies of itself.
 * - **Otherwise a free slot**: one the engine says is silent.
 * - **All busy: steal.** The slot released longest ago goes first (it is fading anyway), then the
 *   held note started longest ago.
 *
 * Typed arrays and plain loops, since this runs on the audio thread for every note.
 * Mono, legato, glide, unison and the sustain pedal (INST-32) come later.
 */

const NONE = -1;

export class VoiceAllocator {
  readonly count: number;
  private readonly notes: Int16Array;
  private readonly held: Uint8Array;
  private readonly startedAt: Float64Array;
  private readonly releasedAt: Float64Array;

  constructor(count: number) {
    this.count = count;
    this.notes = new Int16Array(count).fill(NONE);
    this.held = new Uint8Array(count);
    this.startedAt = new Float64Array(count);
    this.releasedAt = new Float64Array(count);
  }

  /** The slot to play `note` in from `time`. `sounding` says whether the engine has a slot busy. */
  noteOn(note: number, time: number, sounding: (slot: number) => boolean): number {
    const slot = this.slotFor(note, sounding);
    if (slot === NONE) return NONE;
    this.notes[slot] = note;
    this.held[slot] = 1;
    this.startedAt[slot] = time;
    return slot;
  }

  /** The slot holding `note`, now released, or -1 if it isn't held (stolen, or never started). */
  noteOff(note: number, time: number): number {
    for (let slot = 0; slot < this.count; slot++) {
      if (this.notes[slot] !== note || !this.held[slot]) continue;
      this.releaseSlot(slot, time);
      return slot;
    }
    return NONE;
  }

  /** Let go of a slot's key (all notes off). */
  releaseSlot(slot: number, time: number): void {
    this.held[slot] = 0;
    this.releasedAt[slot] = time;
  }

  /** Whether a slot's key is down. */
  isHeld(slot: number): boolean {
    return this.held[slot] === 1;
  }

  private slotFor(note: number, sounding: (slot: number) => boolean): number {
    let free = NONE;
    let released = NONE;
    let oldest = NONE;
    for (let slot = 0; slot < this.count; slot++) {
      if (this.notes[slot] === note && (this.held[slot] || sounding(slot))) return slot;
      if (this.held[slot]) {
        if (oldest === NONE || this.startedAt[slot] < this.startedAt[oldest]) oldest = slot;
      } else if (!sounding(slot)) {
        if (free === NONE) free = slot;
      } else if (released === NONE || this.releasedAt[slot] < this.releasedAt[released]) {
        released = slot;
      }
    }
    if (free !== NONE) return free;
    return released !== NONE ? released : oldest;
  }
}
