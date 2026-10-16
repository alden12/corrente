/**
 * A device's colour (DAW-61.2): part of what the device is, like its label, so it looks the same in
 * the rack and on Explore. It comes from a fixed palette of hues spaced to stay apart from each
 * other on the dark ground, never any hue, so a chain of devices reads as separate things.
 *
 * Built-ins name theirs, picked so the chains people build contrast (a delay family in blues, a
 * modulation family in greens, drive in reds). A device that doesn't name one, a custom device
 * nobody coloured, gets a palette entry hashed from its type: stable across sessions and machines.
 *
 * Pure data, DOM-free: the MCP describes and checks it too. The UI turns a hue into CSS.
 */

/** The palette, as hues (degrees round the colour wheel); the UI picks the lightness. */
export const DEVICE_COLORS = {
  red: 2,
  orange: 24,
  amber: 46,
  lime: 84,
  green: 142,
  cyan: 186,
  blue: 212,
  indigo: 236,
  violet: 272,
  pink: 322,
} as const;

export type DeviceColor = keyof typeof DEVICE_COLORS;

export const DEVICE_COLOR_NAMES = Object.keys(DEVICE_COLORS) as DeviceColor[];

const hashed = (type: string): DeviceColor =>
  DEVICE_COLOR_NAMES[
    [...type].reduce((hash, char) => (hash * 31 + char.charCodeAt(0)) >>> 0, 7) % DEVICE_COLOR_NAMES.length
  ];

/** A device's colour: the one it names, else one hashed from its type. */
export const deviceColor = (device: { type: string; color?: DeviceColor }): DeviceColor =>
  device.color ?? hashed(device.type);

/** A device's colour as a hue. */
export const deviceHue = (device: { type: string; color?: DeviceColor }): number => DEVICE_COLORS[deviceColor(device)];
