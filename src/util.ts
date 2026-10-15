/** Tiny pure helpers shared across the app (DOM-free, so audio modules can use them too). */
import type { ZodError } from "zod";

/** Constrain `value` to the inclusive range [lo, hi]. */
export const clamp = (value: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, value));

/** A failed zod check's problems as `path: message` lines, for whoever sent the input to fix. */
export const issueLines = (error: ZodError): string[] =>
  error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`);
