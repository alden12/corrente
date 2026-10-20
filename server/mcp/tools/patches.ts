/** MCP tools: Patches (saved instrument presets, in the tab's library on the device). */
import { z } from "zod";
import type { PatchMethod } from "../../../src/audio/mcp/protocol";
import { ok, fail } from "../shared";
import type { ToolContext } from "../context";
import type { Reply } from "../target";
import { LIST_PATCHES_DOC, SAVE_PATCH_DOC } from "../../../src/audio/patches/patchTools";

export function registerPatchesTools({ server, target }: ToolContext): void {
  const runPatch = async (
    method: PatchMethod,
    params?: Record<string, unknown>,
  ): Promise<Reply | { tabError: string }> => {
    try {
      return await target.requestPatch(method, params);
    } catch (err) {
      return { tabError: err instanceof Error ? err.message : String(err) };
    }
  };

  server.registerTool(
    "list_patches",
    {
      title: "List patches",
      description: LIST_PATCHES_DOC,
      inputSchema: {
        tags: z.array(z.string()).optional().describe("words for the sound wanted; every patch when absent"),
      },
    },
    async ({ tags }) => {
      const r = await runPatch("list", { tags });
      if ("tabError" in r) return fail(r.tabError);
      if (!r.ok) return fail(r.error ?? "Could not read patches.");
      return ok(JSON.stringify(r.result, null, 2));
    },
  );

  server.registerTool(
    "get_patch",
    {
      title: "Get patch",
      description:
        "Get the full specifics of one patch (by name or id from list_patches): its instrument, every parameter value, and its effect chain with per-effect params. Works for both factory and user patches - useful for inspecting a sound or promoting a user patch into the factory bank.",
      inputSchema: {
        patch: z.string().min(1).describe("patch name or id (from list_patches)"),
      },
    },
    async ({ patch }) => {
      const r = await runPatch("get", { patch });
      if ("tabError" in r) return fail(r.tabError);
      if (!r.ok) return fail(r.error ?? "Could not read the patch.");
      return ok(JSON.stringify(r.result, null, 2));
    },
  );

  server.registerTool(
    "save_patch",
    {
      title: "Save patch",
      description: SAVE_PATCH_DOC,
      inputSchema: {
        name: z.string().min(1).max(60).optional().describe("its name (default: the track's, or the patch's)"),
        track: z.string().optional().describe("instrument track id (default: the selected track)"),
        tags: z.array(z.string().min(1).max(40)).max(12).optional(),
        description: z.string().max(500).optional(),
        patch: z.string().optional().describe("one of the user's patches (id or name) to save a new version of"),
      },
    },
    async ({ name, track, tags, description, patch }) => {
      const r = await runPatch("save", { name, trackId: track, tags, description, patch });
      if ("tabError" in r) return fail(r.tabError);
      if (!r.ok) return fail(r.error ?? "Could not save the patch.");
      const saved = r.result as { id: string; name: string; version: number };
      return ok(`Saved patch "${saved.name}" (id ${saved.id}, version ${saved.version}).`);
    },
  );

  server.registerTool(
    "apply_patch",
    {
      title: "Apply patch",
      description:
        "Add a new instrument track from a patch - factory or user (by name or id from list_patches). One undoable edit; the track files into the main group.",
      inputSchema: {
        patch: z.string().min(1).describe("patch name or id (from list_patches)"),
        name: z.string().optional().describe("name for the new track (default: the patch name)"),
      },
    },
    async ({ patch, name }) => {
      const r = await runPatch("apply", { patch, name });
      if ("tabError" in r) return fail(r.tabError);
      if (!r.ok) return fail(r.error ?? "Could not apply the patch.");
      const added = r.result as { trackId: string; name: string };
      return ok(`Added "${added.name}" from the patch library (track ${added.trackId}).`);
    },
  );
}
