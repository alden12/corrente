/**
 * Factory patches: a bank of ready-made presets shipped with the app, as pure data.
 * Unlike user patches (the library, savePatch/removePatch), these are read-only and
 * built in - they can't be deleted, only used as a starting point. They share the
 * `Patch` shape, so applying one is the same `createTrackFromPatch` edit as any saved
 * patch, and they show up in the library (flat Patches view + nested under their
 * instrument) and search alongside user patches.
 *
 * These are original, "inspired-by" presets: classic patch *types* (bass, lead, pad,
 * keys, pluck, brass), mostly for the Nimbus synth (a Juno-style polysynth), with the
 * chorus effect bundled where the sound wants that lush ensemble shimmer. The Micro VA
 * ones were designed with the agent's ears (analyze_device, AGENT-4.6) after classic
 * virtual-analog presets, and kept by ear. Names are our own.
 */
import type { Tag } from "../tags";
import { listPatches, type Patch, type PatchEffect } from "./library";

/** Juno-style chorus settings for the lush presets (bundled as the one effect). */
const chorusI: PatchEffect = { type: "chorus", params: { "chorus.rate": 0.7, "chorus.depth": 0.35, mix: 0.5 } };
const chorusII: PatchEffect = { type: "chorus", params: { "chorus.rate": 1.6, "chorus.depth": 0.55, mix: 0.55 } };

