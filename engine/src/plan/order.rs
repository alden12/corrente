//! Checking a section's steps: every node runs exactly once, after everything it reads.

use super::{Node, Source, Step, StepMode};

/// Whether every node runs exactly once, and reads only what has already been computed when it runs.
/// A plan that fails this would still play, just wrongly (a node reading last block's samples, or
/// zeros), so it is refused: a mistake in the plan compiler shows up as an error rather than as a
/// subtly wrong sound.
///
/// - A single node reads nodes from earlier steps.
/// - A one-sample loop's members may also read members earlier in the loop, and any member as a
///   feedback edge (the sample before).
/// - A loop cut by delays runs its delays first and writes their input last, so a delay may take its
///   input from any member, but its length must come from outside the loop. The other members read
///   earlier steps, the delays, and members before them.
// TS: function runsInOrder(nodes: Node[], steps: Step[]): boolean
pub(super) fn runs_in_order(nodes: &[Node], steps: &[Step]) -> bool {
    // TS: const ready = new Array(nodes.length).fill(false)
    let mut ready = vec![false; nodes.len()];
    // TS: for (const step of steps)
    for step in steps {
        let members = &step.nodes;
        let in_step = |index: usize| members.contains(&index);
        let in_order = match step.mode {
            // TS: one member, and every input either isn't a node in this section or is a ready
            // node's output this block. `Source::Buffer(from, _) if ready[from]` matches a Buffer
            // and checks it in one go.
            StepMode::Node => {
                let node = &nodes[members[0]];
                members.len() == 1 && node.inputs().all(|source| matches!(source, Source::Buffer(from, _) if ready[from]) || source.node().is_none())
            }
            // TS: members.every((index, position) => nodes[index].inputs().every((source) => ...))
            // `members[..position]` is members.slice(0, position).
            StepMode::SampleLoop => members.iter().enumerate().all(|(position, &index)| {
                nodes[index].inputs().all(|source| match source {
                    Source::Buffer(from, _) => ready[from] || members[..position].contains(&from),
                    Source::Previous(from, _) => ready[from] || in_step(from),
                    _ => true,
                })
            }),
            StepMode::ChunkLoop => {
                // TS: how many members at the start are delays, then
                //   const [cut, rest] = [members.slice(0, delays), members.slice(delays)]
                // `&&index` unwraps two layers of reference to get the number. `split_at` gives two
                // views into the same list rather than copies.
                let delays = members.iter().take_while(|&&index| nodes[index].is_delay()).count();
                let (cut, rest) = members.split_at(delays);
                let delays_ok = cut.iter().all(|&index| {
                    let node = &nodes[index];
                    let input_ok = match node.audio[0] {
                        Source::Buffer(from, _) => ready[from] || in_step(from),
                        Source::Previous(..) => false,
                        _ => true,
                    };
                    let length_ok = match node.audio[1] {
                        Source::Buffer(from, _) => ready[from],
                        Source::Previous(..) => false,
                        _ => true,
                    };
                    input_ok && length_ok
                });
                let rest_ok = rest.iter().enumerate().all(|(position, &index)| {
                    !nodes[index].is_delay()
                        && nodes[index].inputs().all(|source| match source {
                            Source::Buffer(from, _) => ready[from] || cut.contains(&from) || rest[..position].contains(&from),
                            Source::Previous(..) => false,
                            _ => true,
                        })
                });
                !cut.is_empty() && delays_ok && rest_ok
            }
        };
        // A node in two steps, or out of order: refuse.
        if !in_order || members.iter().any(|&index| ready[index]) {
            return false;
        }
        // TS: members.forEach((index) => (ready[index] = true))
        members.iter().for_each(|&index| ready[index] = true);
    }
    // TS: return ready.every(Boolean). Every node ran, so the outputs and other sections can read any of them.
    ready.iter().all(|&ran| ran)
}
