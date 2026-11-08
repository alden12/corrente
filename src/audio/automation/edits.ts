/**
 * The automation edits on a track (DAW-67), as the store applies them: an automation clip made,
 * changed or removed, and placed, moved or taken off the timeline. Split out of `projectStore.ts`,
 * which wraps each in a lookup and an emit. Each edits the track in place and says whether anything
 * changed, so a no-op edit emits nothing.
 *
 * Coercion, not validation (CLAUDE.md): what reaches here is a command already checked at its
 * boundary, so values are clamped and points tidied (`tidyPoints`) rather than refused.
 *
 * **Linked or placed, never both.** A clip linked to a note clip plays wherever that clip plays, so
 * linking one takes its own placements away, and placing one unlinks it.
 */
import type { AutomationBinding, AutomationClipData, AutomationPoint, ClipAuthor, Placement } from "../project/types";
import type { DeviceColor } from "../deviceColors";
import { tidyPoints } from "./curve";

/** The shortest and longest an automation clip may be, in beats. */
export const MIN_AUTOMATION_BEATS = 0.25;
export const MAX_AUTOMATION_BEATS = 1024;
/** What an automation clip is called when it is given no name. */
export const AUTOMATION_NAME = "Automation";

/** What holds automation: a track. */
export interface AutomationHolder {
  automations: AutomationClipData[];
  automationPlacements: Placement[];
}

export interface NewAutomation {
  id: string;
  name: string;
  lengthBeats: number;
  points?: AutomationPoint[];
  bindings?: AutomationBinding[];
  linkedClipId?: string;
  color?: DeviceColor;
  /** Where to put it on the timeline as it is made; ignored for a linked clip. */
  placement?: { id: string; startBeat: number; length?: number };
}

export interface AutomationPatch {
  name?: string;
  lengthBeats?: number;
  /** The whole curve, replacing the one it had. */
  points?: AutomationPoint[];
  /** Every knob it drives, replacing the list it had. */
  bindings?: AutomationBinding[];
  /** The note clip to play with; null unlinks it. */
  linkedClipId?: string | null;
  /** Its own colour; null takes the track's again. */
  color?: DeviceColor | null;
}

export interface PlacementPatch {
  startBeat?: number;
  offset?: number;
  length?: number;
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const lengthOf = (beats: number) => clamp(beats, MIN_AUTOMATION_BEATS, MAX_AUTOMATION_BEATS);
const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);

/** A deep copy, so a snapshot never aliases what the store goes on editing. */
export const copyAutomation = (clip: AutomationClipData): AutomationClipData => ({
  ...clip,
  points: clip.points.map((point) => ({ ...point })),
  bindings: clip.bindings.map((binding) => ({ ...binding, target: { ...binding.target } })),
});

/** A placement kept inside the timeline, at least the shortest clip long. */
const tidyPlacement = (placement: Placement): Placement => ({
  ...placement,
  startBeat: Math.max(0, placement.startBeat),
  offset: Math.max(0, placement.offset),
  length: Math.max(MIN_AUTOMATION_BEATS, placement.length),
});

export function addAutomation(track: AutomationHolder, spec: NewAutomation, author: ClipAuthor): boolean {
  if (track.automations.some((clip) => clip.id === spec.id)) return false;
  const lengthBeats = lengthOf(spec.lengthBeats);
  track.automations = [
    ...track.automations,
    {
      id: spec.id,
      name: spec.name,
      author,
      ...(spec.color ? { color: spec.color } : {}),
      lengthBeats,
      points: tidyPoints(spec.points ?? [], lengthBeats),
      bindings: (spec.bindings ?? []).map((binding) => ({ ...binding })),
      ...(spec.linkedClipId ? { linkedClipId: spec.linkedClipId } : {}),
    },
  ];
  if (spec.placement && !spec.linkedClipId) {
    const { id, startBeat, length } = spec.placement;
    track.automationPlacements = [
      ...track.automationPlacements,
      tidyPlacement({ id, clipId: spec.id, startBeat, offset: 0, length: length ?? lengthBeats }),
    ];
  }
  return true;
}

