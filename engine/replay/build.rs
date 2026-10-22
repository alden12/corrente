//! Link the natively built engine (`cargo build --release` in engine/, after `compile.ts --gen`).
//! `cargo:` lines printed here are instructions to cargo: where to look for the library, which to
//! link, and (rpath) where the program looks for it when it runs.
// TS: none; a build script is cargo's equivalent of a prebuild step that configures the link.
fn main() {
    let release = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../target/release");
    println!("cargo:rustc-link-search=native={}", release.display());
    println!("cargo:rustc-link-lib=dylib=corrente_engine");
    println!("cargo:rustc-link-arg=-Wl,-rpath,{}", release.display());
}
