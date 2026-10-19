/**
 * What `analyze_device` reports about one track's sound on its own (AGENT-4.6): its levels as
 * analyze_mix gives them, how its energy spreads across octaves, how wide it is, and on request the
 * spectrogram picture (AGENT-4.11). The ears spike settled on describing a sound by its mechanics,
 * which these show, rather than by adjectives.
 */
import type { ProjectRender } from "../render/renderProject";
import { analyzeRender, summarizeMix, type MixSummary } from "./analyze";
import { PICTURE_KEY, spectrogramPicture } from "./picture";
import { spectrumOf } from "./spectrum";

export interface DeviceSummary extends MixSummary {
  /** What it played. */
  played: string;
  /** Each octave band's level, dBFS RMS, by its centre in Hz. */
  bands: Record<string, number>;
  /** Where its spectrum balances: low for dark, high for bright. */
  centroidHz: number;
  /** How alike the two channels are: 1 is mono, 0 unrelated (wide), below 0 out of phase. */
  stereoCorrelation: number;
  /** How to read the picture, when there is one. */
  pictureKey?: string;
}

export interface DeviceAnalysis {
  summary: DeviceSummary;
  /** The spectrogram as a base64 PNG, when asked for. */
  picture?: string;
}

const round1 = (value: number): number => Math.round(value * 10) / 10;

/** Pearson correlation of the two channels; 1 for silence, which is as mono as it gets. */
function correlationOf([left, right]: Float32Array[]): number {
  const [leftSquares, rightSquares, product] = left.reduce(
    ([leftSum, rightSum, productSum], sample, index) => [
      leftSum + sample * sample,
      rightSum + right[index] ** 2,
      productSum + sample * right[index],
    ],
    [0, 0, 0],
  );
  const scale = Math.sqrt(leftSquares * rightSquares);
  return scale > 1e-12 ? product / scale : 1;
}

/** Measure a render of `deviceAlone`'s project; `played` is what it says was played. */
export async function analyzeDeviceRender(
  render: ProjectRender,
  played: string,
  picture = false,
): Promise<DeviceAnalysis> {
  const mono = render.channels[0].map((sample, index) => (sample + render.channels[1][index]) / 2);
  const { bands, centroidHz } = spectrumOf(mono, render.sampleRate);
  const summary: DeviceSummary = {
    played,
    ...summarizeMix(analyzeRender(render)),
    bands: Object.fromEntries(bands.map(({ hz, db }) => [hz >= 1000 ? `${hz / 1000}k` : String(hz), round1(db)])),
    centroidHz: Math.round(centroidHz),
    stereoCorrelation: Math.round(correlationOf(render.channels) * 100) / 100,
    ...(picture ? { pictureKey: PICTURE_KEY } : {}),
  };
  return {
    summary,
    ...(picture ? { picture: await spectrogramPicture(render.channels, render.sampleRate) } : {}),
  };
}
