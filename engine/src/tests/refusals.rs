//! Plans the engine must refuse, leaving the track as it was.

use super::*;

#[test]
fn bad_plans_are_refused() {
    let mul = |audio: Vec<Input>| PlanBuilder::new().node(kind("mul"), audio, vec![]).step(NODE, vec![0]).out(buffer(0));
    assert!(plan::parse(&mul(vec![constant(1.0), constant(1.0)]).words()).is_ok());

    let unknown_kind = PlanBuilder::new().node(999, vec![], vec![]).step(NODE, vec![0]);
    assert!(unknown_kind.refused());
    assert!(mul(vec![constant(1.0)]).refused(), "the wrong number of inputs");
    assert!(mul(vec![buffer(5), constant(1.0)]).refused(), "a node that doesn't exist");
    assert!(mul(vec![port(0, 1), constant(1.0)]).refused(), "an output the node doesn't have");
    assert!(mul(vec![constant(1.0), constant(1.0)]).out(port(0, 1)).refused(), "the voice playing an output that doesn't exist");

    let not_run = PlanBuilder::new().node(kind("mul"), vec![constant(1.0), constant(1.0)], vec![]);
    assert!(not_run.refused(), "a node that never runs");

    assert!(mul(vec![constant(1.0), constant(1.0)]).voices(65).refused(), "too many voices");
    let three_channels = mul(vec![constant(1.0), constant(1.0)]).voice_out(vec![buffer(0), buffer(0), buffer(0)]);
    assert!(three_channels.refused(), "more than two output channels");

    // A count bigger than the words left is refused straight away, not read as that many zeros.
    assert_eq!(plan::parse(&[0, 0, 0, i32::MAX, 0]).err(), Some(plan::REJECTED), "a huge node count");
    let mut huge_params = mul(vec![constant(1.0), constant(1.0)]).words();
    huge_params[0] = i32::MAX;
    assert_eq!(plan::parse(&huge_params).err(), Some(plan::REJECTED), "a huge param count");

    let mut words_left_over = mul(vec![constant(1.0), constant(1.0)]).words();
    words_left_over.push(0);
    assert_eq!(plan::parse(&words_left_over).err(), Some(plan::WRONG_LENGTH));
}

#[test]
fn sections_only_read_what_they_can_see() {
    // A voice's signals outside the voice section.
    let gate_in_pre = PlanBuilder::new().node_in(PRE, kind("mul"), vec![voice(SIGNAL_GATE), constant(1.0)], vec![]).step_in(PRE, NODE, vec![0]);
    assert!(gate_in_pre.refused());
    // The voice sum before the voices have run.
    let sum_in_voice = PlanBuilder::new().node(kind("mul"), vec![voice_sum(0), constant(1.0)], vec![]).step(NODE, vec![0]);
    assert!(sum_in_voice.refused());
    // The pre section reading itself as if it were shared.
    let shared_in_pre = PlanBuilder::new()
        .node_in(PRE, kind("mul"), vec![constant(1.0), constant(1.0)], vec![])
        .node_in(PRE, kind("mul"), vec![shared(0), constant(1.0)], vec![])
        .step_in(PRE, NODE, vec![0])
        .step_in(PRE, NODE, vec![1]);
    assert!(shared_in_pre.refused());
    // A feedback edge as an output.
    let previous_out = PlanBuilder::new().node(kind("mul"), vec![constant(1.0), constant(1.0)], vec![]).step(NODE, vec![0]).out(previous(0));
    assert!(previous_out.refused());
}

#[test]
fn plans_in_the_wrong_order_are_refused() {
    // The delay loop from above, with the add before the multiply it reads: it would play, but
    // every echo a chunk late.
    let misordered = PlanBuilder::new()
        .node(kind("add"), vec![constant(1.0), buffer(2)], vec![])
        .node(KIND_DELAY, vec![buffer(0), constant(40.0)], vec![])
        .node(kind("mul"), vec![buffer(1), constant(0.5)], vec![])
        .step(CHUNK_LOOP, vec![1, 0, 2]);
    assert!(misordered.refused());

    // A node reading one that runs after it.
    let backwards = PlanBuilder::new()
        .node(kind("mul"), vec![buffer(1), constant(1.0)], vec![])
        .node(kind("mul"), vec![constant(1.0), constant(1.0)], vec![])
        .step(NODE, vec![0])
        .step(NODE, vec![1]);
    assert!(backwards.refused());

    // A feedback edge outside a loop.
    let stray_feedback = PlanBuilder::new().node(kind("mul"), vec![previous(0), constant(1.0)], vec![]).step(NODE, vec![0]);
    assert!(stray_feedback.refused());
}
