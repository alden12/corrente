/**
 * Applies the output buffer policy (bufferSize.ts, INST-36.9, INST-43, INST-53) to the engine: back
 * to the live size once stopped and quiet, checked once a second; up to the playback size as Play is
 * pressed, when that's bigger. Sustained slow blocks grow the size they were heard at, for this
 * session. The setting is kept per device (browser storage). DOM-free apart from that storage, which
 * it can go without; whether the page is hidden is asked of the caller.
 */
import type { RecorderStatus } from "../recording/recorder";
import {
  BUFFER_SETTINGS,
  BUFFER_SIZES,
  SLOW_SECONDS_TO_GROW,
  SETTLE_MS,
  SLOW_WINDOW_MS,
  canChange,
  liveSize,
  playbackSize,
  wantedSize,
  type BufferSetting,
  type BufferSize,
  type Steps,
} from "./bufferSize";
import { createListeners } from "../../listeners";

export interface BufferEngine {
  readonly started: boolean;
  readonly bufferSize: BufferSize;
  /** When the running context was made, on the same clock as `now` (Date.now). */
  readonly startedAt: number;
  setBufferSize(size: BufferSize): Promise<void>;
  onSlowBlocks(listener: (blocks: number) => void): () => void;
}

/** What says whether someone is playing, live or from the transport. */
export interface BufferActivity {
  transport: { readonly isPlaying: boolean };
  recorder: { getState(): { status: RecorderStatus } };
  notes: { readonly holding: boolean; readonly lastPlayedAt: number };
  /** Whether the page is hidden: a background tab is throttled, and its slow blocks say nothing. */
  page: { readonly hidden: boolean };
}

/** Where the setting is kept. */
export interface BufferStore {
  read(key: string): string | null;
  write(key: string, value: string): void;
}

export const SETTING_KEY = "corrente:buffer-setting";

/** Browser storage, or nothing where it's blocked (a private window): the defaults then hold. */
const browserStore: BufferStore = {
  read: (key) => {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  write: (key, value) => {
    try {
      localStorage.setItem(key, value);
    } catch {
      // Not kept: it's picked again next time.
    }
  },
};

export interface BufferSnapshot {
  setting: BufferSetting;
  size: BufferSize;
  /** The sizes playing live and playing back get this session, after any slow blocks grew them. */
  liveSize: BufferSize;
  playbackSize: BufferSize;
}

export class BufferControl {
  private setting: BufferSetting;
  /** Not kept: each launch starts at the smallest (INST-53). */
  private readonly steps: Steps = { live: 0, playback: 0 };
  /** When the transport was last seen playing or a take in progress. */
  private lastBusy: number;
  /** When slow blocks were reported within the window, at the size they were heard at. */
  private slow: number[] = [];
  private changing = false;
  private snapshotCache: BufferSnapshot | null = null;
  private readonly listeners = createListeners();

  private readonly engine: BufferEngine;
  private readonly activity: BufferActivity;
  private readonly store: BufferStore;
  private readonly now: () => number;

  constructor(engine: BufferEngine, activity: BufferActivity, store: BufferStore = browserStore, now = Date.now) {
    this.engine = engine;
    this.activity = activity;
    this.store = store;
    this.now = now;
    const saved = store.read(SETTING_KEY);
    this.setting = BUFFER_SETTINGS.find((setting) => setting === saved) ?? "auto";
    this.lastBusy = now();
  }

  /** Check once a second and hear slow blocks; returns a stop. */
  start(): () => void {
    const timer = setInterval(() => void this.tick(), 1000);
    const stopSlow = this.engine.onSlowBlocks(() => this.heardSlow());
    return () => {
      clearInterval(timer);
      stopSlow();
    };
  }

  /** Back to the size wanted while stopped, once it differs and now is a safe moment. */
  async tick(): Promise<void> {
    const now = this.now();
    const { transport, notes } = this.activity;
    const recording = this.recording();
    if (transport.isPlaying || recording) this.lastBusy = now;
    if (!this.engine.started || this.changing) return;
    const wanted = wantedSize(this.setting, false, this.steps);
    if (wanted === this.engine.bufferSize) return;
    const quietFor = now - Math.max(this.lastBusy, notes.lastPlayedAt);
    if (!canChange({ playing: transport.isPlaying, recording, holding: notes.holding, quietFor })) return;
    await this.change(wanted);
  }

  /**
   * Asked as Play is pressed (the scheduler's hook): the switch to wait for when playback wants a
   * bigger buffer than now, or null to start at once. A take keeps the live size: it's played live,
   * and its count-in is already timed on this context's clock.
   */
  beforePlay(): Promise<void> | null {
    if (!this.engine.started || this.changing || this.recording()) return null;
    const wanted = wantedSize(this.setting, true, this.steps);
    return wanted === this.engine.bufferSize ? null : this.change(wanted);
  }

  setSetting(setting: BufferSetting): void {
    this.setting = setting;
    this.store.write(SETTING_KEY, setting);
    this.changed();
    // A size picked by hand is asked for; it still waits for a quiet moment.
    void this.tick();
  }

  get snapshot(): BufferSnapshot {
    this.snapshotCache ??= {
      setting: this.setting,
      size: this.engine.bufferSize,
      liveSize: liveSize(this.steps),
      playbackSize: playbackSize(this.steps),
    };
    return this.snapshotCache;
  }

  subscribe(listener: () => void): () => void {
    return this.listeners.subscribe(listener);
  }

  private recording(): boolean {
    const { status } = this.activity.recorder.getState();
    return status !== "idle" && status !== "error";
  }

  private async change(size: BufferSize): Promise<void> {
    this.changing = true;
    this.slow = [];
    try {
      await this.engine.setBufferSize(size);
    } finally {
      this.changing = false;
      this.changed();
    }
  }

  /**
   * Slow blocks, picked for you: in enough separate seconds within a minute, they grow the size they
   * were heard at a step for this session, once the engine has settled after starting and while the
   * page is shown. Heard while playing back, that's the playback size; else the live one. The engine
   * reports about once a second, per bank, so seconds are counted rather than reports or blocks: one
   * bad second can't grow a size on its own.
   */
  private heardSlow(): void {
    if (this.setting !== "auto" || this.activity.page.hidden) return;
    const now = this.now();
    if (now - this.engine.startedAt < SETTLE_MS) return;
    const playing = this.activity.transport.isPlaying;
    const size = playing ? playbackSize(this.steps) : liveSize(this.steps);
    if (this.engine.bufferSize !== size || size === BUFFER_SIZES[BUFFER_SIZES.length - 1]) return;
    this.slow = [...this.slow.filter((at) => now - at < SLOW_WINDOW_MS), now];
    const seconds = new Set(this.slow.map((at) => Math.floor(at / 1000))).size;
    if (seconds < SLOW_SECONDS_TO_GROW) return;
    this.slow = [];
    if (playing) this.steps.playback = Math.max(this.steps.live, this.steps.playback) + 1;
    else this.steps.live++;
    this.changed();
  }

  private changed(): void {
    this.snapshotCache = null;
    this.listeners.emit();
  }
}
