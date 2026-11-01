/**
 * A track's MIDI devices as the plugin plays them (PLUGIN-3.8): the chain the app's engine plays ahead
 * of the voices (`chainWords`), and each value it reads under a name of its own, so the package saves
 * them, the window moves them and a macro maps them as it does the instrument's params.
 *
 * The values are in the chain's order: each device's bypass (fixed), then its params. The plugin numbers
 * them on from the instrument's, so one `value` message reaches either. DOM-free, as the package is.
 */
import type { DevicePackage, PackageValue } from "../audio/bank/devicePackage";
import { chainDevicesOf, engineMidiPlan, engineParamValue, type MidiDeviceSource } from "../audio/midi/engine";
import { chainWords } from "../audio/midi/compile";
import { midiDeviceInfos } from "../audio/midi/device/catalog";
import type { ParamStore } from "../audio/params/store";
import { scaleMask, type ProjectKey } from "../audio/theory/key";
import { paramTitle } from "./paramTitle";

/** One of the chain's values: a device's bypass (no param), or one of its params. */
export interface MidiSlot {
  name: string;
  device: MidiDeviceSource;
  param?: string;
}

/**
 * The package's MIDI fields, the key among them (only the devices read it); none at all for a track with
 * no devices, as a package saved before had.
 */
export type MidiFields = Pick<DevicePackage, "midi" | "midiValues" | "key">;

/** The devices the engine plays, in order: the only ones the plugin can (a custom one it can't is left out). */
const played = (devices: readonly MidiDeviceSource[]) =>
  devices.filter((device) => engineMidiPlan(device.type) !== undefined);

/** Each value the chain reads, named by the device's id, which stays put as devices come and go around it. */
export const midiSlots = (devices: readonly MidiDeviceSource[]): MidiSlot[] =>
  played(devices).flatMap((device) => [
    { name: `midi:${device.id}:bypass`, device },
    ...engineMidiPlan(device.type)!.params.map((param) => ({ name: `midi:${device.id}:${param}`, device, param })),
  ]);

/** A slot's engine value now: its param's, or 1 for a bypassed device. */
export const midiValueOf = ({ device, param }: MidiSlot): number =>
  param === undefined ? (device.bypassed ? 1 : 0) : engineParamValue(device.params, param);

/** Where a slot's param is, for a knob, a macro or the host to set; undefined for a bypass. */
export const midiSourceOf = ({ device, param }: MidiSlot): { store: ParamStore; id: string } | undefined =>
  param === undefined ? undefined : { store: device.params, id: param };

/** The devices as the package carries them, playing in `key`. */
export const midiFields = (devices: readonly MidiDeviceSource[], key: ProjectKey): MidiFields => {
  const slots = midiSlots(devices);
  if (slots.length === 0) return {};
  const { words } = chainWords(chainDevicesOf(played(devices)));
  const labelOf = (type: string) => midiDeviceInfos().find((info) => info.type === type)?.label ?? type;
  return {
    midi: Array.from(new Float64Array(words.buffer, words.byteOffset, words.byteLength / 8)),
    midiValues: slots.map((slot): PackageValue => {
      const raw = midiValueOf(slot);
      if (slot.param === undefined) return { kind: "fixed", name: slot.name, raw };
      const spec = slot.device.params.spec(slot.param);
      // The device first, as the host lists params flat: "Arpeggiator Rate".
      return {
        kind: "param",
        name: slot.name,
        title: `${labelOf(slot.device.type)} ${paramTitle(slot.param, spec)}`,
        spec,
        raw,
      };
    }),
    // As the engine reads it (DAW-12): a harmoniser or quantiser plays in it.
    key: { tonic: key.tonic, scale: scaleMask(key.scale) },
  };
};
