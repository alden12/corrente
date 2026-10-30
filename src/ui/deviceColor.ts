/**
 * A device's colour (DAW-61.2) as CSS. The palette is hues (`audio/deviceColors.ts`); the lightness
 * is picked here, once, so every place a device shows its colour agrees.
 */
import { DEVICE_COLOR_NAMES, DEVICE_COLORS, deviceHue, type DeviceColor } from "../audio/deviceColors";
import type { MenuItem } from "./Menu";

type Colored = { type: string; color?: DeviceColor };

/** A device hue as a colour bright enough for a line or a dot on the dark ground, at `alpha`. */
export const hueAccent = (hue: number, alpha = 1) => `hsl(${hue} 62% 62% / ${alpha})`;

/** The device's colour. */
export const deviceAccent = (device: Colored) => hueAccent(deviceHue(device));

/** The coloured top edge a device's card carries in the rack. */
export const deviceEdge = (device: Colored) => ({ borderTopColor: deviceAccent(device), borderTopWidth: 3 });

/** A palette colour as CSS (a track's or a clip's, DAW-47), at `alpha`. */
export const paletteAccent = (color: DeviceColor, alpha = 1) => hueAccent(DEVICE_COLORS[color], alpha);

/** A colour's name as a menu says it: "Amber". */
const colorLabel = (color: DeviceColor) => color[0].toUpperCase() + color.slice(1);

/**
 * A "Colour" submenu: the palette, the current one checked. `clear` adds a first row that takes the
 * colour away again (a clip's, so it takes its track's), checked when there's none of its own.
 */
export const colorMenu = (
  current: DeviceColor | undefined,
  pick: (color: DeviceColor) => void,
  clear?: { label: string; swatch: string; run: () => void },
): MenuItem => ({
  label: "Colour",
  submenu: [
    ...(clear
      ? [
          { label: clear.label, swatch: clear.swatch, checked: current === undefined, onClick: clear.run },
          { separator: true },
        ]
      : []),
    ...DEVICE_COLOR_NAMES.map((color) => ({
      label: colorLabel(color),
      swatch: paletteAccent(color),
      checked: current === color,
      onClick: () => pick(color),
    })),
  ],
});