export function setAutomation(track: AutomationHolder, id: string, patch: AutomationPatch): boolean {
  const before = track.automations.find((clip) => clip.id === id);
  if (!before) return false;
  const lengthBeats = patch.lengthBeats !== undefined ? lengthOf(patch.lengthBeats) : before.lengthBeats;
  const rest = without(without(before, "color"), "linkedClipId");
  const color = patch.color === undefined ? before.color : (patch.color ?? undefined);
  const linkedClipId = patch.linkedClipId === undefined ? before.linkedClipId : (patch.linkedClipId ?? undefined);
  const after: AutomationClipData = {
    ...rest,
    ...(patch.name !== undefined ? { name: patch.name } : {}),
    lengthBeats,
    // Re-tidied on a length change too, so no point is left past the clip's end.
    points: tidyPoints(patch.points ?? before.points, lengthBeats),
    bindings: (patch.bindings ?? before.bindings).map((binding) => ({ ...binding })),
    ...(color ? { color } : {}),
    ...(linkedClipId ? { linkedClipId } : {}),
  };
  const unplaced = linkedClipId
    ? track.automationPlacements.filter((placement) => placement.clipId !== id)
    : track.automationPlacements;
  if (same(before, after) && unplaced.length === track.automationPlacements.length) return false;
  track.automations = track.automations.map((clip) => (clip.id === id ? after : clip));
  track.automationPlacements = unplaced;
  return true;
}

/** Remove an automation clip and every placement of it. */
export function removeAutomation(track: AutomationHolder, id: string): boolean {
  if (!track.automations.some((clip) => clip.id === id)) return false;
  track.automations = track.automations.filter((clip) => clip.id !== id);
  track.automationPlacements = track.automationPlacements.filter((placement) => placement.clipId !== id);
  return true;
}

/** Put an automation clip on the timeline (another placement of it if it has some), unlinking it. */
export function placeAutomation(
  track: AutomationHolder,
  spec: { id: string; automationId: string; startBeat: number; offset?: number; length?: number },
): boolean {
  const clip = track.automations.find((automation) => automation.id === spec.automationId);
  if (!clip || track.automationPlacements.some((placement) => placement.id === spec.id)) return false;
  if (clip.linkedClipId) setAutomation(track, clip.id, { linkedClipId: null });
  track.automationPlacements = [
    ...track.automationPlacements,
    tidyPlacement({
      id: spec.id,
      clipId: spec.automationId,
      startBeat: spec.startBeat,
      offset: spec.offset ?? 0,
      length: spec.length ?? clip.lengthBeats,
    }),
  ];
  return true;
}

/** Move or trim a placement: any of its start, offset into the clip and length. */
export function setAutomationPlacement(track: AutomationHolder, id: string, patch: PlacementPatch): boolean {
  const before = track.automationPlacements.find((placement) => placement.id === id);
  if (!before) return false;
  const after = tidyPlacement({ ...before, ...definedOnly(patch) });
  if (same(before, after)) return false;
  track.automationPlacements = track.automationPlacements.map((placement) => (placement.id === id ? after : placement));
  return true;
}

export function removeAutomationPlacement(track: AutomationHolder, id: string): boolean {
  if (!track.automationPlacements.some((placement) => placement.id === id)) return false;
  track.automationPlacements = track.automationPlacements.filter((placement) => placement.id !== id);
  return true;
}

/** A note clip went: what was linked to it keeps its curve, linked to nothing, so it plays nowhere. */
export function unlinkFrom(track: AutomationHolder, noteClipId: string): void {
  track.automations = track.automations.map((clip) => {
    return clip.linkedClipId === noteClipId ? without(clip, "linkedClipId") : clip;
  });
}

/** `object` without `key`, so an optional field that's unset is absent rather than undefined. */
const without = <Value extends object, Key extends keyof Value>(object: Value, key: Key): Omit<Value, Key> =>
  Object.fromEntries(Object.entries(object).filter(([name]) => name !== key)) as Omit<Value, Key>;

const definedOnly = (patch: PlacementPatch): PlacementPatch =>
  Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined));
