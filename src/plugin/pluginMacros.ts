/**
 * The plugin's 16 macros, as the window maps them (PLUGIN-3.4). A host lists a plugin's params once,
 * so the plugin has 16 fixed macros, each mapped to one of the device's params by its binding name
 * (which holds as the device changes around it). Until the window maps one, they're the first 16
 * params, in order (`slots` is null); mapping one fixes all 16 as they then were. Every change goes
 * to the plugin as `macros`, which saves it with the host's project and hands it back on restore.
 *
 * DOM-free: the page passes in how it reaches the plugin.
 */
import { createListeners } from "../listeners";
import { fromNormalized, toNormalized } from "../audio/params/taper";
import type { ParamSpec, ParamValue } from "../audio/params/types";
import type { ToPlugin } from "./pluginDevice";

export const MACROS = 16;

/** Each macro's binding name, or null for one mapped to nothing. */
export type Slots = (string | null)[];

/** The macros' mapping: `slots` where the window has mapped them, else the first MACROS of `names`. */
export const mappingOf = (slots: Slots | null, names: readonly string[]): Slots =>
  Array.from({ length: MACROS }, (_, slot) => (slots ? (slots[slot] ?? null) : (names[slot] ?? null)));

/** A param's value at a macro's position, as the plugin maps them (package.rs's `engine_value`). */
const VALUE_AT: {
  [Kind in ParamSpec["kind"]]?: (spec: Extract<ParamSpec, { kind: Kind }>, position: number) => ParamValue;
} = {
  number: (spec, position) => fromNormalized(spec, position),
  enum: (spec, position) => spec.options[Math.round(position * Math.max(spec.options.length - 1, 0))],
  boolean: (_, position) => position >= 0.5,
};

/** Where a param's value sits as a macro's position (package.rs's `position`). */
const POSITION_OF: {
  [Kind in ParamSpec["kind"]]?: (spec: Extract<ParamSpec, { kind: Kind }>, value: ParamValue) => number;
} = {
  number: (spec, value) => toNormalized(spec, value as number),
  enum: (spec, value) => spec.options.indexOf(value as string) / Math.max(spec.options.length - 1, 1),
  boolean: (_, value) => (value ? 1 : 0),
};

export const valueAt = (spec: ParamSpec, position: number): ParamValue | undefined =>
  (VALUE_AT[spec.kind] as ((spec: ParamSpec, position: number) => ParamValue) | undefined)?.(spec, position);

export const positionOf = (spec: ParamSpec, value: ParamValue): number | undefined =>
  (POSITION_OF[spec.kind] as ((spec: ParamSpec, value: ParamValue) => number) | undefined)?.(spec, value);

export class PluginMacros {
  private slots: Slots | null = null;
  private readonly send: (message: ToPlugin) => void;
  private readonly listeners = createListeners();

  constructor(send: (message: ToPlugin) => void) {
    this.send = send;
  }

  subscribe = this.listeners.subscribe;

  /** The mapping as the window made it (null for none yet); a new array on every change. */
  getSlots = (): Slots | null => this.slots;

  /** The mapping the plugin saved, as it hands it back: null for none made yet. */
  restore(slots: Slots | null): void {
    this.slots = slots;
    this.listeners.emit();
  }

  /** What each macro is mapped to, for a device whose params are `names`. */
  mapping(names: readonly string[]): Slots {
    return mappingOf(this.slots, names);
  }

  /** Map macro `slot` to `name` (moving it off any other macro), for a device whose params are `names`. */
  map(name: string, slot: number, names: readonly string[]): void {
    this.set(this.mapping(names).map((mapped, index) => (index === slot ? name : mapped === name ? null : mapped)));
  }

  /** Map `name` to no macro. */
  unmap(name: string, names: readonly string[]): void {
    this.set(this.mapping(names).map((mapped) => (mapped === name ? null : mapped)));
  }

  private set(slots: Slots): void {
    this.slots = slots;
    this.send({ type: "macros", slots });
    this.listeners.emit();
  }
}
