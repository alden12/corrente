/**
 * The audio engine: owns the AudioContext and master output, and realizes the
 * project's tracks and groups as audio. Tracks come in two kinds:
 *   - instrument: an Instrument (from the registry, driven by the track's
 *     ParamStore) -> [track effects] -> trackGain
 *   - audio: scheduled AudioBufferSourceNodes -> an input gain -> [track effects]
 *     -> trackGain
 * Both feed their group's bus, mirroring the project's tree:
 *   ... -> trackGain -> group.input -> [group effects] -> group.output
 *       -> parent group.input | master -> soft clip -> destination
 *
 * `reconcile` keeps audio in sync with the project: it builds/disposes nodes for
 * tracks and groups, rewires each effect chain, re-routes to the current parent,
 * applies mute/volume, and decodes any audio clips. A muted group zeroes its bus,
 * silencing all its descendants. Audio playback is driven by the Scheduler, which
 * calls `scheduleAudioClip` the way it calls `instrument.playNote`.
 */
import type { ProjectStore, EffectInstance, InstrumentTrack } from "../project/projectStore";
import type { AudioClipData } from "../project/types";
import type { Instrument } from "../instruments/types";
import { groupDepth, groupEffectStage } from "../bank/stages";
import { EngineInstrument } from "../bank/EngineInstrument";
import { ChainEffects } from "./chainEffects";
import { trackInstrument, updateTrackInstrument } from "./trackInstrument";
import { COMPENSATION_GLIDE_SECONDS, MixRouter, masterBus } from "./mixer";
import { createMidiDevice } from "../midi/device/registry";
import { GraphMidiDevice, type NoteTarget } from "../midi/device/GraphMidiDevice";
import type { TransportClock } from "../midi/device/clock";
import { onSlowBlocks, setTransport as setEngineTransport } from "../bank/pool";
import type { BufferSize } from "./bufferSize";
import type { Transport } from "../bank/messages";
import { getAudioBuffer } from "../audioStore";
import { setSampleAssets } from "../samples/sampleRegistry";
import { loadSampleBuffer } from "../samples/builtinUrls";
import { soloMutedTrackIds } from "./mix";
import { audioPlayWindow } from "./audioWindow";
import { loadWorklets } from "../worklets";
import { createListeners } from "../../listeners";

interface TrackNode {
  instrument: Instrument;
  /** The instrument type this node was built for, so a `setInstrument` swap rebuilds it. */
  instrumentType: string;
  gain: GainNode;
  /** The effects after the instrument, live (INST-36.7: in pieces, runs of engine effects as one). */
  effects: ChainEffects;
  /** The effects an engine instrument plays in its own plan, straight after it. */
  absorbed: EffectInstance[];
  /** MIDI-device instances by id; chain order comes from the track's midiDevices list. */
  midiDevices: Map<string, GraphMidiDevice>;
  /** Head of the note pipeline (first device, or the instrument if the chain is empty). */
  noteHead: NoteTarget;
}

/** Stop and disconnect everything an instrument track plays through. */
const disposeTrackNode = (node: TrackNode): void => {
  node.effects.dispose();
  node.midiDevices.forEach((device) => device.dispose());
  node.instrument.dispose();
  node.gain.disconnect();
};

/** The metronome's id in the mix router: not a track, but delayed like one. */
const METRONOME = "metronome";

interface AudioTrackNode {
  /** Where this track's scheduled buffer sources feed in. */
  input: GainNode;
  /** Track volume/mute; feeds the group bus. */
  gain: GainNode;
  effects: ChainEffects;
  /** Currently-playing sources, so playback can be stopped on transport stop. */
  sources: Set<AudioBufferSourceNode>;
}

interface GroupNode {
  /** Where this group's children (tracks/subgroups) sum in. */
  input: GainNode;
  /** Group volume/mute; feeds the parent group's input (or master). */
  output: GainNode;
  effects: ChainEffects;
}

