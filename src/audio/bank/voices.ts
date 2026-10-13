/**
 * Which voice slot plays each note, for one track (INST-36.5). The engine gives a track the
 * definition's `voices` plus a few spare slots; this picks one for each note on, finds it again for
 * the note off, and says which voice to cut when a new note needs room.
 *
 * - **At most `voices` play at once.** A note past that cuts one: the voice released longest ago
 *   (it is fading anyway), else the held note started longest ago.
 * - **A note already sounding is cut and starts again**, so one key never stacks copies of itself.
 * - **A cut voice fades out over a block** (the engine's `eng_note_cut`) while the new note starts in
 *   a spare slot, on time and without a click. Only if every slot is still fading does a note take
 *   one over at once.
 *
 * Typed arrays and plain loops, since this runs on the audio thread for every note.
 * Mono, legato, glide, unison and the sustain pedal (INST-32) come later.
 */

const NONE = -1;

export class VoiceAllocator {
  /** Engine slots, spares included. */
  readonly slots: number;
  /** The most that play at once. */
  readonly voices: number;
  /** The slot the last `noteOn` needs cut first, or -1. */
  cut = NONE;
  private readonly notes: Int16Array;
  private readonly velocities: Float32Array;
  private readonly held: Uint8Array;
  private readonly cutting: Uint8Array;
  private readonly startedAt: Float64Array;
  private readonly releasedAt: Float64Array;

  constructor(slots: number, voices: number) {
    this.slots = slots;
    this.voices = Math.min(voices, slots);
    this.notes = new Int16Array(slots).fill(NONE);
    this.velocities = new Float32Array(slots);
    this.held = new Uint8Array(slots);
    this.cutting = new Uint8Array(slots);
    this.startedAt = new Float64Array(slots);
    this.releasedAt = new Float64Array(slots);
  }

  /**
   * The slot to play `note` in from `time`, with `cut` set to a slot to cut first (or -1).
   * `sounding` says whether the engine has a slot busy.
   */
  noteOn(note: number, velocity: number, time: number, sounding: (slot: number) => boolean): number {
    this.cut = this.toCut(note, sounding);
    if (this.cut !== NONE) {
      this.cutting[this.cut] = 1;
      this.held[this.cut] = 0;
      this.notes[this.cut] = NONE;
    }
    const slot = this.freeSlot(sounding);
    this.notes[slot] = note;
    this.velocities[slot] = velocity;
    this.held[slot] = 1;
    this.cutting[slot] = 0;
    this.startedAt[slot] = time;
    return slot;
  }

  /** The slot holding `note`, now released, or -1 if it isn't held (cut, or never started). */
  noteOff(note: number, time: number): number {
    for (let slot = 0; slot < this.slots; slot++) {
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

  /** The notes held now, with their velocities: what a new plan starts again. */
  heldNotes(): { note: number; velocity: number }[] {
    return Array.from(this.held.entries())
      .filter(([, held]) => held === 1)
      .map(([slot]) => ({ note: this.notes[slot], velocity: this.velocities[slot] }));
  }

  /** The slot to cut before `note` starts: its own copy if it's sounding, or one over the limit. */
  private toCut(note: number, sounding: (slot: number) => boolean): number {
    let playing = 0;
    let released = NONE;
    let oldest = NONE;
    for (let slot = 0; slot < this.slots; slot++) {
      if (this.cutting[slot] || !(this.held[slot] || sounding(slot))) continue;
      if (this.notes[slot] === note) return slot;
      playing++;
      if (this.held[slot]) {
        if (oldest === NONE || this.startedAt[slot] < this.startedAt[oldest]) oldest = slot;
      } else if (released === NONE || this.releasedAt[slot] < this.releasedAt[released]) {
        released = slot;
      }
    }
    if (playing < this.voices) return NONE;
    return released !== NONE ? released : oldest;
  }

  /** A silent slot, or failing that the one cutting longest (taken over at once). */
  private freeSlot(sounding: (slot: number) => boolean): number {
    let fading = NONE;
    for (let slot = 0; slot < this.slots; slot++) {
      if (!this.held[slot] && !sounding(slot) && slot !== this.cut) return slot;
      if (this.cutting[slot] && slot !== this.cut && (fading === NONE || this.startedAt[slot] < this.startedAt[fading]))
        fading = slot;
    }
    return fading !== NONE ? fading : this.cut !== NONE ? this.cut : 0;
  }
}
