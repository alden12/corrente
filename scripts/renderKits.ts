/**
 * Render the synthesized kits' samples (INST-9.1): `yarn kits`.
 *
 * Each voice in `src/audio/samples/kits/` is a small engine device. This plays it once on the engine
 * render core, here in Node, and writes it as a short mono WAV beside the house kit's, which the kit's
 * pads play. The files are committed, so the app plays them without rendering anything. Run it after
 * retuning a voice.
 */
import { writeFile } from "node:fs/promises";
import { registerInstrument } from "../src/audio/instruments/catalog";
import { registerEngineDevice } from "../src/audio/definitions/engineDevices";
import { renderDevice } from "../src/audio/render/renderDevice";
import { encodeWavBuffer } from "../src/audio/recording/wav";
import { VOICES_808, type KitVoice } from "../src/audio/samples/kits/voices808";
import { nodeRenderSetup } from "../server/render/nodeRender";

/** The house kit's rate, and its files' format: 16-bit mono. */
const SAMPLE_RATE = 44100;
/** Every sample peaks here, a little under full scale, so the kits sit together at one level. */
const PEAK = 0.89;
/** A short fade at the end, so a voice cut at its length doesn't click. */
const FADE_SECONDS = 0.005;

const OUTPUT = (id: string) => `src/audio/samples/assets/${id}.wav`;

/** Scaled to the shared peak, and faded out over its last few milliseconds. */
function finish(samples: Float32Array): Float32Array {
  const peak = samples.reduce((loudest, sample) => Math.max(loudest, Math.abs(sample)), 0);
  const gain = peak > 0 ? PEAK / peak : 0;
  const fade = Math.round(FADE_SECONDS * SAMPLE_RATE);
  return samples.map((sample, index) => sample * gain * Math.min(1, (samples.length - 1 - index) / fade));
}

async function renderVoice(voice: KitVoice): Promise<void> {
  // Registered under a type of its own for the render, never listed (it isn't a device you can add).
  const type = `kit-voice:${voice.id}`;
  registerInstrument({ type, label: voice.id, schema: [], family: "Percussion", hidden: true });
  registerEngineDevice(type, { schema: [], definition: voice.definition });
  const rendered = await renderDevice(
    { instrument: { type } },
    { kind: "notes", notes: [{ pitch: 60, start: 0, length: voice.seconds, velocity: 1 }] },
    voice.seconds,
    { ...nodeRenderSetup(), sampleRate: SAMPLE_RATE },
  );
  await writeFile(OUTPUT(voice.id), Buffer.from(encodeWavBuffer(finish(rendered.channels[0]), SAMPLE_RATE)));
}

for (const voice of VOICES_808) await renderVoice(voice);
console.log(`Wrote ${VOICES_808.length} samples: ${VOICES_808.map((voice) => OUTPUT(voice.id)).join(", ")}`);