export class AudioEngine {
  private ctx: AudioContext | null = null;
  /**
   * Each track's and group's way to its parent: a delay making up for what's later beside it
   * (INST-36.7, mixer.ts), at none when nothing in the project is late.
   */
  private router: MixRouter | null = null;
  private master: GainNode | null = null;
  /** A master-level bus for the metronome click (independent of any track). */
  private metronomeGain: GainNode | null = null;
  private metronomeVolume = 0.6;
  // --- live input capture (recording) ---
  private inputStream: MediaStream | null = null;
  private inputSource: MediaStreamAudioSourceNode | null = null;
  private captureNode: AudioWorkletNode | null = null;
  /** Silent sink: keeps the capture worklet pulled by the graph without monitoring. */
  private captureSink: GainNode | null = null;
  private captureChunks: Float32Array[] = [];
  private capturing = false;
  private readonly nodes = new Map<string, TrackNode>();
  /** The sound being tried in Explore, outside the project (see `setPreview`). */
  private preview: TrackNode | null = null;
  /** The sample being auditioned from Explore, so a second play (or closing) stops the first. */
  private auditioning: AudioBufferSourceNode | null = null;
  private readonly audioNodes = new Map<string, AudioTrackNode>();
  private readonly groupNodes = new Map<string, GroupNode>();
  /** Decoded audio buffers keyed by OPFS file id (shared across tracks). */
  private readonly audioBuffers = new Map<string, AudioBuffer>();
  private readonly decoding = new Set<string>();
  private project: ProjectStore | null = null;
  /** Each custom device's definition as last played, as JSON: one edited since (a different
   *  definition under the same type) is rebuilt. */
  private readonly playedCustomDefs = new Map<string, string>();
  /** The output buffer the context is made with (INST-36.9); `setBufferSize` remakes it. */
  private size: BufferSize = "interactive";
  /** When the running context was made (BufferControl ignores slow blocks while it settles). */
  private contextMadeAt = -Infinity;
  /** What a remade context restores: the output device picked, the input open, the sound tried. */
  private sinkId: string | null = null;
  private inputDeviceId: string | null = null;
  private previewTrack: InstrumentTrack | null = null;
  /** Who hears the banks' slow blocks, across remade contexts; and the current context's stop. */
  private readonly slowListeners = createListeners<[number]>();
  private stopSlow: (() => void) | null = null;
  private unsubscribe: (() => void) | null = null;
  /** The transport clock MIDI devices read (set by AppShell once the scheduler exists). */
  private transport: TransportClock | null = null;
  private cachedDeviceClock: TransportClock | null = null;

  /** The transport as the scheduler last said, for the new engine's host signals (INST-36.4). */
  private engineTransport: Transport | null = null;

  /**
   * Tell the new engine's banks where the transport is: the scheduler calls this when it plays, stops
   * or the tempo changes, so synced LFOs and delays follow. Nothing is sent until audio starts.
   */
  setTransport(transport: Transport): void {
    this.engineTransport = transport;
    if (this.ctx) setEngineTransport(this.ctx, transport);
  }

  /** Point MIDI devices at the transport clock (the scheduler implements it). */
  setTransportClock(clock: TransportClock): void {
    this.transport = clock;
  }

  /**
   * A stable clock handed to every MIDI device: it reads `this.transport` lazily (devices are built in
   * reconcile, possibly before the scheduler is wired), falling back to sensible stopped-state values.
   */
  private get deviceClock(): TransportClock {
    return (this.cachedDeviceClock ??= this.makeDeviceClock(this));
  }

  /** Build the shared device clock. `engine` is passed (not aliased) so the getters close over it. */
  private makeDeviceClock(engine: AudioEngine): TransportClock {
    return {
      get playing() {
        return engine.transport?.playing ?? false;
      },
      get currentTime() {
        return engine.transport?.currentTime ?? engine.currentTime;
      },
      get secondsPerBeat() {
        return engine.transport?.secondsPerBeat ?? 60 / (engine.project?.tempo ?? 120);
      },
      continuousBeatAtTime: (time) => engine.transport?.continuousBeatAtTime(time) ?? 0,
    };
  }

  get started(): boolean {
    return this.ctx !== null;
  }

  get currentTime(): number {
    return this.ctx?.currentTime ?? 0;
  }

  /** The context's own state, or `"closed"` before audio has been started. */
  get contextState(): AudioContextState {
    return this.ctx?.state ?? "closed";
  }

