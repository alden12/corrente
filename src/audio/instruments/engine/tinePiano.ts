/**
 * Tine Piano (INST-50): an FM electric piano, after the DX7's E.Piano, the sound of most 80s ballads.
 * Two pairs of sines per note, as the DX7 builds it:
 * - The body: a carrier with a modulator at the same pitch, its depth fading as the note sounds, so
 *   it starts warm and edged and settles towards a pure tone. Played harder it barks (Bark): the
 *   velocity deepens the modulation, the growl of a hard-hit Rhodes.
 * - The tine: a second carrier modulated fourteen times above the note, short-lived, so each note
 *   starts with the metallic ping of the struck tine (Tine sets how much).
 * The note decays while held, as a real one does, and stops when let go (the dampers). Tremolo is the
 * amp's: the whole instrument's level wobbles, like a Suitcase Rhodes.
 */
import type { EngineBuiltin } from "../../definitions/builtin";

export const tinePiano: EngineBuiltin = {
  type: "tine-piano",
  label: "Tine Piano",
  family: "Keys",
  tags: ["keys", "warm", "retro"],
  color: "amber",
  schema: [
    { id: "tine", label: "Tine", kind: "number", min: 0, max: 1, default: 0.5 },
    { id: "bark", label: "Bark", kind: "number", min: 0, max: 1, default: 0.4 },
    { id: "decay", label: "Decay", kind: "number", min: 0.5, max: 10, default: 3, unit: "s", taper: "exponential" },
    { id: "tremolo.rate", label: "Tremolo rate", kind: "number", min: 0.5, max: 10, default: 4.5, unit: "Hz" },
    { id: "tremolo.depth", label: "Tremolo", kind: "number", min: 0, max: 1, default: 0.2 },
    { id: "level", label: "Level", kind: "number", min: 0, max: 1, default: 0.7 },
  ],
  definition: {
    format: 1,
    voices: 16,
    nodes: {
      // The body: depth in Hz is the note times an index of 0.6 to 3.1, deeper the harder it's played.
      // Kept under about 2.4 at the default Bark, where the note's own pitch would cancel for a moment
      // and the attack sound hollow.
      bodyEnv: {
        block: "adsr",
        voice: true,
        inputs: { gate: "voice.gate", attack: 0.001, decay: 1.2, sustain: 0.2, release: 0.3 },
      },
      bodyIndex: {
        block: "add",
        voice: true,
        inputs: { a: { from: "voice.velocity", scale: { param: "bark", scale: 2.5 } }, b: 0.6 },
      },
      bodyDepth: { block: "mul", voice: true, inputs: { a: "voice.frequency", b: "bodyIndex" } },
      bodyDeviation: { block: "mul", voice: true, inputs: { a: "bodyEnv", b: "bodyDepth" } },
      bodyMod: { block: "sine", voice: true, inputs: { frequency: "voice.frequency" } },
      bodyFm: { block: "mul", voice: true, inputs: { a: "bodyMod", b: "bodyDeviation" } },
      body: { block: "sine", voice: true, inputs: { frequency: ["voice.frequency", "bodyFm"] } },

      // The tine: a quick ping, gone in a quarter of a second.
      tineEnv: {
        block: "adsr",
        voice: true,
        inputs: { gate: "voice.gate", attack: 0.001, decay: 0.25, sustain: 0, release: 0.05 },
      },
      tineMod: { block: "sine", voice: true, inputs: { frequency: { from: "voice.frequency", scale: 14 } } },
      tineDeviation: {
        block: "mul",
        voice: true,
        inputs: { a: "tineEnv", b: { from: "voice.frequency", scale: 8 } },
      },
      tineFm: { block: "mul", voice: true, inputs: { a: "tineMod", b: "tineDeviation" } },
      tineCarrier: { block: "sine", voice: true, inputs: { frequency: ["voice.frequency", "tineFm"] } },
      tine: {
        block: "mul",
        voice: true,
        inputs: { a: "tineCarrier", b: { from: "tineEnv", scale: { param: "tine", scale: 0.6 } } },
      },

      // Struck, then fading while held; let go, the dampers stop it.
      ampEnv: {
        block: "adsr",
        voice: true,
        inputs: { gate: "voice.gate", attack: 0.002, decay: { param: "decay" }, sustain: 0, release: 0.25 },
      },
      sum: { block: "add", voice: true, inputs: { a: "body", b: "tine" } },
      // A quarter, so a five-note chord stays under full scale (an agent-built FM piano clicked from
      // clipping when its voices summed past it: AGENT-4.8).
      amp: {
        block: "mul",
        voice: true,
        inputs: { a: "sum", b: { from: "ampEnv", scale: { param: "level", scale: 0.25 } } },
      },

      // Tremolo: the level dips by up to Depth, once a cycle, never above where it started.
      wobble: { block: "lfo", inputs: { rate: { param: "tremolo.rate" } } },
      tremolo: {
        block: "add",
        inputs: {
          a: { from: "wobble.sine", scale: { param: "tremolo.depth", scale: -0.5 } },
          b: { param: "tremolo.depth", scale: -0.5, offset: 1 },
        },
      },
      out: { block: "mul", stereo: true, inputs: { a: "voices", b: "tremolo" } },
    },
    voice: "amp",
    output: ["out_left", "out_right"],
  },
};
