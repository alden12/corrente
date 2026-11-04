/**
 * 808 Kit (INST-9.1): the classic drum machine's voices, synthesized on engine blocks and rendered to
 * samples (`yarn kits`). The Simple House Kit seeded with them, an instrument of its own as the Acoustic Kit
 * is, so the kit's panel picks between them; it was a Simple House Kit patch before.
 */
import type { EngineBuiltin } from "../../definitions/builtin";
import { BUILTIN_KITS } from "../../samples/catalog";
import { builtinKitSounds, drumkit, kitSchema } from "./drumkit";

const KIT = BUILTIN_KITS.find((kit) => kit.id === "808")!;

export const kit808: EngineBuiltin = {
  ...drumkit,
  type: "808-kit",
  label: "808 Kit",
  tags: KIT.tags,
  color: "orange",
  schema: kitSchema(builtinKitSounds(KIT)),
};
