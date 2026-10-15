import { describe, expect, it } from "vitest";
import {
  LIVE_STEP_KEY,
  SETTING_KEY,
  BufferControl,
  type BufferActivity,
  type BufferEngine,
  type BufferStore,
} from "../src/audio/engine/bufferControl";
import { LIVE_FOR_MS, QUIET_FOR_MS, canChange, wantedSize, type BufferSize } from "../src/audio/engine/bufferSize";
import type { RecorderStatus } from "../src/audio/recording/recorder";

/**
 * The output buffer picked for you (INST-36.9): small while playing live, largest while listening,
 * changed only at a quiet moment, grown on a device that renders late, and settable by hand.
 */

describe("the policy", () => {
  it("wants the live size while playing live, the largest while listening, or the setting's", () => {
    expect(wantedSize("auto", true, 0)).toBe("interactive");
    expect(wantedSize("auto", true, 1)).toBe("balanced");
    expect(wantedSize("auto", true, 9)).toBe("playback");
    expect(wantedSize("auto", false, 0)).toBe("playback");
    expect(wantedSize("balanced", false, 0)).toBe("balanced");
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
  it("opens live, and goes to the largest once nothing has been played for a while", async () => {
    const { engine, control, wait } = setUp();
    await control.tick();
    expect(engine.changes).toEqual([]);
    wait(LIVE_FOR_MS);
    await control.tick();
    expect(engine.changes).toEqual(["playback"]);
  });

  it("goes back to the smallest once a note is played and let go, not while it's held", async () => {
    const { engine, state, control, wait, now } = setUp();
    wait(LIVE_FOR_MS);
    await control.tick();
    state.holding = true;
    state.lastPlayedAt = now();
    await control.tick();
    expect(engine.bufferSize).toBe("playback");
    state.holding = false;
    wait(QUIET_FOR_MS);
    await control.tick();
    expect(engine.bufferSize).toBe("interactive");
  });

  it("waits for the transport to stop and a take to end, then for quiet", async () => {
    const { engine, state, control, wait } = setUp();
    wait(LIVE_FOR_MS);
    state.playing = true;
    await control.tick();
    state.playing = false;
    state.status = "recording";
    await control.tick();
    state.status = "idle";
    await control.tick();
    expect(engine.changes).toEqual([]);
    wait(QUIET_FOR_MS);
    await control.tick();
    expect(engine.changes).toEqual(["playback"]);
  });

  it("grows the live size after slow blocks while live, and keeps the step for this device", async () => {
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

  it("ignores slow blocks spread over more than a minute, or while listening", async () => {
    const { control, slow, wait } = setUp();
    slow(3);
    wait(61_000);
    slow(3);
    expect(control.snapshot.liveSize).toBe("interactive");
    wait(LIVE_FOR_MS);
    await control.tick();
    slow(10);
    expect(control.snapshot.liveSize).toBe("interactive");
  });

  it("takes a size set by hand, at the next quiet moment, and keeps it", async () => {
    const { engine, stored, control, wait } = setUp();
    control.setSetting("balanced");
    expect(stored[SETTING_KEY]).toBe("balanced");
    expect(control.snapshot.setting).toBe("balanced");
    wait(QUIET_FOR_MS);
    await control.tick();
    expect(engine.bufferSize).toBe("balanced");
    wait(LIVE_FOR_MS);
    await control.tick();
    expect(engine.bufferSize).toBe("balanced");
    expect(setUp(stored).control.snapshot.setting).toBe("balanced");
  });

  it("does nothing before audio has started", async () => {
    const { engine, control, wait } = setUp();
    engine.started = false;
    wait(LIVE_FOR_MS);
    await control.tick();
    expect(engine.changes).toEqual([]);
  });
});
