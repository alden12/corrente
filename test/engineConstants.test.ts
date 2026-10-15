import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { BLOCK, INPUT_CHANNELS, OUTPUT_CHANNELS, SAMPLE_SLOTS, ZONE_SIGNAL } from "../src/audio/bank/exports";
import {
  HOST_SIGNALS,
  MAX_VOICES,
  MAX_ZONES,
  TRACK_INPUTS,
  VOICE_SIGNALS,
  VOICE_SUM,
} from "../src/audio/definitions/format";
import { INPUT_TYPE, STEP_MODE } from "../src/audio/definitions/words";
import { CYCLE, LEVELS } from "../src/audio/samples/tables";

/**
 * The numbers the engine and the TypeScript beside it must agree on (INST-36.10): each Rust
 * constant against its TypeScript twin, read from the Rust source, so changing one side alone fails
 * here. Native block kinds aren't here: they reach TypeScript through catalogue.json.
 */
const engineSrc = fileURLToPath(new URL("../engine/src/", import.meta.url));

/** A Rust file's `pub const NAME: type = number;` lines, by name. */
const rustConstants = (file: string) =>
  Object.fromEntries(
    [...readFileSync(`${engineSrc}${file}`, "utf8").matchAll(/^pub const (\w+): \w+ = (\d+);/gm)].map(
      ([, name, value]) => [name, Number(value)],
    ),
  );

/** Each Rust file's constants, by name, and the TypeScript value each must equal. */
const TWINS: Record<string, Record<string, number>> = {
  "plan/mod.rs": {
    VOICE_SIGNALS: Object.keys(VOICE_SIGNALS).length,
    SIGNAL_FREQ: VOICE_SIGNALS["voice.frequency"],
    SIGNAL_GATE: VOICE_SIGNALS["voice.gate"],
    SIGNAL_VELOCITY: VOICE_SIGNALS["voice.velocity"],
    SIGNAL_NOTE: VOICE_SIGNALS["voice.note"],
    SIGNAL_SEED: VOICE_SIGNALS["voice.seed"],
    SIGNAL_SAMPLE: ZONE_SIGNAL.sample,
    SIGNAL_ROOT: ZONE_SIGNAL.root,
    SIGNAL_START: ZONE_SIGNAL.start,
    SIGNAL_END: ZONE_SIGNAL.end,
    HOST_SIGNALS: Object.keys(HOST_SIGNALS).length,
    HOST_TEMPO: HOST_SIGNALS["host.tempo"],
    HOST_BEAT: HOST_SIGNALS["host.beat"],
    HOST_PLAYING: HOST_SIGNALS["host.playing"],
    HOST_BEAT_SECONDS: HOST_SIGNALS["host.beatSeconds"],
    HOST_BEAT_SAMPLES: HOST_SIGNALS["host.beatSamples"],
    HOST_SAMPLE_RATE: HOST_SIGNALS["host.sampleRate"],
    INPUT_BUFFER: INPUT_TYPE.buffer,
    INPUT_PREVIOUS: INPUT_TYPE.previous,
    INPUT_PARAM: INPUT_TYPE.param,
    INPUT_CONSTANT: INPUT_TYPE.constant,
    INPUT_VOICE: INPUT_TYPE.voice,
    INPUT_SHARED: INPUT_TYPE.shared,
    INPUT_VOICE_SUM: INPUT_TYPE.voiceSum,
    INPUT_INPUT: INPUT_TYPE.input,
    INPUT_HOST: INPUT_TYPE.host,
    STEP_NODE: STEP_MODE.node,
    STEP_SAMPLE_LOOP: STEP_MODE["sample-loop"],
    STEP_CHUNK_LOOP: STEP_MODE["chunk-loop"],
    MAX_VOICES,
    MAX_ZONES,
    CHANNELS: OUTPUT_CHANNELS,
    MAX_INPUTS: INPUT_CHANNELS,
  },
  "router/mod.rs": { BLOCK },
  "router/sampler.rs": { MAX_SAMPLES: SAMPLE_SLOTS },
  "router/wavetable.rs": { CYCLE, LEVELS },
};

describe("the engine's constants", () => {
  it.each(Object.entries(TWINS))("%s agrees with TypeScript", (file, twins) => {
    const rust = rustConstants(file);
    expect(Object.fromEntries(Object.keys(twins).map((name) => [name, rust[name]]))).toEqual(twins);
  });

  it("pairs every signal, input type and step the plan reader knows", () => {
    // A new one in Rust needs its TypeScript twin, and a line here.
    const named = Object.keys(rustConstants("plan/mod.rs")).filter((name) => /^(SIGNAL|HOST|INPUT|STEP)_/.test(name));
    expect(named.filter((name) => !(name in TWINS["plan/mod.rs"]))).toEqual([]);
  });

  it("has the same signal names on each side of the zone signals", () => {
    expect(Object.entries(ZONE_SIGNAL).map(([name, signal]) => [`voice.${name}`, signal])).toEqual(
      Object.entries(VOICE_SIGNALS).filter(([, signal]) => Object.values(ZONE_SIGNAL).includes(signal)),
    );
  });

  it("keeps the voice sum and the track's inputs to the engine's channels", () => {
    const plan = rustConstants("plan/mod.rs");
    expect([Object.keys(VOICE_SUM).length, Object.keys(TRACK_INPUTS).length]).toEqual([plan.CHANNELS, plan.MAX_INPUTS]);
  });
});
