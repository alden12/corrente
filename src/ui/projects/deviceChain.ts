/**
 * A track's devices as one line (MOBILE-19.3's Tracks tab): `ARPEGGIATOR → ELECTRIC PIANO → TAPE
 * DELAY`, in signal order - MIDI devices, then the instrument, then effects. Labels come from the
 * catalogs, so a new device names itself here with no change. Bypassed devices are left out: the
 * line says what you hear.
 */
import type { TrackMeta } from "../../audio/project/types";
import { instrumentInfos } from "../../audio/instruments/catalog";
import { effectInfos } from "../../audio/effects/catalog";
import { midiDeviceInfos } from "../../audio/midi/device/catalog";

const labelIn = (infos: { type: string; label: string }[]) => (type: string) =>
  infos.find((info) => info.type === type)?.label ?? type;

/** The track's chain as labels, source first. An audio track's source is its recording. */
export function deviceChain(track: TrackMeta): string[] {
  const effectLabel = labelIn(effectInfos());
  const effects = track.effects.filter((effect) => !effect.bypassed).map((effect) => effectLabel(effect.type));
  if (track.kind === "audio") return ["Audio", ...effects];
  const midiLabel = labelIn(midiDeviceInfos());
  const midiDevices = track.midiDevices.filter((device) => !device.bypassed).map((device) => midiLabel(device.type));
  return [...midiDevices, labelIn(instrumentInfos())(track.instrumentType), ...effects];
}
