/**
 * A param *declaration* (a schema entry) as zod, for schemas from outside: a custom device's, from a
 * project file or an MCP call. Distinct from specToZod (zod.ts), which validates a value against one.
 */
import { z } from "zod";

const baseSpec = { id: z.string(), label: z.string() };

export const paramSpecSchema = z.discriminatedUnion("kind", [
  z
    .object({
      ...baseSpec,
      kind: z.literal("number"),
      min: z.number(),
      max: z.number(),
      default: z.number(),
      unit: z.string().optional(),
      taper: z.enum(["linear", "exponential"]).optional(),
      step: z.number().optional(),
      smoothMs: z.number().optional(),
      format: z.literal("note").optional(),
    })
    .strict(),
  z.object({ ...baseSpec, kind: z.literal("enum"), options: z.array(z.string()), default: z.string() }).strict(),
  z.object({ ...baseSpec, kind: z.literal("boolean"), default: z.boolean() }).strict(),
  z.object({ ...baseSpec, kind: z.literal("sample"), default: z.string(), wavetable: z.boolean().optional() }).strict(),
]);

export const paramSchemaSchema = z.array(paramSpecSchema);
