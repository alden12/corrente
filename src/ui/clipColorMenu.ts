import type { DeviceColor } from "../audio/deviceColors";
import type { Dispatch } from "../audio/commands/types";
import { colorMenu, paletteAccent } from "./deviceColor";

/**
 * A clip's "Colour" submenu (DAW-47): a colour of its own, or its track's again. The same on the
 * timeline's clip menu and the clip rail's.
 */
export const clipColorMenu = (
  track: { id: string; color: DeviceColor },
  clip: { id: string; color?: DeviceColor },
  dispatch: Dispatch,
) =>
  colorMenu(clip.color, (color) => dispatch({ type: "setClipColor", trackId: track.id, clipId: clip.id, color }), {
    label: "Track's colour",
    swatch: paletteAccent(track.color),
    run: () => dispatch({ type: "setClipColor", trackId: track.id, clipId: clip.id, color: null }),
  });
