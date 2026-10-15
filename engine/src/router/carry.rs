//! What a reloaded track's plan takes over from the one it replaced (Track::carry, INST-36.7): the
//! words that map new nodes to old, checked to fit both plans, then the state moved across.

use super::graph::SectionState;
use crate::plan::{Node, Section};

/// One section's part of carry's words: its count, then that many old node indices; and the rest.
// TS: const count = words[0]; return count >= 0 && words.length > count ? [words.slice(1, count + 1), words.slice(count + 1)] : undefined
// `split_at(n)` gives the first n and the rest, as two views of the same words.
pub(super) fn section_map(words: &[i32]) -> Option<(&[i32], &[i32])> {
    let (&count, rest) = words.split_first()?;
    let count = usize::try_from(count).ok()?;
    (rest.len() >= count).then(|| rest.split_at(count))
}

/// Whether two plans' nodes are the same kind of thing, so one can take over the other's state.
// TS: return node.kind === other.kind && node.outputs === other.outputs
pub(super) fn same_node(node: &Node, other: &Node) -> bool {
    node.kind == other.kind && node.outputs == other.outputs
}

/// Whether a section's map fits: one entry per new node, each -1 or an old node of the same kind
/// (and, for a delay, the same ring length), no old node taken twice.
// TS:
//   const taken = new Set<number>();
//   return map.length === section.nodes.length && map.every((from, index) => {
//     if (from < 0) return true;
//     const other = old.nodes[from];
//     if (!other || taken.has(from) || !sameNode(section.nodes[index], other) || !state.units[index].fits(oldState.units[from])) return false;
//     taken.add(from); return true;
//   });
// It allocates (the `taken` list), which is fine here: carry runs with a load, never while rendering.
pub(super) fn map_fits(section: &Section, state: &SectionState, old: &Section, old_state: &SectionState, map: &[i32]) -> bool {
    let mut taken = vec![false; old.nodes.len()];
    map.len() == section.nodes.len()
        && map.iter().enumerate().all(|(index, &from)| {
            let Ok(from) = usize::try_from(from) else { return true };
            let fits = old.nodes.get(from).is_some_and(|other| same_node(&section.nodes[index], other))
                && !taken[from]
                && state.units[index].fits(&old_state.units[from]);
            if fits {
                taken[from] = true;
            }
            fits
        })
}

/// Move each mapped node's unit, and its output buffers (its last sample, for feedback), from the old
/// section to the new. The old section gets the new one's fresh units in their place. Returns how
/// many moved.
// TS:
//   return map.filter((from, index) => {
//     if (from < 0) return false;
//     [state.units[index], oldState.units[from]] = [oldState.units[from], state.units[index]];
//     for (let port = 0; port < section.nodes[index].outputs; port++) state.buffers[section.base[index] + port].set(oldState.buffers[old.base[from] + port]);
//     return true;
//   }).length;
// `std::mem::swap` trades two values in place: the only way to move a unit out of a list without
// leaving a hole.
pub(super) fn take_over(section: &Section, state: &mut SectionState, old: &Section, old_state: &mut SectionState, map: &[i32]) -> usize {
    map.iter()
        .enumerate()
        .filter(|&(index, &from)| {
            let Ok(from) = usize::try_from(from) else { return false };
            std::mem::swap(&mut state.units[index], &mut old_state.units[from]);
            (0..section.nodes[index].outputs).for_each(|port| {
                state.buffers[section.base[index] + port] = old_state.buffers[old.base[from] + port];
            });
            true
        })
        .count()
}
