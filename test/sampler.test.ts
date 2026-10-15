import { describe, expect, it } from "vitest";
import { samplerSchema } from "../src/audio/instruments/engine/sampler";

describe("sampler schema", () => {
  it("exposes a sample param defaulting to a built-in, plus root, keytrack and start", () => {
    const byId = Object.fromEntries(samplerSchema.map((spec) => [spec.id, spec]));
    expect(byId["sampler.sample"].kind).toBe("sample");
    expect(byId["sampler.sample"].default).toBe("builtin:kick");
    expect(byId["sampler.root"].kind).toBe("number");
    expect(byId["sampler.keytrack"].kind).toBe("boolean");
    expect(byId["sampler.start"]).toMatchObject({ kind: "number", min: 0, default: 0, unit: "ms" });
    expect(byId["sampler.trimEnd"]).toMatchObject({ kind: "number", min: 0, default: 0, unit: "ms" });
  });
});
