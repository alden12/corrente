import { describe, expect, it } from "vitest";
import { decibelsOf, formatDecibels, gainOfPosition, positionOfGain } from "../src/ui/controls/gainTaper";
import { CLIP_LEVEL, nextMeter, SILENT_METER } from "../src/ui/meters/ballistics";

const db = (decibels: number) => 10 ** (decibels / 20);

describe("the faders' decibel taper (DAW-8.5)", () => {
  it("spreads a mix's levels across the travel, with 0 dB at the top", () => {
    expect(positionOfGain(1)).toBe(1);
    expect(positionOfGain(0)).toBe(0);
    expect(positionOfGain(db(-6))).toBeCloseTo(0.79, 2);
    expect(positionOfGain(db(-20))).toBeCloseTo(0.46, 2);
    expect(positionOfGain(db(-40))).toBeCloseTo(0.22, 2);
  });

  it("round-trips, on a fader topping out above unity too", () => {
    [0, 0.1, 0.5, 1].forEach((gain) => expect(gainOfPosition(positionOfGain(gain))).toBeCloseTo(gain, 9));
    expect(gainOfPosition(positionOfGain(2, 4), 4)).toBeCloseTo(2, 9);
    expect(gainOfPosition(1.5)).toBe(1);
  });

  it("reads out in decibels", () => {
    expect(formatDecibels(1)).toBe("0.0 dB");
    expect(formatDecibels(0.5)).toBe("-6.0 dB");
    expect(formatDecibels(2)).toBe("+6.0 dB");
    expect(formatDecibels(0)).toBe("-∞ dB");
    expect(decibelsOf(0)).toBe(-Infinity);
  });
});

describe("a meter's ballistics (DAW-8.5)", () => {
  it("rises at once, then falls back at 24 dB a second", () => {
    const hit = nextMeter(SILENT_METER, 0.5, 1000);
    expect(hit.level).toBe(0.5);
    const later = nextMeter(hit, 0, 1500);
    expect(decibelsOf(later.level)).toBeCloseTo(-6 - 12, 1);
  });

  it("holds the peak mark a moment before it falls", () => {
    const hit = nextMeter(SILENT_METER, 0.5, 1000);
    expect(nextMeter(hit, 0, 2000).peak).toBe(0.5);
    const held = nextMeter(nextMeter(hit, 0, 2000), 0, 2600);
    expect(held.peak).toBeLessThan(0.5);
  });

  it("lights the clip for a few seconds after a full-scale sample", () => {
    const over = nextMeter(SILENT_METER, CLIP_LEVEL, 1000);
    expect(over.clipUntil).toBeGreaterThan(3900);
    expect(nextMeter(SILENT_METER, 0.9, 1000).clipUntil).toBe(0);
  });
});

describe("the master volume (DAW-8.5)", () => {
  it("is an edit: set, clamped, undone, and coalesced while dragged", async () => {
    const { ProjectStore } = await import("../src/audio/project/projectStore");
    const { EditLog } = await import("../src/audio/commands/editLog");
    const project = new ProjectStore(false);
    const log = new EditLog(project);
    expect(project.masterVolume).toBe(1);
    log.dispatch({ type: "setMasterVolume", volume: 0.5 });
    log.dispatch({ type: "setMasterVolume", volume: 0.4 });
    expect(project.masterVolume).toBe(0.4);
    log.dispatch({ type: "setMasterVolume", volume: 3 });
    expect(project.masterVolume).toBe(1);
    // One drag, one undo step: the three moves coalesced.
    log.dispatch({ type: "setMasterVolume", volume: 0.5 });
    log.undo();
    expect(project.masterVolume).toBe(1);
    expect(log.getState().canUndo).toBe(false);
  });

  it("is saved only once moved, and loads back", async () => {
    const { ProjectStore } = await import("../src/audio/project/projectStore");
    const project = new ProjectStore(false);
    expect(project.snapshot()).not.toHaveProperty("masterVolume");
    project.setMasterVolume(0.25);
    const saved = project.snapshot();
    expect(saved.masterVolume).toBe(0.25);
    const loaded = new ProjectStore(false);
    loaded.load(saved);
    expect(loaded.masterVolume).toBe(0.25);
  });
});