  /**
   * Park the audio thread, and with it `currentTime` (DAW-33).
   *
   * **A hidden page does not get a hidden audio thread, it gets a starved one.** The graph keeps
   * being asked for samples by hardware that is still running at 48kHz, while the main thread
   * that feeds it is throttled to a wake a second, so the render underruns and the device repeats
   * whatever it has - which is the gargling an idle backgrounded app makes with nothing playing
   * at all. Nothing in the transport can fix that, because the transport is not what is making
   * the sound.
   *
   * Suspending is the only thing that actually stops the render, and it also **freezes
   * `currentTime`**, which is the second half of the bug: while the clock runs on unattended, the
   * app's whole sense of "now" drifts away from the last thing it managed to schedule, and coming
   * back means racing across the gap. A frozen clock has no gap to race.
   */
  async suspend(): Promise<void> {
    if (this.ctx?.state !== "running") return;
    await this.ctx.suspend();
  }

  /**
   * Wake the audio thread. Safari can also park a context on its own (an "interrupted" state
   * outside the spec's three), so this resumes anything that is not already running rather than
   * only what `suspend` parked.
   */
  async resume(): Promise<void> {
    // Anything that is neither already running nor disposed, so Safari's off-spec "interrupted"
    // (what a phone call leaves behind, and it does not lift on its own) is covered by exclusion.
    if (!this.ctx || this.ctx.state === "running" || this.ctx.state === "closed") return;
    await this.ctx.resume();
  }

  /** Must be called from a user gesture. Builds audio for the project's tracks. */
  async start(project: ProjectStore): Promise<void> {
    this.project = project;
    if (this.ctx) {
      await this.ctx.resume();
      return;
    }
    const ctx = new AudioContext({ latencyHint: this.size });
    this.ctx = ctx;
    this.contextMadeAt = Date.now();
    this.stopSlow = onSlowBlocks(ctx, (blocks) => this.slowListeners.emit(blocks));
    setEngineTransport(ctx, this.engineTransport ?? { time: 0, beat: 0, tempo: project.tempo, playing: false });
    this.master = masterBus(ctx);
    this.router = new MixRouter(ctx, (parentId) => this.parentInput(parentId), COMPENSATION_GLIDE_SECONDS);
    // The metronome feeds the master bus (so it is limited with everything else) but is not a
    // track, so it ignores mute/solo and the arrangement. It is as late as the whole mix (INST-36.7),
    // so it clicks in time with what's heard.
    this.metronomeGain = ctx.createGain();
    this.metronomeGain.gain.value = this.metronomeVolume;
    this.router.route(METRONOME, this.metronomeGain, null);
    // Load the worklet processor modules before building the graph, so effect
    // factories can construct AudioWorkletNodes synchronously in reconcile().
    await loadWorklets(ctx);
    this.reconcile();
    this.unsubscribe = project.subscribe(() => this.reconcile());
    await ctx.resume();
  }

  /** The output buffer size the context runs with. */
  get bufferSize(): BufferSize {
    return this.size;
  }

  /** When the running context was made. */
  get startedAt(): number {
    return this.contextMadeAt;
  }

  /** Hear how many blocks rendered late, about once a second while there are any. Returns a stop. */
  onSlowBlocks(listener: (blocks: number) => void): () => void {
    return this.slowListeners.subscribe(listener);
  }

  /**
   * Run with another output buffer size. A context's buffer is fixed when it's made, so a started
   * engine is remade: everything torn down and built again from the project, as at start, then the
   * output device, the input and the sound being tried put back. A brief dropout, so the caller
   * picks a quiet moment (BufferControl). Before audio starts, it's what start will use.
   */
  async setBufferSize(size: BufferSize): Promise<void> {
    if (size === this.size) return;
    this.size = size;
    const project = this.project;
    if (!this.ctx || !project) return;
    const { sinkId, inputDeviceId, previewTrack } = this;
    // The beat runs on while stopped (synced LFOs keep moving), counted from a time on the old
    // clock; the new clock starts again at 0, so carry on from the beat reached, at the new now.
    const transport = this.engineTransport;
    const beat = transport && transport.beat + ((this.currentTime - transport.time) * transport.tempo) / 60;
    this.dispose();
    await this.start(project);
    if (transport && beat !== null) this.setTransport({ ...transport, beat, time: this.currentTime });
    if (sinkId !== null) await this.setOutputDevice(sinkId);
    if (inputDeviceId !== null) await this.enableInput(inputDeviceId || undefined);
    if (previewTrack) this.setPreview(previewTrack);
  }

