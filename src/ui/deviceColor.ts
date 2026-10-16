/**
 * A device's colour (DAW-61.2) as CSS. The palette is hues (`audio/deviceColors.ts`); the lightness
 * is picked here, once, so every place a device shows its colour agrees.
 */
import { deviceHue, type DeviceColor } from "../audio/deviceColors";

type Colored = { type: string; color?: DeviceColor };

/** The device's colour, bright enough for a line or a dot on the dark ground. */
export const deviceAccent = (device: Colored) => `hsl(${deviceHue(device)} 62% 62%)`;

/** The coloured top edge a device's card carries in the rack. */
export const deviceEdge = (device: Colored) => ({ borderTopColor: deviceAccent(device), borderTopWidth: 3 });
