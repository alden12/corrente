/**
 * Applies the output buffer policy (bufferSize.ts, INST-36.9, INST-43) to the engine: back to the
 * live size once stopped and quiet, checked once a second; up to the playback size as Play is
 * pressed, when that's bigger. Slow blocks grow the size they were heard at; those steps and the
 * setting are kept per device (browser storage), since what a phone can run is the phone's.
 * DOM-free apart from that storage, which it can go without.
 */
import type { RecorderStatus } from "../recording/recorder";
import {
  BUFFER_SETTINGS,
  BUFFER_SIZES,
  SLOW_BLOCKS_TO_GROW,
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
  setBufferSize(size: BufferSize): Promise<void>;
  onSlowBlocks(listener: (blocks: number) => void): () => void;
}

/** What says whether someone is playing, live or from the transport. */
export interface BufferActivity {
  transport: { readonly isPlaying: boolean };
  recorder: { getState(): { status: RecorderStatus } };
  notes: { readonly holding: boolean; readonly lastPlayedAt: number };
}

/** Where the setting and the grown step are kept. */
export interface BufferStore {
  read(key: string): string | null;
  write(key: string, value: string): void;
}

export const SETTING_KEY = "corrente:buffer-setting";
export const LIVE_STEP_KEY = "corrente:buffer-live-step";
export const PLAYBACK_STEP_KEY = "corrente:buffer-playback-step";

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
  /** The sizes playing live and playing back get on this device, after any slow blocks grew them. */
  liveSize: BufferSize;
  playbackSize: BufferSize;
}

export class BufferControl {
  private setting: BufferSetting;
  private readonly steps: Steps;
  /** When the transport was last seen playing or a take in progress. */
  private lastBusy: number;
  /** Slow-block reports within the window, at the size they were heard at. */
  private slow: { at: number; blocks: number }[] = [];
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
    const stepAt = (key: string) => {
      const step = Number(store.read(key));
      return Number.isInteger(step) && step > 0 ? Math.min(step, BUFFER_SIZES.length - 1) : 0;
    };
    this.steps = { live: stepAt(LIVE_STEP_KEY), playback: stepAt(PLAYBACK_STEP_KEY) };
    this.lastBusy = now();
  }

  /** Check once a second and hear slow blocks; returns a stop. */
  start(): () => void {
    const timer = setInterval(() => void this.tick(), 1000);
    const stopSlow = this.engine.onSlowBlocks((blocks) => this.heardSlow(blocks));
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
   * Slow blocks, picked for you: enough of them within a minute grow the size they were heard at a
   * step, for good on this device. Heard while playing back, that's the playback size; else the live
   * one.
   */
  private heardSlow(blocks: number): void {
    if (this.setting !== "auto") return;
    const playing = this.activity.transport.isPlaying;
    const size = playing ? playbackSize(this.steps) : liveSize(this.steps);
    if (this.engine.bufferSize !== size || size === BUFFER_SIZES[BUFFER_SIZES.length - 1]) return;
    const now = this.now();
    this.slow = [...this.slow.filter((report) => now - report.at < SLOW_WINDOW_MS), { at: now, blocks }];
    if (this.slow.reduce((sum, report) => sum + report.blocks, 0) < SLOW_BLOCKS_TO_GROW) return;
    this.slow = [];
    if (playing) {
      this.steps.playback = Math.max(this.steps.live, this.steps.playback) + 1;
      this.store.write(PLAYBACK_STEP_KEY, String(this.steps.playback));
    } else {
      this.steps.live++;
      this.store.write(LIVE_STEP_KEY, String(this.steps.live));
    }
    this.changed();
  }

  private changed(): void {
    this.snapshotCache = null;
    this.listeners.emit();
  }
}