  /**
   * The custom devices whose definition changed since they were last played (edited), whose live
   * instruments and effects must be rebuilt fresh: an edited device's old nodes must not carry into
   * its new wiring by name. Compared by content, not identity: a load (undo, redo) re-parses every
   * device, and an unchanged one should not cut its notes. The store registers them to play.
   */
  private editedCustomDevices(project: ProjectStore): Set<string> {
    const edited = [...project.customInstruments, ...project.customEffects].filter((device) => {
      const json = JSON.stringify(device);
      const previous = this.playedCustomDefs.get(device.type);
      this.playedCustomDefs.set(device.type, json);
      return previous !== undefined && previous !== json;
    });
    return new Set(edited.map((device) => device.type));
  }

  private reconcile(): void {
    const ctx = this.ctx;
    const project = this.project;
    if (!ctx || !project || !this.master) return;

    const edited = this.editedCustomDevices(project);

    const groups = project.getGroups();
    const tracks = project.getTracks();

    // Keep the sample registry current before (re)building instruments, so a
    // Sampler can resolve its "asset:<id>" ref to a content hash immediately.
    setSampleAssets(project.getSamples());

    // Solo + mute: enforced at the track gain; group buses stay open so a soloed
    // track inside an un-soloed group still routes through (see mix.ts).
    const mutedTracks = soloMutedTrackIds(groups, tracks);

    // Dispose nodes for removed groups/tracks (by kind - ids live in one map).
    const liveGroupIds = new Set(groups.map((group) => group.id));
    for (const [id, node] of this.groupNodes) {
      if (!liveGroupIds.has(id)) {
        node.effects.dispose();
        node.input.disconnect();
        node.output.disconnect();
        this.dropCompensator(id);
        this.groupNodes.delete(id);
      }
    }
    const instrumentIds = new Set(tracks.filter((track) => track.kind === "instrument").map((track) => track.id));
    for (const [id, node] of this.nodes) {
      if (!instrumentIds.has(id)) {
        disposeTrackNode(node);
        this.dropCompensator(id);
        this.nodes.delete(id);
      }
    }
    const audioIds = new Set(tracks.filter((track) => track.kind === "audio").map((track) => track.id));
    for (const [id, node] of this.audioNodes) {
      if (!audioIds.has(id)) {
        this.disposeAudioSources(node);
        node.effects.dispose();
        node.input.disconnect();
        node.gain.disconnect();
        this.dropCompensator(id);
        this.audioNodes.delete(id);
      }
    }

    // Ensure every group node exists before any routing (children may reference
    // a parent created in this same pass).
    for (const group of groups) {
      if (!this.groupNodes.has(group.id)) {
        this.groupNodes.set(group.id, {
          input: ctx.createGain(),
          output: ctx.createGain(),
          effects: new ChainEffects(),
        });
      }
    }

    // Group effect chains and routing.
    for (const group of groups) {
      const node = this.groupNodes.get(group.id)!;
      const depth = groupDepth(groups, group.id);
      node.effects.reconcile(ctx, group.effects, edited, (index) => groupEffectStage(depth, index));
      node.effects.wire(node.input, node.output);
      this.route(group.id, node.output, group.parentId);
      node.output.gain.setTargetAtTime(group.muted ? 0 : group.volume, ctx.currentTime, 0.01);
    }

    // Track nodes, effect chains, and routing into their group.
    for (const track of tracks) {
      if (track.kind === "instrument") {
        let node = this.nodes.get(track.id);
        if (!node) {
          const gain = ctx.createGain();
          const { instrument, absorbed } = trackInstrument(ctx, track.instrumentType, track.params, track.effects);
          node = {
            instrument,
            instrumentType: track.instrumentType,
            gain,
            effects: new ChainEffects(),
            absorbed,
            midiDevices: new Map(),
            noteHead: instrument,
          };
          this.nodes.set(track.id, node);
        } else if (
          node.instrumentType !== track.instrumentType ||
          [track.instrumentType, ...node.absorbed.map((effect) => effect.type)].some((type) => edited.has(type))
        ) {
          // The track's instrument was swapped (setInstrument, e.g. assigning one to an
          // empty track), or its custom definition was edited, or one of the effects it plays
          // itself: dispose the old node and build the new one over the same gain.
          node.instrument.dispose();
          const made = trackInstrument(ctx, track.instrumentType, track.params, track.effects);
          node.instrument = made.instrument;
          node.absorbed = made.absorbed;
          node.instrumentType = track.instrumentType;
        } else if (node.instrument instanceof EngineInstrument) {
          node.absorbed = updateTrackInstrument(
            node.instrument,
            track.instrumentType,
            track.params,
            track.effects,
            node.absorbed,
          );
        }
        // The effects the instrument doesn't play itself follow it.
        node.effects.reconcile(ctx, track.effects.slice(node.absorbed.length), edited);
        node.effects.wire(node.instrument.output, node.gain);
        // MIDI devices decorate the note path (no audio), terminating in the instrument.
        this.reconcileMidiDevices(node, track);
        this.route(track.id, node.gain, track.parentId);
        node.gain.gain.setTargetAtTime(mutedTracks.has(track.id) ? 0 : track.volume, ctx.currentTime, 0.01);
      } else {
        let node = this.audioNodes.get(track.id);
        if (!node) {
          node = { input: ctx.createGain(), gain: ctx.createGain(), effects: new ChainEffects(), sources: new Set() };
          this.audioNodes.set(track.id, node);
        }
        node.effects.reconcile(ctx, track.effects, edited);
        node.effects.wire(node.input, node.gain);
        this.route(track.id, node.gain, track.parentId);
        node.gain.gain.setTargetAtTime(mutedTracks.has(track.id) ? 0 : track.volume, ctx.currentTime, 0.01);
        for (const clip of track.clips) this.ensureDecoded(clip.fileId);
      }
    }
    this.compensateLatency();
  }

