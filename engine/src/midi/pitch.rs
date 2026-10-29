//! The pitch nodes' arithmetic (DAW-12): notes moved in the song's key, and folded into a range.
//! nodes.rs wires them up; here is only what a pitch becomes.
//!
//! - **degrees** snaps a note that isn't in the key to the nearest one that is (or the one below, or
//!   above), then moves it by `steps` of the key's scale: two steps from C in C major is E, from D is F.
//! - **range** moves a note by octaves until it lies from `low` to `high`.
//!
//! A key's scale is bits from its tonic (Key in mod.rs): bit n is set when the note n semitones above
//! the tonic is in it. The tonic is always in its key, so a snap always finds a note within an octave.

use super::Key;

/// The sides a note not in the key snaps to, by the number the field gives; anything else is nearest (0).
const DOWN: usize = 1;
const UP: usize = 2;

/// The key's scale with its tonic in it, whatever it was given.
// TS: key.scale | 1
fn scale(key: Key) -> u16 {
    key.scale | 1
}

/// Whether `pitch` is in `key`.
// TS: (scale(key) >> mod(pitch - key.tonic, 12)) & 1
fn in_key(key: Key, pitch: i32) -> bool {
    // `rem_euclid` is a remainder that's never negative, as TS's ((n % 12) + 12) % 12.
    scale(key) >> (pitch - i32::from(key.tonic)).rem_euclid(12) & 1 == 1
}

/// `pitch`, or the note in `key` it snaps to on `side`: below, above, or the nearer (below at a tie).
// TS: const below = range(12).map((d) => pitch - d).find(inKey); const above = ...; return SIDES[side](below, above)
pub fn snap(key: Key, pitch: i32, side: usize) -> i32 {
    // The tonic is in the key, so each search finds a note within the octave.
    let below = (0..12).map(|distance| pitch - distance).find(|&note| in_key(key, note)).unwrap_or(pitch);
    let above = (0..12).map(|distance| pitch + distance).find(|&note| in_key(key, note)).unwrap_or(pitch);
    match side {
        DOWN => below,
        UP => above,
        _ if pitch - below <= above - pitch => below,
        _ => above,
    }
}

/// `pitch` (in `key`) moved `steps` degrees of the key's scale, up or down.
// TS: const [octave, degree] = [floor((pitch - tonic) / 12), notesBelow(class)]; const moved = degree + steps; return tonic + (octave + floor(moved / n)) * 12 + nthNote(mod(moved, n))
pub fn degrees(key: Key, pitch: i32, steps: i32) -> i32 {
    let scale = scale(key);
    let notes = scale.count_ones() as i32;
    let from_tonic = pitch - i32::from(key.tonic);
    // `div_euclid` rounds down, as Math.floor of the division.
    let (octave, class) = (from_tonic.div_euclid(12), from_tonic.rem_euclid(12));
    // Its degree: how many of the scale's notes are below it in the octave.
    let degree = (scale & ((1 << class) - 1)).count_ones() as i32;
    let moved = degree + steps;
    // The scale's notes as semitones above the tonic; `nth` takes the one at that degree.
    let to_class = (0..12).filter(|&bit| scale >> bit & 1 == 1).nth(moved.rem_euclid(notes) as usize).unwrap_or(0);
    i32::from(key.tonic) + (octave + moved.div_euclid(notes)) * 12 + to_class
}

/// `pitch` moved by octaves to lie from `low` to `high`. A range under an octave can't hold every
/// note: one below it lands on the first octave at or above `low`, one above on the first at or below `high`.
// TS: pitch < low ? pitch + ceil((low - pitch) / 12) * 12 : pitch > high ? pitch - ceil((pitch - high) / 12) * 12 : pitch
pub fn fold(pitch: i32, low: i32, high: i32) -> i32 {
    let high = high.max(low);
    if pitch < low {
        pitch + (low - pitch + 11) / 12 * 12
    } else if pitch > high {
        pitch - (pitch - high + 11) / 12 * 12
    } else {
        pitch
    }
}
