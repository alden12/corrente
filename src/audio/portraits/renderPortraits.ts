/**
 * Render every built-in's portrait (COMM-1.9.2): each instrument, factory patch, effect and MIDI
 * device, alone, drawn by `draw.ts`. Iterates the catalogs, so a newly registered device gets one
 * on the next `yarn portraits` (which runs this in Node and commits the result - nothing renders on
 * page load).
 *
 * Instruments and effects play on the engine render core (renderDevice, AGENT-4.9), so this runs
 * wherever the core does, given a setup for where it is.
 */
import { pickableInstrumentInfos } from "../instruments/catalog";
import { effectInfos } from "../effects/catalog";
import { midiDeviceInfos } from "../midi/device/catalog";
import { FACTORY_PATCHES } from "../patches/factory";
import { renderDevice, type DeviceChain, type RenderSetup, type Stimulus } from "../render/renderDevice";
import { capturePhrase } from "./capturePhrase";
import { envelope, isSustained, phaseScope, phrase, ringSeconds, transfer, type Portrait } from "./draw";
import { PORTRAIT_KEYS } from "./keys";

const SAMPLE_RATE = 44100;
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

const midiPortrait = (type: string): Portrait => {
  const { notes, spanSec } = capturePhrase(type);
  return { fill: phrase(notes, spanSec) };
};

export async function renderPortraits(setup: RenderSetup): Promise<Record<string, Portrait>> {
  const jobs: (readonly [string, () => Promise<Portrait> | Portrait])[] = [
    ...pickableInstrumentInfos().map(
      (info) =>
        [
          PORTRAIT_KEYS.instrument(info.type),
          () => instrumentPortrait({ instrument: { type: info.type } }, setup),
        ] as const,
    ),
    ...FACTORY_PATCHES.map(
      (patch) =>
        [
          PORTRAIT_KEYS.patch(patch.id),
          () =>
            instrumentPortrait(
              {
                instrument: { type: patch.instrumentType, params: patch.params },
                effects: patch.effects.map((effect) => ({ type: effect.type, params: effect.params })),
              },
              setup,
            ),
        ] as const,
    ),
    ...effectInfos().map((info) => [PORTRAIT_KEYS.effect(info.type), () => effectPortrait(info.type, setup)] as const),
    ...midiDeviceInfos().map((info) => [PORTRAIT_KEYS.midi(info.type), () => midiPortrait(info.type)] as const),
  ];
  // One at a time, so the order keeps the output file stable from run to run.
  const portraits: Record<string, Portrait> = {};
  for (const [key, draw] of jobs) portraits[key] = await draw();
  return portraits;
}
