/**
 * One device's sound portrait (COMM-1.9.2, COMM-1.9.6): an instrument, an effect or a patch, played
 * on the engine render core and drawn by `draw.ts`. `renderPortraits` runs it over every built-in for
 * `portraits.json`; the browser runs it on the render worker for what the user made, one card at a time.
 */
import { renderDevice, type DeviceChain, type RenderSetup, type Stimulus } from "../render/renderDevice";
import type { PatchDocument } from "../patches/patch";
import type { SoundDevices } from "../patches/sound";
import { capturePhrase } from "./capturePhrase";
import { envelope, isSustained, phaseScope, phrase, ringSeconds, transfer, type Portrait } from "./draw";

/**
 * What to draw: a device at its defaults, or a patch's sound. The custom devices it plays go with it
 * (`devices`), so it draws wherever it's sent, as a patch plays in a project that never had them.
 */
export type PortraitJob = (
  | { kind: "instrument"; type: string }
  | { kind: "effect"; type: string }
  | { kind: "patch"; sound: Pick<PatchDocument, "instrumentType" | "params" | "effects"> }
) & { devices?: SoundDevices };

/** The rate portraits play at, so a sample is decoded at it. */
export const PORTRAIT_RATE = 44100;
const SAMPLE_RATE = PORTRAIT_RATE;
/** A3, 220 Hz: low enough that two cycles are a few hundred samples, high enough to be a tone. */
const NOTE = { pitch: 57, frequency: 220 };
/** GM kick (MIDI 36): what a drum kit is asked for when a held A3 lands on no pad. */
const GM_KICK = 36;

const silent = (samples: Float32Array) => !samples.some((sample) => Math.abs(sample) > 1e-4);

/** One channel of a chain's render at the portraits' rate. */
const render = async (chain: DeviceChain, stimulus: Stimulus, seconds: number, setup: RenderSetup) =>
  (await renderDevice(chain, stimulus, seconds, { ...setup, sampleRate: SAMPLE_RATE })).channels[0];

/** An instrument (with whatever chain a patch brings): its timbre if it holds, its hit if it decays. */
async function instrumentPortrait(chain: DeviceChain, setup: RenderSetup): Promise<Portrait> {
  const play = (pitch: number) =>
    render(chain, { kind: "notes", notes: [{ pitch, start: 0, length: 1.2, velocity: 0.9 }] }, 1.6, setup);
  const held = await play(NOTE.pitch);
  const samples = silent(held) ? await play(GM_KICK) : held;
  return isSustained(samples, SAMPLE_RATE)
    ? { line: phaseScope(samples, SAMPLE_RATE, NOTE.frequency) }
    : { fill: envelope(samples) };
}

/** A response longer than this rings on (a delay's echoes, a reverb's tail) rather than passing through. */
const RINGS_SEC = 0.2;

/**
 * An effect: its impulse response if it rings on (delay, reverb), else its transfer curve against a
 * sine (a click through distortion is still just a click, but a sine through it shows the bend).
 */
async function effectPortrait(type: string, setup: RenderSetup): Promise<Portrait> {
  const chain = { effects: [{ type }] };
  const response = await render(chain, { kind: "burst", frequency: 440, seconds: 0.02 }, 2.5, setup);
  if (ringSeconds(response, SAMPLE_RATE) > RINGS_SEC) return { fill: envelope(response) };
  const through = await render(chain, { kind: "sine", frequency: NOTE.frequency }, 1, setup);
  return { line: transfer(through, SAMPLE_RATE, NOTE.frequency) };
}

/** A MIDI device: the phrase it makes of a held chord. No audio, so no render. */
export const midiPortrait = (type: string): Portrait => {
  const { notes, spanSec } = capturePhrase(type);
  return { fill: phrase(notes, spanSec) };
};

const DRAW: {
  [Kind in PortraitJob["kind"]]: (job: Extract<PortraitJob, { kind: Kind }>, setup: RenderSetup) => Promise<Portrait>;
} = {
  instrument: ({ type }, setup) => instrumentPortrait({ instrument: { type } }, setup),
  effect: ({ type }, setup) => effectPortrait(type, setup),
  patch: ({ sound }, setup) =>
    instrumentPortrait(
      {
        instrument: { type: sound.instrumentType, params: sound.params },
        effects: sound.effects.map((effect) => ({ type: effect.type, params: effect.params })),
      },
      setup,
    ),
};

/** Draw one portrait. The job's custom devices must be registered where this runs. */
export const drawPortrait = (job: PortraitJob, setup: RenderSetup): Promise<Portrait> =>
  (DRAW[job.kind] as (job: PortraitJob, setup: RenderSetup) => Promise<Portrait>)(job, setup);