  /** Route a track or group into its parent through its compensating delay. */
  private route(id: string, from: AudioNode, parentId: string | null): void {
    this.router?.route(id, from, parentId);
  }

  /** Set every compensating delay from how late each track's and group's own chain is. */
  private compensateLatency(): void {
    const project = this.project!;
    const mixNode = (id: string, parentId: string | null, latency: number) => ({ id, parentId, latency });
    const tracks = project.getTracks().map((track) => {
      const node = track.kind === "instrument" ? this.nodes.get(track.id) : this.audioNodes.get(track.id);
      const own = node && "instrument" in node ? (node.instrument.latency ?? 0) : 0;
      return mixNode(track.id, track.parentId, own + (node?.effects.latency() ?? 0));
    });
    const groups = project
      .getGroups()
      .map((group) => mixNode(group.id, group.parentId, this.groupNodes.get(group.id)?.effects.latency() ?? 0));
    const total = this.router?.compensate(tracks, groups) ?? 0;
    this.router?.set(METRONOME, total);
  }

  /** Drop a track's or group's compensating delay, as it goes. */
  private dropCompensator(id: string): void {
    this.router?.drop(id);
  }

  /** The bus a child routes into: its parent group's input, or master at top level. */
  private parentInput(parentId: string | null): AudioNode {
    const parent = parentId ? this.groupNodes.get(parentId) : undefined;
    return parent?.input ?? this.master!;
  }

  private disposeAudioSources(node: AudioTrackNode): void {
    for (const src of node.sources) {
      try {
        src.stop();
        src.disconnect();
      } catch {
        // already stopped
      }
    }
    node.sources.clear();
  }

  /**
   * Sync a track's MIDI-device chain against its instances, then relink the note
   * pipeline. Devices carry no audio, so this only creates/disposes interpreters and
   * repoints their `next`: d0 -> d1 -> ... -> instrument. Bypassed devices stay linked
   * (they pass through internally) so a mid-note bypass never strands held notes.
   */
  private reconcileMidiDevices(node: TrackNode, track: InstrumentTrack): void {
    const want = new Set(track.midiDevices.map((device) => device.id));
    for (const [id, device] of node.midiDevices) {
      if (!want.has(id)) {
        device.dispose();
        node.midiDevices.delete(id);
      }
    }
    for (const instance of track.midiDevices) {
      if (!node.midiDevices.has(instance.id))
        node.midiDevices.set(
          instance.id,
          createMidiDevice(instance.type, instance.params, node.instrument, this.deviceClock),
        );
    }
    // Relink in the track's order, tail terminating in the instrument.
    const chain = track.midiDevices.map((instance) => node.midiDevices.get(instance.id)!);
    chain.forEach((device, index) => {
      device.bypassed = track.midiDevices[index].bypassed;
      device.setNext(chain[index + 1] ?? node.instrument);
    });
    node.noteHead = chain[0] ?? node.instrument;
  }

