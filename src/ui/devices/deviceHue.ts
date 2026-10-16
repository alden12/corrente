/**
 * The hue of the device a control sits in (DAW-61.2), for its controls to draw their value in: a
 * device's knobs and faders take its colour, and only their handle takes the colour of whoever last
 * moved them. Null outside a device, where a control keeps its author's colour throughout.
 */
import { createContext } from "react";

export const DeviceHue = createContext<number | null>(null);
