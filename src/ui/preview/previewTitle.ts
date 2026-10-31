/**
 * What your preview is called on screen (COMM-1.4.5): the sound tried, then each device tried on it,
 * in chain order ("Glass Pad, Tape Echo, Reverb"), so its header says what you are hearing.
 */
import { DEVICE_CATALOGS } from "../../audio/definitions/chainGraph";
import type { InstrumentTrack } from "../../audio/project/projectStore";

export const previewTitle = (preview: InstrumentTrack): string =>
  [
    preview.name,
    ...preview.midiDevices.map((device) => DEVICE_CATALOGS.midi(device.type).label),
    ...preview.effects.map((effect) => DEVICE_CATALOGS.effect(effect.type).label),
  ].join(", ");
