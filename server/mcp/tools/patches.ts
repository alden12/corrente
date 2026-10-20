/** MCP tools: Patches (saved instrument presets, in your library: the tab's on the device, or your account's when hosted). */
import type { PatchMethod } from "../../../src/audio/mcp/protocol";
import { ok, fail } from "../shared";
import type { ToolContext } from "../context";
import type { Reply } from "../target";
import {
  APPLY_PATCH_DOC,
  GET_PATCH_DOC,
  LIST_PATCHES_DOC,
  PATCH_TOOL_ARGS,
  SAVE_PATCH_DOC,
} from "../../../src/audio/patches/toolSpec";

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
      inputSchema: PATCH_TOOL_ARGS.list_patches,
    },
    async (listing) => {
      const r = await runPatch("list", listing);
      if ("tabError" in r) return fail(r.tabError);
      if (!r.ok) return fail(r.error ?? "Could not read patches.");
      return ok(JSON.stringify(r.result, null, 2));
    },
  );

  server.registerTool(
    "get_patch",
    {
      title: "Get patch",
      description: GET_PATCH_DOC,
      inputSchema: PATCH_TOOL_ARGS.get_patch,
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
      inputSchema: PATCH_TOOL_ARGS.save_patch,
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
      description: APPLY_PATCH_DOC,
      inputSchema: PATCH_TOOL_ARGS.apply_patch,
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
