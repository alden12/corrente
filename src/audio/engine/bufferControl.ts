/**
 * Applies the output buffer policy (bufferSize.ts, INST-36.9) to the engine: once a second it works
 * out the size wanted and, at a moment nothing would be cut, has the engine remake itself with it.
 * Slow blocks while playing live grow the live size a step; that step and the setting are kept per
 * device (browser storage), since what a phone can run is the phone's. DOM-free apart from that
 * storage, which it can go without.
 */
import type { RecorderStatus } from "../recording/recorder";
import {
  BUFFER_SETTINGS,
  BUFFER_SIZES,
  SLOW_BLOCKS_TO_GROW,
  SLOW_WINDOW_MS,
  LIVE_FOR_MS,
  canChange,
  wantedSize,
  type BufferSetting,
  type BufferSize,
} from "./bufferSize";

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
  /** The size playing live gets on this device, after any slow blocks grew it. */
  liveSize: BufferSize;
}

export class BufferControl {
  private setting: BufferSetting;
  private liveStep: number;
  /** When the transport was last seen playing or a take in progress; starts as now, so a session opens live. */
  private lastBusy: number;
  private readonly opened: number;
  /** Slow-block reports within the window, while at the live size. */
  private slow: { at: number; blocks: number }[] = [];
  private changing = false;
  private snapshotCache: BufferSnapshot | null = null;
  private readonly listeners = new Set<() => void>();

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
    const step = Number(store.read(LIVE_STEP_KEY));
    this.liveStep = Number.isInteger(step) && step > 0 ? Math.min(step, BUFFER_SIZES.length - 1) : 0;
    this.opened = this.lastBusy = now();
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

  /** Change the buffer if a different size is wanted and now is a safe moment. */
  async tick(): Promise<void> {
    const now = this.now();
    const { transport, recorder, notes } = this.activity;
    const recording = recorder.getState().status !== "idle" && recorder.getState().status !== "error";
    if (transport.isPlaying || recording) this.lastBusy = now;
    if (!this.engine.started || this.changing) return;
    const wanted = this.wanted();
    if (wanted === this.engine.bufferSize) return;
    const quietFor = now - Math.max(this.lastBusy, notes.lastPlayedAt);
    if (!canChange({ playing: transport.isPlaying, recording, holding: notes.holding, quietFor })) return;
    this.changing = true;
    try {
      await this.engine.setBufferSize(wanted);
    } finally {
      this.changing = false;
      this.changed();
    }
  }

  setSetting(setting: BufferSetting): void {
    this.setting = setting;
    this.store.write(SETTING_KEY, setting);
    this.changed();
    // A size picked by hand is asked for; it still waits for a quiet moment.
    void this.tick();
  }

  get snapshot(): BufferSnapshot {
    this.snapshotCache ??= { setting: this.setting, size: this.engine.bufferSize, liveSize: this.liveSize };
    return this.snapshotCache;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private get liveSize(): BufferSize {
    return wantedSize("auto", true, this.liveStep);
  }

  private wanted(): BufferSize {
    const { notes } = this.activity;
    const live = notes.holding || this.now() - Math.max(notes.lastPlayedAt, this.opened) < LIVE_FOR_MS;
    return wantedSize(this.setting, live, this.liveStep);
  }

  /** Slow blocks at the live size, picked for you: enough of them grow it a step, for good. */
  private heardSlow(blocks: number): void {
    if (this.setting !== "auto" || this.liveStep >= BUFFER_SIZES.length - 1) return;
    if (this.engine.bufferSize !== this.liveSize) return;
    const now = this.now();
    this.slow = [...this.slow.filter(({ at }) => now - at < SLOW_WINDOW_MS), { at: now, blocks }];
    if (this.slow.reduce((sum, report) => sum + report.blocks, 0) < SLOW_BLOCKS_TO_GROW) return;
    this.slow = [];
    this.liveStep++;
    this.store.write(LIVE_STEP_KEY, String(this.liveStep));
    this.changed();
  }

  private changed(): void {
    this.snapshotCache = null;
    this.listeners.forEach((listener) => listener());
  }
}