/** Terser factory-patch literals for one instrument: fills in the constant fields (builtin, author, id). */
const builtinFor =
  (instrumentType: string) =>
  (
    name: string,
    /** What it is and sounds like: its role first, then its character. */
    tags: readonly Tag[],
    params: Patch["params"],
    effects: PatchEffect[] = [],
  ): Patch => ({
    id: `factory:${instrumentType}:${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
    name,
    author: "you",
    builtin: true,
    tags,
    instrumentType,
    params,
    effects,
    createdAt: 0,
  });

const nimbus = builtinFor("nimbus");
const microVa = builtinFor("micro-va");
const hybridWave = builtinFor("hybrid-wave");

// Param ids match each instrument's schema. Only the interesting params are set; the ParamStore
// fills the rest from schema defaults when the patch is applied.
export const FACTORY_PATCHES: Patch[] = [
  // --- Bass -----------------------------------------------------------------
  nimbus("Deep Sub", ["bass", "dark", "soft"], {
    "osc.saw": 0.4,
    "osc.sub": 1,
    "osc.pulse": 0,
    "filter.cutoff": 520,
    "filter.resonance": 0.12,
    "filter.env": 0.5,
    "filter.keytrack": 0.4,
    "env.attack": 2,
    "env.decay": 240,
    "env.sustain": 0.35,
    "env.release": 140,
    "amp.level": 0.85,
  }),
  nimbus("Reso Acid", ["bass", "gritty", "retro"], {
    "osc.saw": 0.9,
    "osc.sub": 0.3,
    "filter.cutoff": 340,
    "filter.resonance": 0.72,
    "filter.env": 0.85,
    "filter.keytrack": 0.5,
    "env.attack": 2,
    "env.decay": 170,
    "env.sustain": 0.1,
    "env.release": 120,
    "amp.level": 0.8,
  }),
  // --- Lead -----------------------------------------------------------------
  nimbus(
    "Bright Saw",
    ["lead", "bright", "aggressive"],
    {
      "osc.saw": 1,
      "osc.pulse": 0.3,
      "osc.sub": 0.2,
      "filter.cutoff": 5200,
      "filter.resonance": 0.2,
      "filter.env": 0.3,
      "filter.keytrack": 0.6,
      "env.attack": 6,
      "env.decay": 400,
      "env.sustain": 0.7,
      "env.release": 240,
      "lfo.rate": 5.5,
      "lfo.pitch": 0.14,
      "lfo.delay": 500,
      "amp.level": 0.75,
    },
    // A lush lead chain dialed in on the synth: chorus -> reverb -> a resonant filter
    // sweep -> a light tremolo.
    [
      { type: "chorus", params: { "chorus.rate": 0.7, "chorus.depth": 0.15, mix: 0.43 } },
      { type: "reverb", params: { "reverb.decay": 1.8, mix: 0.24 } },
      {
        type: "filter",
        params: { "filter.cutoff": 5600, "filter.resonance": 6, "lfo.rate": 0.68, "lfo.depth": 0, mix: 1 },
      },
      { type: "tremolo", params: { "tremolo.rate": 9.6, "tremolo.depth": 0.09, mix: 1 } },
    ],
  ),
  nimbus(
    "Hollow PWM",
    ["lead", "retro"],
    {
      "osc.pulse": 1,
      "osc.pulseWidth": 0.5,
      "osc.saw": 0,
      "osc.sub": 0.2,
      "filter.cutoff": 3600,
      "filter.resonance": 0.25,
      "filter.env": 0.4,
      "env.attack": 8,
      "env.decay": 320,
      "env.sustain": 0.65,
      "env.release": 300,
      "lfo.rate": 1.1,
      "lfo.pwm": 0.5,
      "amp.level": 0.75,
    },
    [chorusI],
  ),
  // --- Pad ------------------------------------------------------------------
  nimbus(
    "Warm Strings",
    ["pad", "warm", "lush"],
    {
      "osc.saw": 0.8,
      "osc.pulse": 0.4,
      "osc.sub": 0.3,
      "filter.cutoff": 2200,
      "filter.resonance": 0.1,
      "filter.env": 0.3,
      "env.attack": 600,
      "env.decay": 800,
      "env.sustain": 0.8,
      "env.release": 900,
      "lfo.rate": 0.6,
      "lfo.pwm": 0.2,
      "amp.level": 0.7,
    },
    [chorusII],
  ),
  nimbus(
    "Glass Pad",
    ["pad", "glassy", "airy"],
    {
      "osc.pulse": 0.7,
      "osc.pulseWidth": 0.5,
      "osc.saw": 0.3,
      "filter.cutoff": 3000,
      "filter.resonance": 0.15,
      "filter.env": 0.4,
      "env.attack": 900,
      "env.decay": 1200,
      "env.sustain": 0.7,
      "env.release": 1400,
      "lfo.rate": 0.5,
      "lfo.pwm": 0.35,
      "amp.level": 0.68,
    },
    [chorusII],
  ),
  // --- Keys -----------------------------------------------------------------
  nimbus(
    "Electric Piano",
    ["keys", "warm", "soft"],
    {
      "osc.pulse": 0.6,
      "osc.saw": 0.3,
      "osc.sub": 0.3,
      "filter.cutoff": 2800,
      "filter.resonance": 0.1,
      "filter.env": 0.5,
      "filter.keytrack": 0.5,
      "env.attack": 4,
      "env.decay": 520,
      "env.sustain": 0.4,
      "env.release": 300,
      "amp.level": 0.78,
    },
    [chorusI],
  ),
  nimbus("Clav", ["keys", "bright", "retro"], {
    "osc.pulse": 0.9,
    "osc.pulseWidth": 0.3,
    "filter.cutoff": 3500,
    "filter.resonance": 0.3,
    "filter.env": 0.6,
    "filter.keytrack": 0.5,
    "env.attack": 2,
    "env.decay": 200,
    "env.sustain": 0.2,
    "env.release": 150,
    "amp.level": 0.8,
  }),
  // --- Pluck ----------------------------------------------------------------
  nimbus("Synth Pluck", ["pluck", "bright"], {
    "osc.saw": 0.8,
    "osc.sub": 0.4,
    "filter.cutoff": 2500,
    "filter.resonance": 0.25,
    "filter.env": 0.7,
    "filter.keytrack": 0.4,
    "env.attack": 2,
    "env.decay": 220,
    "env.sustain": 0,
    "env.release": 200,
    "amp.level": 0.8,
  }),
  // --- Brass ----------------------------------------------------------------
  nimbus(
    "Analog Brass",
    ["brass", "lead", "bright", "retro"],
    {
      "osc.saw": 0.9,
      "osc.pulse": 0.5,
      "osc.sub": 0.2,
      "filter.cutoff": 1800,
      "filter.resonance": 0.15,
      "filter.env": 0.6,
      "filter.keytrack": 0.5,
      "env.attack": 40,
      "env.decay": 320,
      "env.sustain": 0.7,
      "env.release": 260,
      "amp.level": 0.75,
    },
    [chorusI],
  ),
  // --- Micro VA -------------------------------------------------------------
  microVa("Classic Lead", ["lead", "bright", "retro"], {
    "o1.wave": "Saw",
    "o2.tune": -6,
    "f.type": "24dB LPF",
    "f.cutoff": 3000,
    "f.reso": 0.25,
    "f.egInt": 12,
    "eg1.a": 5,
    "eg1.d": 400,
    "eg1.r": 250,
    "eg2.a": 12,
    "eg2.s": 1,
    "eg2.r": 250,
    "lfo2.pitch": 18,
    "amp.level": 0.5,
    "mod.mix": 0.2,
    "dly.fb": 0.35,
  }),
  microVa("Bright Poly", ["keys", "bright", "retro"], {
    "o1.wave": "Saw",
    "o2.level": 0.8,
    "f.type": "24dB LPF",
    "f.cutoff": 3500,
    "f.egInt": 24,
    "eg1.a": 5,
    "eg1.d": 600,
    "eg1.s": 0.5,
    "eg1.r": 400,
    "eg2.a": 5,
    "eg2.d": 800,
    "eg2.s": 0.8,
    "eg2.r": 450,
    "amp.level": 0.35,
    "mod.mix": 0.4,
    "dly.div": "1/8.",
    "dly.fb": 0.3,
    "dly.mix": 0.15,
  }),
  // --- Hybrid Wave ----------------------------------------------------------
  // Alden's preset on the Block Test Synth it was promoted from: the filter open, so the wavetable's
  // morph and the PWM layer carry it.
  hybridWave("Morph Keys", ["keys", "bright", "glassy"], {
    "wt.position": 0.36,
    "filter.cutoff": 8000,
    "filter.resonance": 0.1,
    "filter.env": 0,
    "fenv.decay": 38,
    "env.attack": 9,
    "env.decay": 670,
    "env.sustain": 0.68,
  }),
  // --- FX -------------------------------------------------------------------
  nimbus("Noise Sweep", ["fx", "airy"], {
    "osc.noise": 0.8,
    "osc.saw": 0.2,
    "osc.sub": 0,
    "filter.cutoff": 1200,
    "filter.resonance": 0.5,
    "filter.env": 1,
    "env.attack": 1500,
    "env.decay": 2000,
    "env.sustain": 0.5,
    "env.release": 2000,
    "lfo.rate": 0.3,
    "lfo.filter": 0.4,
    "amp.level": 0.7,
  }),
];

/** Every patch the library can offer: the shipped factory presets plus the user's
 *  saved patches. Used by the MCP patch RPC (list / apply / get) and the UI. */
export function allPatches(): Patch[] {
  return [...FACTORY_PATCHES, ...listPatches()];
}

/** Resolve a patch by exact id, else by case-insensitive name, across factory + user. */
export function findPatch(query: string): Patch | undefined {
  const q = query.trim();
  const all = allPatches();
  return all.find((patch) => patch.id === q) ?? all.find((patch) => patch.name.toLowerCase() === q.toLowerCase());
}
