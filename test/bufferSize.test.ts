import { describe, expect, it } from "vitest";
import {
  LIVE_STEP_KEY,
  PLAYBACK_STEP_KEY,
  SETTING_KEY,
  BufferControl,
  type BufferActivity,
  type BufferEngine,
  type BufferStore,
} from "../src/audio/engine/bufferControl";
import { QUIET_FOR_MS, SETTLE_MS, canChange, wantedSize, type BufferSize } from "../src/audio/engine/bufferSize";
import type { RecorderStatus } from "../src/audio/recording/recorder";

/**
 * The output buffer picked for you (INST-36.9, INST-43): the smallest while stopped, and for
 * playback until this device glitches; each size grows on slow blocks heard at it, kept per device;
 * bigger for playback as Play is pressed, back once stopped and quiet; settable by hand.
 */

describe("the policy", () => {
  it("wants the live size while stopped, the playback size while playing, or the setting's", () => {
    expect(wantedSize("auto", false, { live: 0, playback: 0 })).toBe("interactive");
    expect(wantedSize("auto", true, { live: 0, playback: 0 })).toBe("interactive");
    expect(wantedSize("auto", true, { live: 0, playback: 2 })).toBe("playback");
    expect(wantedSize("auto", false, { live: 1, playback: 2 })).toBe("balanced");
    // Playback is never smaller than live.
    expect(wantedSize("auto", true, { live: 1, playback: 0 })).toBe("balanced");
    expect(wantedSize("balanced", false, { live: 0, playback: 0 })).toBe("balanced");
  });

  it("changes only with nothing playing, recording or held, after a quiet moment", () => {
    const quiet = { playing: false, recording: false, holding: false, quietFor: QUIET_FOR_MS };
    expect(canChange(quiet)).toBe(true);
    expect(canChange({ ...quiet, playing: true })).toBe(false);
    expect(canChange({ ...quiet, recording: true })).toBe(false);
    expect(canChange({ ...quiet, holding: true })).toBe(false);
    expect(canChange({ ...quiet, quietFor: QUIET_FOR_MS - 1 })).toBe(false);
  });
});

/** An engine that remakes itself instantly, a clock and activity set by hand, and a memory store. */
const setUp = (saved: Record<string, string> = {}) => {
  let time = 1_000_000;
  let slowListener: (blocks: number) => void = () => {};
  const engine = {
    started: true,
    bufferSize: "interactive" as BufferSize,
    startedAt: 0,
    changes: [] as BufferSize[],
    async setBufferSize(size: BufferSize) {
      this.bufferSize = size;
      this.changes.push(size);
    },
    onSlowBlocks(listener: (blocks: number) => void) {
      slowListener = listener;
      return () => {};
    },
  } satisfies BufferEngine & { changes: BufferSize[] };
  const state = { playing: false, status: "idle" as RecorderStatus, holding: false, lastPlayedAt: -Infinity };
  const activity: BufferActivity = {
    transport: {
      get isPlaying() {
        return state.playing;
      },
    },
    recorder: { getState: () => ({ status: state.status }) },
    notes: {
      get holding() {
        return state.holding;
      },
      get lastPlayedAt() {
        return state.lastPlayedAt;
      },
    },
  };
  const stored = { ...saved };
  const store: BufferStore = { read: (key) => stored[key] ?? null, write: (key, value) => (stored[key] = value) };
  const control = new BufferControl(engine, activity, store, () => time);
  control.start()();
  return {
    engine,
    state,
    stored,
    control,
    wait: (ms: number) => (time += ms),
    now: () => time,
    slow: (blocks: number) => slowListener(blocks),
  };
};

