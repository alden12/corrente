/**
 * The bank's timed events (INST-36.5): notes, param moves and all-notes-off, each stamped with the
 * AudioContext time it should land at, waiting to be played in the block that contains it.
 *
 * Kept in parallel typed arrays, sorted by time, rather than an array of objects: taking events off
 * while rendering then creates nothing, and the audio thread has no garbage to stall on. Adding one
 * happens as a message arrives (between blocks), which is where the queue may grow.
 */

export const EVENT = { noteOn: 0, noteOff: 1, param: 2, allOff: 3, midiValue: 4 } as const;
export type EventKind = (typeof EVENT)[keyof typeof EVENT];

/** One event, as `next` hands it out: a reused object, valid until the next call. */
export interface TimedEvent {
  kind: EventKind;
  track: number;
  /** The note (noteOn, noteOff) or the engine's param source (param). */
  target: number;
  /** The velocity (noteOn) or the source's value (param). */
  value: number;
  time: number;
}

export class EventQueue {
  private kinds: Uint8Array;
  private tracks: Int32Array;
  private targets: Int32Array;
  private values: Float64Array;
  private times: Float64Array;
  /** Events live in [start, end): taken from the front, added in time order. */
  private start = 0;
  private end = 0;
  private readonly taken: TimedEvent = { kind: EVENT.noteOn, track: 0, target: 0, value: 0, time: 0 };

  constructor(capacity = 1024) {
    this.kinds = new Uint8Array(capacity);
    this.tracks = new Int32Array(capacity);
    this.targets = new Int32Array(capacity);
    this.values = new Float64Array(capacity);
    this.times = new Float64Array(capacity);
  }

  get size(): number {
    return this.end - this.start;
  }

  /**
   * Add an event in time order. One at the same time as others goes after them, so events keep the
   * order they were sent in (a note off then on at one time stays that way round).
   */
  add(kind: EventKind, track: number, target: number, value: number, time: number): void {
    if (this.end === this.kinds.length) this.makeRoom();
    // Walk back from the end: events mostly arrive in time order, so this is usually no steps.
    let at = this.end;
    while (at > this.start && this.times[at - 1] > time) at--;
    this.shiftRight(at);
    this.kinds[at] = kind;
    this.tracks[at] = track;
    this.targets[at] = target;
    this.values[at] = value;
    this.times[at] = time;
    this.end++;
  }

  /** The earliest event if it lands before `before`, taken off the queue; otherwise null. */
  next(before: number): TimedEvent | null {
    if (this.start === this.end || this.times[this.start] >= before) return null;
    const at = this.start++;
    if (this.start === this.end) this.start = this.end = 0;
    const taken = this.taken;
    taken.kind = this.kinds[at] as EventKind;
    taken.track = this.tracks[at];
    taken.target = this.targets[at];
    taken.value = this.values[at];
    taken.time = this.times[at];
    return taken;
  }

  /** Drop every event for a track (or every event, with no track). */
  clear(track?: number): void {
    if (track === undefined) {
      this.start = this.end = 0;
      return;
    }
    let kept = this.start;
    for (let at = this.start; at < this.end; at++) {
      if (this.tracks[at] === track) continue;
      this.move(at, kept++);
    }
    this.end = kept;
  }

  /** Space at the end: slide the queue back to the start, or double it if it is full. */
  private makeRoom(): void {
    if (this.start > 0) {
      for (let at = this.start; at < this.end; at++) this.move(at, at - this.start);
      this.end -= this.start;
      this.start = 0;
      return;
    }
    const grown = (array: Uint8Array | Int32Array | Float64Array) => {
      const bigger = new (array.constructor as new (length: number) => typeof array)(array.length * 2);
      bigger.set(array);
      return bigger;
    };
    this.kinds = grown(this.kinds) as Uint8Array;
    this.tracks = grown(this.tracks) as Int32Array;
    this.targets = grown(this.targets) as Int32Array;
    this.values = grown(this.values) as Float64Array;
    this.times = grown(this.times) as Float64Array;
  }

  private shiftRight(from: number): void {
    for (let at = this.end; at > from; at--) this.move(at - 1, at);
  }

  private move(from: number, to: number): void {
    this.kinds[to] = this.kinds[from];
    this.tracks[to] = this.tracks[from];
    this.targets[to] = this.targets[from];
    this.values[to] = this.values[from];
    this.times[to] = this.times[from];
  }
}
