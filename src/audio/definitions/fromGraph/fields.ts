/**
 * Old field values as new inputs (INST-36.8): the graph format's numbers and param bindings, scaled
 * into the units the engine's blocks take. Pure data, DOM-free.
 */
import type { NumberField, NumberRef } from "../../graph/types";
import type { InputValue, ParamBinding } from "../format";

/** A single input: one of the values an input list sums. */
export type SingleInput = Exclude<InputValue, readonly unknown[]>;

/**
 * A field times `factor`: a number multiplied, or a binding whose result is (it keeps its table, and
 * its scale and offset grow by the factor, since the binding is `table(value) * scale + offset`).
 */
export const scaled = (field: NumberField, factor: number): number | ParamBinding =>
  typeof field === "number" ? field * factor : scaledBinding(field, factor);

const scaledBinding = (field: NumberRef, factor: number): ParamBinding => ({
  param: field.param,
  ...(field.table && { table: field.table }),
  scale: (field.scale ?? 1) * factor,
  ...(field.offset !== undefined && { offset: field.offset * factor }),
});

/** A field as it is, or `fallback` (Web Audio's default for that param) when it's left out. */
export const valueOf = (field: NumberField | undefined, fallback: number, factor = 1): number | ParamBinding =>
  field === undefined ? fallback * factor : scaled(field, factor);

/**
 * Several inputs summed, as a definition writes them: nothing is 0, one is itself, more a list. Web
 * Audio adds whatever is connected into a param to the param's own value, which is this.
 */
export const summed = (inputs: SingleInput[]): InputValue =>
  inputs.length === 0 ? 0 : inputs.length === 1 ? inputs[0] : inputs;

/** A reference times a factor: a modulator into a param whose unit changes (cents to semitones). */
export const scaledRef = (from: string, factor: number): SingleInput => (factor === 1 ? from : { from, scale: factor });

/** A MIDI note's frequency, A4 (69) at 440 Hz. */
export const noteFrequency = (note: number) => 440 * 2 ** ((note - 69) / 12);