describe("BufferControl", () => {
  it("stays at the smallest while stopped, however long nothing is played (INST-43)", async () => {
    const { engine, control, wait } = setUp();
    wait(10 * 60_000);
    await control.tick();
    expect(engine.changes).toEqual([]);
    expect(engine.bufferSize).toBe("interactive");
  });

  it("starts playback at once on a device that copes", () => {
    const { control } = setUp();
    expect(control.beforePlay()).toBeNull();
  });

  it("grows the playback size after slow blocks during playback, switching as Play is pressed", async () => {
    const { engine, state, stored, control, slow, wait } = setUp();
    state.playing = true;
    slow(4);
    expect(control.snapshot.playbackSize).toBe("balanced");
    expect(control.snapshot.liveSize).toBe("interactive");
    expect(stored[PLAYBACK_STEP_KEY]).toBe("1");
    // Not mid-playback: at the next Play.
    expect(engine.changes).toEqual([]);
    state.playing = false;
    const switching = control.beforePlay();
    expect(switching).not.toBeNull();
    await switching;
    expect(engine.bufferSize).toBe("balanced");
    // Stopped and quiet again: back to the live size.
    wait(QUIET_FOR_MS);
    await control.tick();
    expect(engine.changes).toEqual(["balanced", "interactive"]);
  });

  it("doesn't grow playback for a take, and keeps the live size for one", async () => {
    const { state, control, slow } = setUp({ [PLAYBACK_STEP_KEY]: "2" });
    state.status = "counting";
    expect(control.beforePlay()).toBeNull();
    state.status = "recording";
    state.playing = true;
    slow(10);
    expect(control.snapshot.playbackSize).toBe("playback");
  });

  it("grows the live size after slow blocks while stopped, and keeps it for this device", async () => {
    const { engine, stored, control, slow, wait } = setUp();
    slow(2);
    expect(control.snapshot.liveSize).toBe("interactive");
    slow(2);
    expect(control.snapshot.liveSize).toBe("balanced");
    expect(stored[LIVE_STEP_KEY]).toBe("1");
    wait(QUIET_FOR_MS);
    await control.tick();
    expect(engine.bufferSize).toBe("balanced");
    expect(setUp(stored).control.snapshot.liveSize).toBe("balanced");
  });

  it("waits for a held note and quiet before shrinking back", async () => {
    const { engine, state, control, wait, now } = setUp({ [LIVE_STEP_KEY]: "0", [PLAYBACK_STEP_KEY]: "2" });
    await control.beforePlay();
    expect(engine.bufferSize).toBe("playback");
    state.holding = true;
    state.lastPlayedAt = now();
    wait(QUIET_FOR_MS);
    await control.tick();
    expect(engine.bufferSize).toBe("playback");
    state.holding = false;
    state.lastPlayedAt = now();
    await control.tick();
    expect(engine.bufferSize).toBe("playback");
    wait(QUIET_FOR_MS);
    await control.tick();
    expect(engine.bufferSize).toBe("interactive");
  });

  it("ignores slow blocks while the engine settles after starting, as on a fresh install", () => {
    const { engine, control, slow, wait, now } = setUp();
    engine.startedAt = now();
    slow(10);
    wait(SETTLE_MS);
    slow(3);
    expect(control.snapshot.liveSize).toBe("interactive");
    slow(1);
    expect(control.snapshot.liveSize).toBe("balanced");
  });

  it("ignores slow blocks spread over more than a minute", () => {
    const { control, slow, wait } = setUp();
    slow(3);
    wait(61_000);
    slow(3);
    expect(control.snapshot.liveSize).toBe("interactive");
  });

  it("takes a size set by hand, at the next quiet moment, and keeps it", async () => {
    const { engine, stored, control, wait } = setUp();
    control.setSetting("balanced");
    expect(stored[SETTING_KEY]).toBe("balanced");
    wait(QUIET_FOR_MS);
    await control.tick();
    expect(engine.bufferSize).toBe("balanced");
    expect(control.beforePlay()).toBeNull();
    expect(setUp(stored).control.snapshot.setting).toBe("balanced");
  });

  it("does nothing before audio has started", async () => {
    const { engine, control, wait } = setUp({ [PLAYBACK_STEP_KEY]: "2" });
    engine.started = false;
    wait(QUIET_FOR_MS);
    await control.tick();
    expect(control.beforePlay()).toBeNull();
    expect(engine.changes).toEqual([]);
  });
});
