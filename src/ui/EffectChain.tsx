/**
 * The selected track's effect chain, rendered inline in the signal-chain strip:
 * one device block per effect (DAW-61.3: bypass / reorder / remove, and its sections). Sits in
 * CenterWorkbench's horizontal-scrolling row after the instrument card. Every edit
 * goes through the project store, the same model MCP drives. (Adding an effect from
 * the UI is being reworked - removed for now; MCP add_effect still works.)
 */
import type { ProjectStore } from "../audio/project/projectStore";
import { useProject } from "../audio/project/useProject";
import { effectCatalogEntry, effectSchema } from "../audio/effects/catalog";
import type { Dispatch } from "../audio/commands/types";
import { effectParamKey } from "../audio/commands/authorship";
import { DeviceBlock } from "./devices/DeviceBlock";
import { DeviceSections } from "./devices/DeviceSections";
import { DeviceSummary } from "./devices/DeviceSummary";
import { ChainActions } from "./devices/ChainActions";

/** The signal-flow arrow. Placed to the RIGHT of an outputting device (and kept in the
 *  same flex group as that device) so it trails cleanly instead of leading a wrapped row. */
export function FlowArrow() {
  return <div className="self-center text-faint text-sm px-1">→</div>;
}

export function EffectChain({
  projectStore,
  trackId,
  dispatch,
}: {
  projectStore: ProjectStore;
  trackId: string;
  dispatch: Dispatch;
}) {
  const project = useProject(projectStore);
  const track = project.tracks.find((track) => track.id === trackId);
  if (!track) return null;
  const effects = track.effects;

  return (
    <>
      {effects.map((fx, i) => {
        const store = projectStore.getEffect(trackId, fx.id)?.params;
        if (!store) return null;
        const info = effectCatalogEntry(fx.type);
        const schema = effectSchema(fx.type);
        // Each effect carries its own trailing arrow (into the next effect) in one flex group,
        // so the arrow stays glued to the device's right edge on wrap.
        return (
          <div key={fx.id} className="flex items-start self-start shrink-0 min-w-0">
            <DeviceBlock
              device={info}
              label={info.label}
              kind="fx"
              foldKey={fx.id}
              bypass={{
                bypassed: fx.bypassed,
                onToggle: () =>
                  dispatch({ type: "bypassEffect", hostId: trackId, effectId: fx.id, bypassed: !fx.bypassed }),
              }}
              actions={
                <ChainActions
                  index={i}
                  count={effects.length}
                  onMove={(toIndex) => dispatch({ type: "moveEffect", hostId: trackId, effectId: fx.id, toIndex })}
                  onRemove={() => dispatch({ type: "removeEffect", hostId: trackId, effectId: fx.id })}
                  removeTitle="Remove effect"
                />
              }
              summary={<DeviceSummary schema={schema} store={store} />}
            >
              <DeviceSections
                label={info.label}
                schema={schema}
                store={store}
                onChange={(id, value) =>
                  dispatch({ type: "setEffectParam", hostId: trackId, effectId: fx.id, id, value })
                }
                authorOf={(paramId) => projectStore.authorOf(effectParamKey(trackId, fx.id, paramId))}
                foldKey={fx.id}
              />
            </DeviceBlock>
            {i < effects.length - 1 ? <FlowArrow /> : null}
          </div>
        );
      })}
    </>
  );
}
