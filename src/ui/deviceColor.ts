/**
 * A device's colour (DAW-61.2) as CSS. The palette is hues (`audio/deviceColors.ts`); the lightness
 * is picked here, once, so every place a device shows its colour agrees.
 */
import { deviceHue, type DeviceColor } from "../audio/deviceColors";

type Colored = { type: string; color?: DeviceColor };

/** A device hue as a colour bright enough for a line or a dot on the dark ground, at `alpha`. */
export const hueAccent = (hue: number, alpha = 1) => `hsl(${hue} 62% 62% / ${alpha})`;

/** The device's colour. */
export const deviceAccent = (device: Colored) => hueAccent(deviceHue(device));

/** The coloured top edge a device's card carries in the rack. */
export const deviceEdge = (device: Colored) => ({ borderTopColor: deviceAccent(device), borderTopWidth: 3 });