  /** Fetch + decode an audio file once, keyed by its OPFS id. */
  private ensureDecoded(fileId: string): void {
    if (!fileId || this.audioBuffers.has(fileId) || this.decoding.has(fileId)) return;
    this.decoding.add(fileId);
    getAudioBuffer(fileId)
      .then((arr) => this.ctx?.decodeAudioData(arr))
      .then((buffer) => {
        if (buffer) this.audioBuffers.set(fileId, buffer);
      })
      .catch(() => undefined)
      .finally(() => this.decoding.delete(fileId));
  }

  /**
   * Schedule one of an audio track's clips to play at `when` (audio-clock seconds).
   * `maxDurationSec` caps how long it plays from `when` (the scheduler passes the time
   * to the loop boundary, so a region overrunning the loop is cut instead of overlapping
   * the loop's restart).
   */
  scheduleAudioClip(trackId: string, clip: AudioClipData, when: number, maxDurationSec?: number): void {
    const ctx = this.ctx;
    const node = this.audioNodes.get(trackId);
    if (!ctx || !node) return;
    const buffer = this.audioBuffers.get(clip.fileId);
    if (!buffer) return; // not decoded yet - silently skip this pass

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    if (clip.gain !== 1) {
      const clipGain = ctx.createGain();
      clipGain.gain.value = clip.gain;
      source.connect(clipGain);
      clipGain.connect(node.input);
    } else {
      source.connect(node.input);
    }
    // Play only the slice of the buffer under the (grid-fixed) loop window; the
    // scheduler re-triggers it to tile/repeat across a placement. The clip's grid
    // slide moves the buffer under the window, so the played slice shifts with it.
    const win = audioPlayWindow(
      clip.loopStartSec,
      clip.loopEndSec,
      clip.gridOffsetSec,
      buffer.duration,
      maxDurationSec,
    );
    if (!win) {
      try {
        source.disconnect();
      } catch {
        /* not connected */
      }
      return; // the window fell entirely off the buffer - nothing to play
    }
    if (win.offset > 0 || win.span < buffer.duration || win.delaySec > 0)
      source.start(when + win.delaySec, win.offset, win.span);
    else source.start(when);
    node.sources.add(source);
    source.onended = () => {
      node.sources.delete(source);
      try {
        source.disconnect();
      } catch {
        // ignore
      }
    };
  }

  /**
   * Schedule a metronome click at `when` (audio-clock seconds). A short pitched
   * blip with a fast decay; the accented (downbeat) click is higher and louder.
   * Each click is a throwaway oscillator + envelope into the metronome bus.
   */
  scheduleClick(when: number, accent: boolean): void {
    const ctx = this.ctx;
    if (!ctx || !this.metronomeGain) return;
    const t = Math.max(when, ctx.currentTime);
    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    osc.frequency.value = accent ? 2000 : 1000;
    const peak = accent ? 0.9 : 0.55;
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(peak, t + 0.001);
    env.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
    osc.connect(env);
    env.connect(this.metronomeGain);
    osc.start(t);
    osc.stop(t + 0.06);
    osc.onended = () => {
      try {
        osc.disconnect();
        env.disconnect();
      } catch {
        // already torn down
      }
    };
  }

  /** Set the metronome click level (0..1). */
  setMetronomeVolume(volume: number): void {
    this.metronomeVolume = Math.min(1, Math.max(0, volume));
    if (this.metronomeGain && this.ctx) {
      this.metronomeGain.gain.setTargetAtTime(this.metronomeVolume, this.ctx.currentTime, 0.01);
    }
  }

  // --- live input capture (recording) --------------------------------------
  /**
   * Best-effort round-trip latency estimate (seconds) for recording compensation:
   * output + base latency. The browser does not expose input latency, so this is
   * a v1 estimate; a loopback calibration would make it exact (see apm: "Recording and input (design)").
   */
  inputLatencySec(): number {
    const ctx = this.ctx;
    if (!ctx) return 0;
    const c = ctx as AudioContext & { outputLatency?: number };
    return (c.outputLatency ?? 0) + (ctx.baseLatency ?? 0);
  }

