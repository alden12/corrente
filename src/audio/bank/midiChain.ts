/**
 * A track's MIDI devices in the engine (INST-11.1), kept in step with the project: an
 * `EngineInstrument` holds one. A new set of devices (added, removed, moved, a store swapped, or a
 * device's definition edited) loads the chain again, which starts the keys down again in it; a knob or a bypass moves its value alone,
 * so the notes it holds play on.
 */
import { chainWords, type MidiDevicePlan } from "../midi/compile";
import { chainDevicesOf, engineMidiPlan, engineParamValue, type MidiDeviceSource } from "../midi/engine";
import { bindParams, type ParamBinding } from "../params/binding";
import type { ToBank } from "./messages";
import type { DistributiveOmit } from "./EngineDevice";

type Send = (message: DistributiveOmit<Extract<ToBank, { type: "midi" | "midiValue" }>, "track">) => void;

export class EngineMidiChain {
  private devices: readonly MidiDeviceSource[] = [];
  /** The plan each device played when the chain last loaded. */
  private plans: (MidiDevicePlan | undefined)[] = [];
  /** Which of the chain's values is each device's bypass. */
  private bypassValues: number[] = [];
  /** Whether each device is bypassed, as last sent. */
  private bypassed: boolean[] = [];
  private unsubscribe: (() => void)[] = [];

  private readonly send: Send;
  private readonly now: () => number;

  constructor(send: Send, now: () => number) {
    this.send = send;
    this.now = now;
  }

  /** Play these devices, every one of which the engine plays (playsInEngine). None takes them away. */
  set(devices: readonly MidiDeviceSource[]): void {
    const same =
      devices.length === this.devices.length &&
      devices.every((device, index) => {
        const before = this.devices[index];
        return (
          device.id === before.id &&
          device.type === before.type &&
          device.params === before.params &&
          engineMidiPlan(device.type) === this.plans[index]
        );
      });
    if (!same) {
      this.load(devices);
      return;
    }
    devices.forEach((device, index) => {
      if (device.bypassed === this.bypassed[index]) return;
      this.bypassed[index] = device.bypassed;
      this.send({ type: "midiValue", value: this.bypassValues[index], raw: device.bypassed ? 1 : 0, time: this.now() });
    });
  }

  /** Load the chain, and follow each device's params from now on. */
  private load(devices: readonly MidiDeviceSource[]): void {
    this.unsubscribe.forEach((unsubscribe) => unsubscribe());
    this.devices = devices;
    this.plans = devices.map((device) => engineMidiPlan(device.type));
    this.bypassed = devices.map((device) => device.bypassed);
    const chain = chainWords(chainDevicesOf(devices));
    this.send({ type: "midi", words: chain.words });
    const numberOf = (device: number, param?: string) =>
      chain.values.findIndex((value) => value.device === device && value.param === param);
    this.bypassValues = devices.map((_, index) => numberOf(index));
    // Each param's changes as its value's; the first apply sends what the chain already has, harmlessly.
    this.unsubscribe = devices.map((device, index) => {
      const bindings = Object.fromEntries(
        (engineMidiPlan(device.type)?.params ?? []).map((param): [string, ParamBinding] => [
          param,
          {
            apply: () =>
              this.send({
                type: "midiValue",
                value: numberOf(index, param),
                raw: engineParamValue(device.params, param),
                time: this.now(),
              }),
          },
        ]),
      );
      return bindParams(device.params, bindings);
    });
  }

  dispose(): void {
    this.unsubscribe.forEach((unsubscribe) => unsubscribe());
    this.unsubscribe = [];
  }
}
