/**
 * The selected track's effect chain, rendered inline in the signal-chain strip:
 * one device block per effect (DAW-61.3: bypass, dragged to reorder, remove, and its sections). Sits in
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
import { useChainDrag } from "./devices/useChainDrag";
import { LibraryUpdate } from "./devices/LibraryUpdate";

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
  const effects = track?.effects ?? [];
  const dragOf = useChainDrag(
    effects.map((effect) => effect.id),
    (effectId, toIndex) => dispatch({ type: "moveEffect", hostId: trackId, effectId, toIndex }),
  );
  if (!track) return null;

  return (
    <>
      {effects.map((fx) => {
        const store = projectStore.getEffect(trackId, fx.id)?.params;
        if (!store) return null;
        const info = effectCatalogEntry(fx.type);
        const schema = effectSchema(fx.type);
        return (
          <DeviceBlock
            key={fx.id}
            device={info}
            label={info.label}
            kind="fx"
            foldKey={fx.id}
            graph="effect"
            bypass={{
              bypassed: fx.bypassed,
              onToggle: () =>
                dispatch({ type: "bypassEffect", hostId: trackId, effectId: fx.id, bypassed: !fx.bypassed }),
            }}
            actions={
              info.custom && (
                <LibraryUpdate type={fx.type} kind="effect" projectStore={projectStore} dispatch={dispatch} />
              )
            }
            remove={{
              title: "Remove effect",
              run: () => dispatch({ type: "removeEffect", hostId: trackId, effectId: fx.id }),
            }}
            drag={dragOf(fx.id)}
            schema={schema}
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
        );
      })}
    </>
  );
}
