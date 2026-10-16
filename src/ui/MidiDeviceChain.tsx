/**
 * The selected instrument track's MIDI-device chain, rendered inline in the signal-chain
 * strip BEFORE the instrument: one device block per device (DAW-61.3: bypass / reorder /
 * remove, and its sections). Devices transform note events (live + playback) on their way to the
 * instrument. Mirrors EffectChain.tsx; every edit goes through the project store, the same
 * model MCP drives. Adding a device is done from the library panel (MIDI FX section).
 */
import type { ProjectStore } from "../audio/project/projectStore";
import { useProject } from "../audio/project/useProject";
import { midiDeviceCatalogEntry, midiDeviceSchema } from "../audio/midi/device/catalog";
import type { Dispatch } from "../audio/commands/types";
import { midiDeviceParamKey } from "../audio/commands/authorship";
import { DeviceBlock } from "./devices/DeviceBlock";
import { DeviceSections } from "./devices/DeviceSections";
import { DeviceSummary } from "./devices/DeviceSummary";
import { ChainActions } from "./devices/ChainActions";
import { FlowArrow } from "./EffectChain";

export function MidiDeviceChain({
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
  if (!track || track.kind !== "instrument") return null;
  const devices = track.midiDevices;

  return (
    <>
      {devices.map((device, i) => {
        const store = projectStore.getMidiDevice(trackId, device.id)?.params;
        if (!store) return null;
        const info = midiDeviceCatalogEntry(device.type);
        const schema = midiDeviceSchema(device.type);
        // Each device carries its own trailing arrow (into the next device / the instrument)
        // in one flex group, so the arrow stays glued to its right edge on wrap.
        return (
          <div key={device.id} className="flex items-start self-start shrink-0 min-w-0">
            <DeviceBlock
              device={info}
              label={info.label}
              kind="midi"
              foldKey={device.id}
              bypass={{
                bypassed: device.bypassed,
                onToggle: () =>
                  dispatch({ type: "bypassMidiDevice", trackId, deviceId: device.id, bypassed: !device.bypassed }),
              }}
              actions={
                <ChainActions
                  index={i}
                  count={devices.length}
                  onMove={(toIndex) => dispatch({ type: "moveMidiDevice", trackId, deviceId: device.id, toIndex })}
                  onRemove={() => dispatch({ type: "removeMidiDevice", trackId, deviceId: device.id })}
                  removeTitle="Remove MIDI device"
                />
              }
              summary={<DeviceSummary schema={schema} store={store} />}
            >
              <DeviceSections
                label={info.label}
                schema={schema}
                store={store}
                onChange={(id, value) =>
                  dispatch({ type: "setMidiDeviceParam", trackId, deviceId: device.id, id, value })
                }
                authorOf={(paramId) => projectStore.authorOf(midiDeviceParamKey(trackId, device.id, paramId))}
                foldKey={device.id}
              />
            </DeviceBlock>
            <FlowArrow />
          </div>
        );
      })}
    </>
  );
}
