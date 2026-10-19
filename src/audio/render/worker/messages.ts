/**
 * What the browser and its render worker say to each other (AGENT-4.9 part 3b). The worker runs the
 * engine render core off the main thread; a worker can't decode audio (no Web Audio there), so it
 * asks the page for each sample and audio clip it needs, decoded, as it comes to them.
 */
import type { SampleAudio } from "../../bank/bank";
import type { ProjectData } from "../../project/types";
import type { ProjectRender, ProjectRenderOptions } from "../renderProject";

/** From the page: render this project. */
export interface RenderRequest {
  kind: "render";
  id: number;
  project: ProjectData;
  engine: ArrayBuffer;
  sampleRate: number;
  options: ProjectRenderOptions;
}

/** From the page: the audio the worker asked for, or null if it won't load. */
export interface Loaded {
  kind: "loaded";
  request: number;
  audio: SampleAudio | null;
}

export type ToWorker = RenderRequest | Loaded;

/** From the worker: decode this sample (a sample param's ref) or audio clip (its file id). */
export interface LoadRequest {
  kind: "load";
  /** The render it's for. */
  id: number;
  request: number;
  what: "sample" | "audio";
  ref: string;
}

export type FromWorker =
  | LoadRequest
  | { kind: "done"; id: number; render: ProjectRender }
  | { kind: "failed"; id: number; message: string };

/** A render's or an audio's sample buffers, to move rather than copy across. */
export const buffersOf = (channels: Float32Array[]): ArrayBuffer[] =>
  channels.map((channel) => channel.buffer as ArrayBuffer);
