/**
 * A track's or a group's live effect chain (INST-36.7), kept in step with its effect instances. The
 * chain is realized in pieces (bank/chainPlan.ts): each run of engine effects one engine slot with
 * its mix and bypass inside, every other effect on its own. AudioEngine keeps one per track and group.
 *
 * - **A piece is made again** when what it's made of changes (a run's effects or their order), when
 *   it moves to another stage of the signal flow (an engine slot's bank can't follow), or when its
 *   custom definition was edited.
 * - **Bypass:** a plain effect is left out of the wiring; a run's effects are bypassed by param,
 *   inside its plan, so a run stays wired.
 */
import type { EffectInstance } from "../project/projectStore";
import type { Effect } from "../effects/types";
import { createEffect } from "../effects/registry";
import { trackEffectStage } from "../bank/stages";
import { applyBypass, pieceKey, piecesOf, runEffects, type ChainPiece } from "../bank/chainPlan";
import type { EngineEffect } from "../bank/EngineEffect";

interface LivePiece {
  piece: ChainPiece;
  /** In order: one effect, or a run's slots (one, or one per effect if the run split). */
  effects: Effect[];
}

export class ChainEffects {
  private live = new Map<string, LivePiece>();
  /** The chain as last reconciled, in pieces, for wiring. */
  private order: string[] = [];

  /**
   * Bring the live pieces in line with `chain`: make the new ones, drop the gone, remake the changed.
   * `stageAt` gives the stage of the effect at each place in the chain.
   */
  reconcile(
    context: BaseAudioContext,
    chain: EffectInstance[],
    edited: Set<string>,
    stageAt: (index: number) => number = trackEffectStage,
  ): void {
    const place = new Map(chain.map((effect, index) => [effect.id, index]));
    const stageOf = (effect: EffectInstance) => stageAt(place.get(effect.id)!);
    const pieces = piecesOf(chain);
    const wanted = new Map(pieces.map((piece) => [pieceKey(piece), piece]));
    for (const [key, { piece, effects }] of this.live) {
      const next = wanted.get(key);
      const stale = !next || (piece.kind === "single" && edited.has(piece.effect.type));
      const moved =
        next !== undefined && effects[0]?.stage !== undefined && effects[0].stage !== stageOf(firstOf(next));
      if (stale || moved) {
        effects.forEach((effect) => effect.dispose());
        this.live.delete(key);
      }
    }
    for (const [key, piece] of wanted) {
      const live = this.live.get(key);
      if (live) {
        live.piece = piece;
        if (piece.kind === "run")
          (live.effects as EngineEffect[]).forEach((effect) => applyBypass(effect, effect.bypass, piece.effects));
        continue;
      }
      const effects =
        piece.kind === "run"
          ? runEffects(context, piece.effects, stageOf)
          : [createEffect(piece.effect.type, context, piece.effect.params, { stage: stageOf(piece.effect) })];
      this.live.set(key, { piece, effects });
    }
    this.order = pieces.map(pieceKey);
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
