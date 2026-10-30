import { createContext } from "react";

/**
 * Whether the rack stacks its devices, one full-width row each: the touch shell's narrow column
 * (MOBILE-24), where everything flows top to bottom. Folded devices and sections then run across,
 * not down, and a device takes the screen's width.
 */
export const RackStacked = createContext(false);

/**
 * A device's height in the desktop rack, folded or open, so a row of them lines up: a folded
 * device's column is this tall, and an open one's header and sections add up to it. Tall enough
 * for two rows of knobs under a section's title.
 */
export const DEVICE_HEIGHT = 260;

/** An open device's header, its rule included, which its sections sit under. */
export const DEVICE_HEADER_HEIGHT = 40;

/** A section's height in an open device: what's left under the header. */
export const SECTION_HEIGHT = DEVICE_HEIGHT - DEVICE_HEADER_HEIGHT;
