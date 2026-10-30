import { createContext } from "react";

/**
 * Whether the rack stacks its devices, one full-width row each: the touch shell's narrow column
 * (MOBILE-24), where everything flows top to bottom. Folded devices and sections then run across,
 * not down, and a device takes the screen's width.
 */
export const RackStacked = createContext(false);
