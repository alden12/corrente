import { describe, expect, it } from "vitest";
import { toSections, sectionTitle } from "../src/ui/paramSections";
import type { ParamSchema } from "../src/audio/params/types";

const param = (id: string): ParamSchema[number] => ({ id, label: id, kind: "number", min: 0, max: 1, default: 0 });

describe("a device's param sections (DAW-61.3)", () => {
  it("groups params by the part of the id before the dot, in signal-flow order", () => {
    const sections = toSections(["env.attack", "osc.saw", "filter.cutoff", "osc.pulse"].map(param));
    expect(sections.map((section) => section.namespace)).toEqual(["osc", "filter", "env"]);
    expect(sections[0].specs.map((spec) => spec.id)).toEqual(["osc.saw", "osc.pulse"]);
  });

  it("gathers params with no namespace into one untitled section, last", () => {
    const sections = toSections(["mix", "delay.time", "width", "delay.feedback"].map(param));
    expect(sections.map((section) => section.namespace)).toEqual(["delay", ""]);
    expect(sections[1].specs.map((spec) => spec.id)).toEqual(["mix", "width"]);
    expect(sectionTitle("")).toBe("");
  });

  it("keeps a device that names every param plainly as one section", () => {
    expect(toSections(["detune", "cutoff", "level"].map(param))).toHaveLength(1);
  });
});
