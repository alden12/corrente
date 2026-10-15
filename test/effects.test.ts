import { describe, expect, it } from "vitest";
import { effectInfos } from "../src/audio/effects/catalog";

describe("effects", () => {
  // The chain crossfades an effect by its `mix` (definitions/builtin.ts MIX), so every one needs it.
  it("every effect schema includes a mix param", () => {
    for (const effect of effectInfos()) {
      expect(effect.schema.some((spec) => spec.id === "mix")).toBe(true);
    }
  });
});
