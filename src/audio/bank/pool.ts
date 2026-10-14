/**
 * The main thread's engine banks (INST-36.5): a track slot for each device that plays on the new
 * engine, in a worklet node shared with up to TRACKS_PER_BANK - 1 others. A bank is made when every
 * slot is taken, and stopped when its last device goes.
 *
 * Per audio context, since a worklet module and its nodes belong to one (offline renders have their
 * own). engine.wasm is fetched once and handed to each bank as it's made.
 */
import engineUrl from "../../../engine/engine.wasm?url";
import workletUrl from "./engine.worklet.ts?worker&url";
import { INSTRUMENT_STAGE } from "./stages";
import {
  BANK_PROCESSOR,
  INPUTS_PER_TRACK,
  TRACKS_PER_BANK,
  type BankOptions,
  type FromBank,
  type ToBank,
  type Transport,
} from "./messages";

/** One device's place in a bank. */
export interface BankSlot {
  /** The bank's node; this slot plays on its output `track`. */
  readonly node: AudioWorkletNode;
  readonly track: number;
  post(message: ToBank): void;
  /** Free the slot: the track goes quiet, and the bank stops if it was the last. */
  release(): void;
}

interface Bank {
  node: AudioWorkletNode;
  /** The stage every slot in it serves. */
  stage: number;
  taken: boolean[];
  /** Told what became of each slot's plan. */
  listeners: (((message: FromBank) => void) | undefined)[];
}

/** Kept once fetched; a failed fetch is forgotten, so the next device tries again. */
let engineBytes: Promise<ArrayBuffer> | null = null;
const fetchEngine = () =>
  (engineBytes ??= fetch(engineUrl)
    .then((response) => {
      if (!response.ok) throw new Error(`couldn't load the audio engine (${response.status})`);
      return response.arrayBuffer();
    })
    .catch((error: unknown) => {
      engineBytes = null;
      throw error;
    }));

interface Pool {
  bytes: ArrayBuffer;
  banks: Bank[];
}

/** Each context's transport as last told, for its banks now and any made later. */
const transports = new WeakMap<BaseAudioContext, Transport>();

/** Tell every engine bank on a context where the transport is (the scheduler, an offline render). */
export const setTransport = (context: BaseAudioContext, transport: Transport): void => {
  transports.set(context, transport);
  void pools
    .get(context)
    ?.then(({ banks }) =>
      banks.forEach((bank) => bank.node.port.postMessage({ type: "transport", ...transport } satisfies ToBank)),
    );
};

const pools = new WeakMap<BaseAudioContext, Promise<Pool>>();
const poolFor = (context: BaseAudioContext) => {
  let pool = pools.get(context);
  if (!pool) {
    pool = Promise.all([fetchEngine(), context.audioWorklet.addModule(workletUrl)]).then(
      ([bytes]) => ({ bytes, banks: [] }),
      (error: unknown) => {
        // Forgotten like the fetch, so a device made later tries again.
        pools.delete(context);
        throw error;
      },
    );
    pools.set(context, pool);
  }
  return pool;
};

// Synchronous, so slots taken together (a project's tracks, as it opens) fill one bank before
// another is made.
const newBank = (context: BaseAudioContext, bytes: ArrayBuffer, stage: number): Bank => {
  const processorOptions: BankOptions = { bytes: bytes.slice(0), tracks: TRACKS_PER_BANK };
  const node = new AudioWorkletNode(context, BANK_PROCESSOR, {
    // Each track's main input and its sidechain, stereo (a mono source plays in both channels).
    numberOfInputs: TRACKS_PER_BANK * INPUTS_PER_TRACK,
    channelCount: 2,
    channelCountMode: "explicit",
    channelInterpretation: "speakers",
    numberOfOutputs: TRACKS_PER_BANK,
    outputChannelCount: Array.from({ length: TRACKS_PER_BANK }, () => 2),
    processorOptions,
  });
  const bank: Bank = { node, stage, taken: Array.from({ length: TRACKS_PER_BANK }, () => false), listeners: [] };
  node.port.onmessage = ({ data }: MessageEvent<FromBank>) => bank.listeners[data.track]?.(data);
  const transport = transports.get(context);
  if (transport) node.port.postMessage({ type: "transport", ...transport } satisfies ToBank);
  return bank;
};

/** The node input a slot's main audio goes into. */
export const mainInput = (track: number): number => track * INPUTS_PER_TRACK;
/** The node input a slot's sidechain goes into. */
export const sidechainInput = (track: number): number => track * INPUTS_PER_TRACK + 1;

/**
 * A free slot in one of the context's banks for `stage`. `listener` hears whether each plan it's
 * given loaded (the compiler checks plans first, so a refusal is a bug, not a typo).
 */
export const takeSlot = async (
  context: BaseAudioContext,
  listener: (message: FromBank) => void,
  stage: number = INSTRUMENT_STAGE,
): Promise<BankSlot> => {
  const { bytes, banks } = await poolFor(context);
  let bank = banks.find((candidate) => candidate.stage === stage && candidate.taken.includes(false));
  if (!bank) {
    bank = newBank(context, bytes, stage);
    banks.push(bank);
  }
  const owner = bank;
  const track = owner.taken.indexOf(false);
  owner.taken[track] = true;
  owner.listeners[track] = listener;
  const post = (message: ToBank) => owner.node.port.postMessage(message);
  return {
    node: owner.node,
    track,
    post,
    release: () => {
      post({ type: "unload", track });
      owner.taken[track] = false;
      owner.listeners[track] = undefined;
      if (owner.taken.includes(true)) return;
      post({ type: "stop" });
      owner.node.disconnect();
      banks.splice(banks.indexOf(owner), 1);
    },
  };
};