  /** Enumerate audio input devices (labels require a prior getUserMedia grant). */
  async listInputDevices(): Promise<{ deviceId: string; label: string }[]> {
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.enumerateDevices) return [];
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices
      .filter((device) => device.kind === "audioinput")
      .map((device) => ({ deviceId: device.deviceId, label: device.label }));
  }

  /** Enumerate audio output devices (labels require a prior media-permission grant). */
  async listOutputDevices(): Promise<{ deviceId: string; label: string }[]> {
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.enumerateDevices) return [];
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices
      .filter((device) => device.kind === "audiooutput")
      .map((device) => ({ deviceId: device.deviceId, label: device.label }));
  }

  /** Whether output-device routing (AudioContext.setSinkId) is available in this browser. */
  get canSelectOutput(): boolean {
    return typeof AudioContext !== "undefined" && "setSinkId" in AudioContext.prototype;
  }

  /** Route master output to a device by id ("" / null = system default). Chrome-only; a
   *  bad id is ignored so playback stays on the current sink. */
  async setOutputDevice(deviceId: string | null): Promise<void> {
    this.sinkId = deviceId;
    const ctx = this.ctx as (AudioContext & { setSinkId?: (id: string) => Promise<void> }) | null;
    if (!ctx?.setSinkId) return;
    try {
      await ctx.setSinkId(deviceId ?? "");
    } catch {
      // invalid/unavailable device - keep the current output
    }
  }

  /**
   * Open a mic input and wire it for capture: `MediaStreamSource -> captureNode ->
   * silent sink`. The voice DSP is disabled (or Chrome mangles the signal). The
   * source feeds the worklet only during `startRecording`; monitoring is hardware/
   * direct by default, so the input is never routed to the audible output.
   */
  async enableInput(deviceId?: string): Promise<void> {
    const ctx = this.ctx;
    if (!ctx) throw new Error("Audio engine not started");
    this.disableInput();
    this.inputDeviceId = deviceId ?? "";
    await loadWorklets(ctx); // idempotent; ensures the capture processor is registered
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: deviceId ? { exact: deviceId } : undefined,
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        channelCount: 1,
      },
    });
    this.inputStream = stream;
    this.inputSource = ctx.createMediaStreamSource(stream);
    this.captureNode = new AudioWorkletNode(ctx, "capture-processor");
    this.captureNode.port.onmessage = (e) => {
      if (this.capturing && e.data instanceof Float32Array) this.captureChunks.push(e.data);
    };
    // A zero-gain sink to the destination so the worklet is pulled (and thus runs)
    // without being heard. The source is connected only while recording.
    this.captureSink = ctx.createGain();
    this.captureSink.gain.value = 0;
    this.captureNode.connect(this.captureSink);
    this.captureSink.connect(ctx.destination);
  }

  /** Begin collecting input frames; returns the audio-clock start time (seconds). */
  startRecording(): number {
    const ctx = this.ctx;
    if (!ctx || !this.inputSource || !this.captureNode) throw new Error("Input not enabled");
    this.captureChunks = [];
    this.capturing = true;
    this.inputSource.connect(this.captureNode);
    return ctx.currentTime;
  }

  /**
   * Stop collecting and return the captured mono samples. Awaits a short drain so
   * worklet messages already posted (but not yet delivered) are not dropped.
   */
  async stopRecording(): Promise<{ samples: Float32Array; sampleRate: number } | null> {
    const ctx = this.ctx;
    if (!ctx || !this.capturing) return null;
    try {
      this.inputSource?.disconnect(this.captureNode!);
    } catch {
      // already disconnected
    }
    await new Promise((resolve) => setTimeout(resolve, 60));
    this.capturing = false;
    const total = this.captureChunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const samples = new Float32Array(total);
    let offset = 0;
    for (const chunk of this.captureChunks) {
      samples.set(chunk, offset);
      offset += chunk.length;
    }
    this.captureChunks = [];
    return { samples, sampleRate: ctx.sampleRate };
  }

  /** Close the mic input and tear down the capture nodes. */
  disableInput(): void {
    this.capturing = false;
    this.captureChunks = [];
    try {
      this.inputSource?.disconnect();
      this.captureNode?.disconnect();
      this.captureSink?.disconnect();
    } catch {
      // already torn down
    }
    for (const track of this.inputStream?.getTracks() ?? []) track.stop();
    this.inputStream = null;
    this.inputDeviceId = null;
    this.inputSource = null;
    this.captureNode = null;
    this.captureSink = null;
  }

  /** Stop all currently-playing audio clips (called on transport stop). */
  stopAllAudio(): void {
    for (const node of this.audioNodes.values()) this.disposeAudioSources(node);
  }

  getInstrument(trackId: string): Instrument | undefined {
    return this.nodes.get(trackId)?.instrument;
  }

  /**
   * The head of a track's note pipeline: its MIDI-device chain terminating in the
   * instrument (or the instrument directly if there are no devices). Note sources
   * (live input, the scheduler, MCP live notes) drive this instead of the instrument
   * so devices transform every event; the instrument itself stays reachable via
   * `getInstrument` for audio wiring.
   */
  getNoteTarget(trackId: string): NoteTarget | undefined {
    return this.nodes.get(trackId)?.noteHead;
  }

  /**
   * Play a track that is not in the project: the sound being tried in Explore (COMM-1.4.1). It is
   * built from its own scratch track the same way `reconcile` builds a project track, but kept
   * apart from `nodes`, so a reconcile neither touches it nor counts it, and nothing about it is
   * saved. It feeds the master bus directly (no group, no mute/solo). `null` tears it down.
   */
  setPreview(track: InstrumentTrack | null): void {
    this.previewTrack = track;
    if (this.preview) {
      this.preview.noteHead.allNotesOff();
      disposeTrackNode(this.preview);
      this.preview = null;
    }
    const ctx = this.ctx;
    if (!track || !ctx || !this.master) return;
    const { instrument, absorbed } = trackInstrument(ctx, track.instrumentType, track.params, track.effects);
    const node: TrackNode = {
      instrument,
      instrumentType: track.instrumentType,
      gain: ctx.createGain(),
      effects: new ChainEffects(),
      absorbed,
      midiDevices: new Map(),
      noteHead: instrument,
    };
    node.effects.reconcile(ctx, track.effects.slice(absorbed.length), new Set());
    node.effects.wire(node.instrument.output, node.gain);
    this.reconcileMidiDevices(node, track);
    node.gain.gain.value = track.volume;
    node.gain.connect(this.master);
    this.preview = node;
  }

  /**
   * Play a sample once, straight to the master bus, for Explore's sample panel. Not a track, not an
   * edit; a second play cuts the first. Resolves with its length in seconds, or null if it cannot be
   * loaded (or audio has not started).
   */
  async playSample(ref: string): Promise<number | null> {
    this.stopSample();
    const ctx = this.ctx;
    if (!ctx || !this.master) return null;
    const buffer = await loadSampleBuffer(ctx, ref);
    if (!buffer) return null;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(this.master);
    source.onended = () => {
      if (this.auditioning === source) this.auditioning = null;
    };
    source.start();
    this.auditioning = source;
    return buffer.duration;
  }

  stopSample(): void {
    try {
      this.auditioning?.stop();
    } catch {
      // already stopped
    }
    this.auditioning = null;
  }

  /** A sample's length in seconds (decoded once and cached), or null if it cannot be loaded. */
  async sampleDuration(ref: string): Promise<number | null> {
    if (!this.ctx) return null;
    return (await loadSampleBuffer(this.ctx, ref))?.duration ?? null;
  }

  /** The head of the preview's note pipeline, while one is open. */
  getPreviewTarget(): NoteTarget | undefined {
    return this.preview?.noteHead;
  }

  dispose(): void {
    this.setPreview(null);
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.disableInput();
    this.nodes.forEach(disposeTrackNode);
    this.nodes.clear();
    for (const node of this.audioNodes.values()) {
      this.disposeAudioSources(node);
      node.effects.dispose();
      node.input.disconnect();
      node.gain.disconnect();
    }
    this.audioNodes.clear();
    for (const node of this.groupNodes.values()) {
      node.effects.dispose();
      node.input.disconnect();
      node.output.disconnect();
    }
    this.groupNodes.clear();
    this.router?.dispose();
    this.router = null;
    this.audioBuffers.clear();
    this.decoding.clear();
    this.metronomeGain?.disconnect();
    this.master?.disconnect();
    this.stopSlow?.();
    this.stopSlow = null;
    void this.ctx?.close();
    this.ctx = null;
    this.master = null;
    this.metronomeGain = null;
  }
}
