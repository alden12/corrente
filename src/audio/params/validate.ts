/**
 * Strict validation of a value against a ParamSpec, returning an error message
 * (or null if valid). Used by the MCP server to give the model clear feedback
 * instead of silently clamping (the store coerces; this rejects). Validation is
 * done by zod (see specToZod); the message is curated per kind for clarity.
 */
import type { ParamSpec, ParamValue } from "./types";
import { specToZod } from "./zod";

type ByKind<K extends ParamSpec["kind"]> = Extract<ParamSpec, { kind: K }>;

const MESSAGE: { [K in ParamSpec["kind"]]: (spec: ByKind<K>) => string } = {
  number: (spec) => `"${spec.id}" must be a number in ${spec.min}..${spec.max}${spec.unit ? ` ${spec.unit}` : ""}.`,
  enum: (spec) => `"${spec.id}" must be one of: ${spec.options.join(", ")}.`,
  boolean: (spec) => `"${spec.id}" expects a boolean.`,
  sample: (spec) => `"${spec.id}" must be a sample reference ("builtin:<id>" or "file:<fileId>"), or "" for none.`,
};

export function validateParam(spec: ParamSpec, value: ParamValue): string | null {
  const valid = specToZod(spec).safeParse(value).success;
  return valid ? null : (MESSAGE[spec.kind] as (spec: ParamSpec) => string)(spec);
}

/**
 * A value as a client sent it, read for the param it is for (AGENT-31). A tool's `value` takes a
 * number, text or a boolean, and some clients send every value as text ("0.5", "true"), which a
 * number or boolean param would then refuse. Anything that doesn't read as its kind is left for
 * `validateParam` to refuse with its message.
 */
const FROM_TEXT: { [K in ParamSpec["kind"]]: (text: string) => ParamValue } = {
  number: (text) => (text.trim() !== "" && Number.isFinite(Number(text)) ? Number(text) : text),
  boolean: (text) => (text.trim() === "true" ? true : text.trim() === "false" ? false : text),
  enum: (text) => text,
  sample: (text) => text,
};

export function readParamValue(spec: ParamSpec, value: ParamValue): ParamValue {
  return typeof value === "string" ? FROM_TEXT[spec.kind](value) : value;
}
