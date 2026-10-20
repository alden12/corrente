/**
 * The selected track's instrument as a device block in the rack (DAW-61.3). Fully schema-driven
 * (no per-instrument-type UI): `DeviceSections` groups the params into labeled sections by their id
 * namespace (`osc.` / `filter.` / `env.` / ...) in signal-flow order, so an instrument reads like a
 * hardware synth panel rather than an undifferentiated bank of faders. A new engine with its own
 * schema gets the same treatment for free.
 */
import type { ParamStore } from "../audio/params/store";
import { instrumentSchema, catalogEntry } from "../audio/instruments/catalog";
import type { Dispatch } from "../audio/commands/types";
import type { ProjectStore } from "../audio/project/projectStore";
import { paramKey } from "../audio/commands/authorship";
import type { SampleAsset } from "../audio/samples/catalog";
import { importSampleFile } from "../audio/samples/importSample";
import type { SampleContext } from "./Knob";
import { DeviceBlock } from "./devices/DeviceBlock";
import { DeviceSections } from "./devices/DeviceSections";
import { instrumentFold } from "./devices/deviceFolds";
import { LibraryUpdate } from "./devices/LibraryUpdate";

export function InstrumentPanel({
  params,
  instrumentType,
  trackId,
  dispatch,
  samples,
  onRevealSamples,
  projectStore,
}: {
  params: ParamStore;
  instrumentType: string;
  trackId: string;
  dispatch: Dispatch;
  /** The project sample library, threaded down so a `sample` param can browse/import. */
  samples: SampleAsset[];
  /** Reveal the Samples library view (offered by an empty sample picker). */
  onRevealSamples?: () => void;
  /** Supplies per-param last-editor authorship for the knob tint. */
  projectStore: ProjectStore;
}) {
  const info = catalogEntry(instrumentType);
  const schema = instrumentSchema(instrumentType);
  const sampleContext: SampleContext = {
    assets: samples,
    onImportFile: (file: File) => importSampleFile(file, samples, dispatch),
    onReveal: onRevealSamples,
  };
  return (
    <DeviceBlock
      device={info}
      label={info.label}
      kind="instr"
      foldKey={instrumentFold(trackId)}
      params={schema.length}
      actions={
        info.custom && (
          <LibraryUpdate type={instrumentType} kind="instrument" projectStore={projectStore} dispatch={dispatch} />
        )
      }
    >
      <DeviceSections
        label={info.label}
        schema={schema}
        store={params}
        variant="slider"
        onChange={(id, value) => dispatch({ type: "setParam", trackId, id, value })}
        authorOf={(paramId) => projectStore.authorOf(paramKey(trackId, paramId))}
        foldKey={instrumentFold(trackId)}
        sampleContext={sampleContext}
      />
    </DeviceBlock>
  );
}
