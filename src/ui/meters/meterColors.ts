/** The level meters' colours (DAW-8.5), on the faders' taper, so each sits at its own level. */
import { positionOfGain } from "../controls/gainTaper";

/** Where the meter turns amber (-6 dB) and red (-1 dB), as a share of its length. */
const AMBER_AT = positionOfGain(10 ** (-6 / 20)) * 100;
const RED_AT = positionOfGain(10 ** (-1 / 20)) * 100;

/** Green, amber over -6 dB, red over -1 dB, laid across a meter's whole length (left to right). */
export const METER_GRADIENT = `linear-gradient(to right, var(--color-good) 0 ${AMBER_AT}%, var(--color-warn) ${AMBER_AT}% ${RED_AT}%, var(--color-hot) ${RED_AT}%)`;
