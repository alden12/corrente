/**
 * A track's or a group's live effect chain (INST-36.7), kept in step with its effect instances. The
 * chain is realized in pieces (bank/chainPlan.ts): each run of engine effects one engine slot with
 * its mix and bypass inside, every other effect on its own. AudioEngine keeps one per track and group.
 *
 * - **A piece is made again** when what it's made of changes, when it moves to another stage of the
 *   signal flow (an engine slot's bank can't follow), or when its custom definition was edited.
 * - **A run whose effects change reloads in place** if it shares an effect with a run that went and
 *   stays at its stage: the effects it keeps carry on (EngineDevice), so an echo's tail survives
 *   another effect being added beside it.
 * - **Bypass:** a plain effect is left out of the wiring; a run's effects are bypassed by param,
 *   inside its plan, so a run stays wired.
 */
import type { EffectInstance } from "../project/projectStore";
import type { Effect } from "../effects/types";
import { createEffect } from "../effects/registry";
import { trackEffectStage } from "../bank/stages";
import { applyBypass, chainPlan, memberOf, pieceKey, piecesOf, runEffects, type ChainPiece } from "../bank/chainPlan";
import type { EngineEffect } from "../bank/EngineEffect";

interface LivePiece {
  piece: ChainPiece;
  /** In order: one effect, or a run's slots (one, or one per effect if the run split). */
  effects: Effect[];
  /** What keys it, for a keyed effect's run (part 5): another key makes it again. */
  key?: AudioNode;
}

export class ChainEffects {
  private live = new Map<string, LivePiece>();
  /** The chain as last reconciled, in pieces, for wiring. */
  private order: string[] = [];

  /**
   * Bring the live pieces in line with `chain`: make the new ones, drop the gone, remake the changed.
   * `stageAt` gives the stage of the effect at each place in the chain; `keys`, the key of each
   * effect another track keys, by id (part 5: none until a project can say so, DAW-63).
   */
  reconcile(
    context: BaseAudioContext,
    chain: EffectInstance[],
    edited: Set<string>,
    stageAt: (index: number) => number = trackEffectStage,
    keys: ReadonlyMap<string, AudioNode> = new Map(),
  ): void {
    const place = new Map(chain.map((effect, index) => [effect.id, index]));
    const stageOf = (effect: EffectInstance) => stageAt(place.get(effect.id)!);
    const keyOf = (piece: ChainPiece) =>
      piece.kind === "run" ? piece.effects.map((effect) => keys.get(effect.id)).find((key) => key) : undefined;
    const pieces = piecesOf(chain, new Set(keys.keys()));
    const wanted = new Map(pieces.map((piece) => [pieceKey(piece), piece]));
    // Runs that went, on one slot: one may be reloaded as a run that came.
    const gone: LivePiece[] = [];
    for (const [key, live] of this.live) {
      const { piece, effects } = live;
      const next = wanted.get(key);
      const stale = !next || (piece.kind === "single" && edited.has(piece.effect.type)) || keyOf(next) !== live.key;
      const moved =
        next !== undefined && effects[0]?.stage !== undefined && effects[0].stage !== stageOf(firstOf(next));
      if (!stale && !moved) continue;
      this.live.delete(key);
      if (!next && piece.kind === "run" && effects.length === 1 && !live.key) gone.push(live);
      else effects.forEach((effect) => effect.dispose());
    }
    for (const [id, piece] of wanted) {
      const live = this.live.get(id);
      if (live) {
        live.piece = piece;
        if (piece.kind === "run")
          (live.effects as EngineEffect[]).forEach((effect) => applyBypass(effect, effect.bypass, piece.effects));
        continue;
      }
      const key = keyOf(piece);
      const reloaded = piece.kind === "run" && !key ? this.reloadGone(gone, piece.effects, stageOf) : undefined;
      if (reloaded) {
        this.live.set(id, { piece, effects: [reloaded] });
        continue;
      }
      const effects =
        piece.kind === "run"
          ? runEffects(context, piece.effects, stageOf, keys)
          : [createEffect(piece.effect.type, context, piece.effect.params, { stage: stageOf(piece.effect) })];
      this.live.set(id, { piece, effects, ...(key ? { key } : {}) });
    }
    gone.forEach(({ effects }) => effects.forEach((effect) => effect.dispose()));
    this.order = pieces.map(pieceKey);
  }

  /**
   * A gone run's slot reloaded as the run of `effects`, if one shares an effect with it and is at its
   * stage, and they compose; taken out of `gone`.
   */
  private reloadGone(
    gone: LivePiece[],
    effects: EffectInstance[],
    stageOf: (effect: EffectInstance) => number,
  ): EngineEffect | undefined {
    const ids = new Set(effects.map((effect) => effect.id));
    const index = gone.findIndex(
      ({ piece, effects: live }) =>
        piece.kind === "run" &&
        piece.effects.some((effect) => ids.has(effect.id)) &&
        live[0].stage === stageOf(effects[0]),
    );
    const plan =
      index >= 0
        ? chainPlan(
            effects.map((effect) => memberOf(effect)),
            false,
          )
        : undefined;
    if (!plan) return undefined;
    const [{ effects: live }] = gone.splice(index, 1);
    const effect = live[0] as EngineEffect;
    // Bypass before the reload, so an effect being added knows where to ramp to as it fades in.
    applyBypass(effect, plan.bypass, effects);
    effect.reload(plan);
    return effect;
  }

  /** Wire `source` through the chain into `dest`, leaving out bypassed plain effects. */
  wire(source: AudioNode, dest: AudioNode): void {
    source.disconnect();
    this.live.forEach(({ effects }) => effects.forEach((effect) => effect.output.disconnect()));
    let cursor = source;
    for (const key of this.order) {
      const live = this.live.get(key);
      if (!live || (live.piece.kind === "single" && live.piece.effect.bypassed)) continue;
      for (const effect of live.effects) {
        cursor.connect(effect.input);
        cursor = effect.output;
      }
    }
    cursor.connect(dest);
  }

  /** How many samples late the chain as wired makes its signal: its effects' latencies summed. */
  latency(): number {
    return this.order
      .flatMap((key) => this.live.get(key) ?? [])
      .filter(({ piece }) => !(piece.kind === "single" && piece.effect.bypassed))
      .flatMap(({ effects }) => effects)
      .reduce((total, effect) => total + (effect.latency ?? 0), 0);
  }

  /** Every live effect, in no particular order. */
  effects(): Effect[] {
    return [...this.live.values()].flatMap(({ effects }) => effects);
  }

  dispose(): void {
    this.effects().forEach((effect) => effect.dispose());
    this.live.clear();
    this.order = [];
  }
}

const firstOf = (piece: ChainPiece) => (piece.kind === "run" ? piece.effects[0] : piece.effect);
