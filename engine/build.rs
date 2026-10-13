//! Cargo's build script (INST-36.1): turns each Faust block in blocks/ into Rust, and writes the
//! registry src/faust.rs includes, which numbers the kinds by sorted name. Faust is only in the
//! toolchain image, so the engine builds there (compile.ts puts it there).
//!
//! Rust notes, for reading this file:
//! - Cargo compiles and runs `build.rs` before the crate itself. What it writes goes in `OUT_DIR`, a
//!   folder Cargo picks for each build, and the crate reads it back with `include!`.
//! - Lines printed as `cargo::...` are instructions to Cargo: here, rerun this when blocks/ changes.
//! - `Result<T, E>` is a value or an error. `?` after a call hands an error straight back to the
//!   caller, and `main` returning one fails the build with its message.
//! - `format!` builds a `String` like a template literal; `{{` and `}}` are literal braces in it.

// TS: import type { Error } from ...; import { Path } from ...; import { env, fs, Command } from ...
// `std` is Rust's standard library, built in like Node's `node:` modules.
use std::error::Error;
use std::path::Path;
use std::{env, fs, process::Command};

// TS: function main(): void, throwing on failure. Rust has no exceptions: a function that can fail
// returns a Result, `Ok(value)` or `Err(error)`. `Box<dyn Error>` is "any kind of error".
fn main() -> Result<(), Box<dyn Error>> {
    // TS: console.log("cargo::rerun-if-changed=blocks")
    println!("cargo::rerun-if-changed=blocks");
    // TS: const out = process.env.OUT_DIR ?? throwError()
    // `?`: if this is an Err, return it from main now; otherwise unwrap the Ok value.
    let out = env::var("OUT_DIR")?;
    // TS:
    //   const kinds = readdirSync("blocks")
    //     .filter((path) => extname(path) === ".dsp")
    //     .map((path) => basename(path, ".dsp"));
    // - Each directory entry can itself fail to read, so the list starts as Results. `collect` into
    //   `Result<Vec<_>, ...>` gathers them into one: the whole list, or the first error. Then `?`.
    // - `.into_iter()` starts a lazy chain over the list (like an iterator helper), `.collect()` ends
    //   it into a concrete collection. `::<Vec<String>>` names the type to collect into.
    // - `.filter_map(f)` is filter and map in one: f returns Some(value) to keep, None to drop.
    //   The `?` inside it returns None early from that closure when there's no file stem.
    // - `_` in a type means "work it out".
    let mut kinds = fs::read_dir("blocks")?
        .map(|entry| Ok(entry?.path()))
        .collect::<Result<Vec<_>, std::io::Error>>()?
        .into_iter()
        .filter(|path| path.extension().is_some_and(|extension| extension == "dsp"))
        .filter_map(|path| path.file_stem()?.to_str().map(String::from))
        .collect::<Vec<String>>();
    // A block's kind is its index in this order. Strings sort by byte, as the app's tests sort them.
    // TS: kinds.sort(). Sorts in place, which is why `kinds` was declared `let mut`.
    kinds.sort();
    // TS: for (const kind of kinds) compileBlock(kind, out), stopping at the first throw.
    // `try_for_each` stops at the first Err and returns it; `?` passes it on. `&out` lends `out`
    // rather than giving it away (see lib.rs on ownership).
    kinds.iter().try_for_each(|kind| compile_block(kind, &out))?;
    // TS: writeFileSync(join(out, "registry.rs"), registry(kinds))
    fs::write(Path::new(&out).join("registry.rs"), registry(&kinds))?;
    // TS: return. `Ok(())` is "succeeded, with nothing to return"; `()` is Rust's void.
    Ok(())
}

/// One block to its own Rust struct, `Block_<kind>`. -ftz 1 flushes values too small to hear to zero,
/// so decaying filters don't slow to a crawl on chips that compute them slowly (INST-33 roadblock 5).
// TS:
//   function compileBlock(kind: string, out: string) {
//     const { status } = spawnSync("faust", ["-lang", "rust", ..., join(out, `${kind}.rs`), `blocks/${kind}.dsp`]);
//     if (status !== 0) throw new Error(`Faust could not compile blocks/${kind}.dsp`);
//   }
// `format!("Block_{kind}")` is `Block_${kind}`. `.into()` converts the String into the error type
// the function returns. `if` is an expression in Rust, so it can be the return value directly.
fn compile_block(kind: &str, out: &str) -> Result<(), Box<dyn Error>> {
    let status = Command::new("faust")
        .args(["-lang", "rust", "-cn", &format!("Block_{kind}"), "-ftz", "1", "-o"])
        .arg(Path::new(out).join(format!("{kind}.rs")))
        .arg(format!("blocks/{kind}.dsp"))
        .status()?;
    if status.success() { Ok(()) } else { Err(format!("Faust could not compile blocks/{kind}.dsp").into()) }
}

/// One module per block, then what the engine needs per kind, each list in kind order.
// TS:
//   function registry(kinds: string[]): string {
//     const each = (line: (kind: string) => string) => kinds.map(line).join("");
//     return `${each((kind) => `pub mod ${kind} ...`)}pub const FACTORIES ...`;
//   }
// `&[String]` is a read-only view of a list of strings (borrowed, so the caller keeps it).
// `&dyn Fn(&str) -> String` is TS `(kind: string) => string`; `&` because closures are passed by
// reference here. A `\` at the end of a line inside a string joins it to the next.
fn registry(kinds: &[String]) -> String {
    let each = |line: &dyn Fn(&str) -> String| kinds.iter().map(|kind| line(kind)).collect::<String>();
    let modules = each(&|kind| format!("pub mod {kind} {{ use super::*; include!(concat!(env!(\"OUT_DIR\"), \"/{kind}.rs\")); }}\n"));
    let factories = each(&|kind| format!("  || -> Box<Block> {{ Box::new({kind}::Block_{kind}::new()) }},\n"));
    let inputs = each(&|kind| format!("  {kind}::FAUST_INPUTS,\n"));
    let outputs = each(&|kind| format!("  {kind}::FAUST_OUTPUTS,\n"));
    let names = each(&|kind| format!("  \"{kind}\",\n"));
    format!(
        "{modules}\
         pub const FACTORIES: &[fn() -> Box<Block>] = &[\n{factories}];\n\
         pub const INPUTS: &[usize] = &[\n{inputs}];\n\
         pub const OUTPUTS: &[usize] = &[\n{outputs}];\n\
         pub const COUNT: usize = INPUTS.len();\n\
         pub const NAMES: &[&str] = &[\n{names}];\n"
    )
}
