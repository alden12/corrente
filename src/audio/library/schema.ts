/**
 * The library's records checked at the boundary (COMM-1.11.2): what a device sends the account
 * library, and what comes back. One definition for both sides (the contract imports it). A version's
 * document is checked by its kind: a patch's shape, and every custom device compiled, whether it is
 * the item or travels inside a patch, so the account never holds one that wouldn't play.
 */
import { z } from "zod";
import { parseCustomDevice, type CustomKind } from "../definitions/custom";
import { authorSchema, patchValuesSchema } from "../project/schema";
import type { LibraryItem, LibraryKind, LibraryVersion } from "./backend";

/** One MIDI device or effect in a patch: its type, bypass, and values (no instance id). */
export const patchChainSchema = z.object({
  type: z.string(),
  bypassed: z.boolean().optional(),
  params: patchValuesSchema,
});

/** A patch version's document: its sound, and the custom devices it carries. */
const patchDocumentSchema = z.object({
  instrumentType: z.string(),
  params: patchValuesSchema,
  effects: z.array(patchChainSchema),
  midiDevices: z.array(patchChainSchema).optional(),
  devices: z
    .object({ instruments: z.array(z.unknown()).optional(), effects: z.array(z.unknown()).optional() })
    .optional(),
});

const deviceProblems = (raw: unknown, kind: CustomKind, where: string): string[] => {
  const parsed = parseCustomDevice(raw, kind);
  return parsed.ok ? [] : parsed.errors.map((error) => `${where}: ${error}`);
};

/** What's wrong with a version's document for an item of `kind`, if anything. */
const DOCUMENT_PROBLEMS: Record<LibraryKind, (document: unknown) => string[]> = {
  patch: (document) => {
    const parsed = patchDocumentSchema.safeParse(document);
    if (!parsed.success) return parsed.error.issues.map((issue) => `patch: ${issue.message}`);
    const { instruments = [], effects = [] } = parsed.data.devices ?? {};
    return [
      ...instruments.flatMap((device) => deviceProblems(device, "instrument", "its instrument")),
      ...effects.flatMap((device) => deviceProblems(device, "effect", "its effect")),
    ];
  },
  instrument: (document) => deviceProblems(document, "instrument", "instrument"),
  effect: (document) => deviceProblems(document, "effect", "effect"),
};

/** An item id: a patch's `pt-…`, a device's type. */
const itemId = z.string().regex(/^[A-Za-z0-9._:-]{1,200}$/, "not a library id");
const libraryKind = z.enum(["patch", "instrument", "effect"]);

export const libraryItemSchema = z.object({
  id: itemId,
  kind: libraryKind,
  name: z.string().max(200),
  version: z.number().int().positive(),
  createdAt: z.number(),
  updatedAt: z.number(),
  hiddenAt: z.number().optional(),
}) satisfies z.ZodType<LibraryItem>;

export const libraryVersionSchema = z.object({
  itemId,
  version: z.number().int().positive(),
  createdAt: z.number(),
  author: authorSchema,
  tags: z.array(z.string().min(1).max(40)).max(32),
  description: z.string().max(2000).optional(),
  document: z.unknown(),
  hash: z.string().optional(),
}) satisfies z.ZodType<LibraryVersion>;

/**
 * One change a device sends: an item, and the version it saved, if it saved one (a delete sends the
 * item alone, with `hiddenAt`). Its version number is the device's; the account may give it the next
 * free one instead, and says so in what it sends back.
 */
export const librarySaveSchema = z
  .object({
    item: libraryItemSchema.omit({ version: true, updatedAt: true }),
    // No hash: the account works it out from the document rather than take one on trust.
    version: libraryVersionSchema.omit({ itemId: true, hash: true }).optional(),
  })
  .superRefine((save, context) => {
    if (!save.version) return;
    DOCUMENT_PROBLEMS[save.item.kind](save.version.document).forEach((message) =>
      context.addIssue({ code: "custom", message: `${save.item.id}: ${message}`, path: ["version", "document"] }),
    );
  });

export type LibrarySave = z.infer<typeof librarySaveSchema>;

/** An item with its current version, as the account sends it back. */
export const libraryEntrySchema = z.object({ item: libraryItemSchema, current: libraryVersionSchema });
