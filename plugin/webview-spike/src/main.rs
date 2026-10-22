//! The spike as a program of its own, in nih-plug's standalone wrapper: a window with the editor
//! in it and the audio on the default output, for trying the webview without a DAW.
//!
//!   cargo run --release -p webview-spike
fn main() {
    nih_plug::wrapper::standalone::nih_export_standalone::<webview_spike::Spike>();
}
