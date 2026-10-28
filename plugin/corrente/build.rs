//! Builds the app's page into the plugin (PLUGIN-3.3): every file of the app's built `dist/` becomes
//! bytes in the binary, so the window works wherever the plugin is installed, with no dev server and
//! nothing read from disk. `yarn plugin:bundle` builds the app first.
//!
//! - `dist/` is `packages/app/dist`, or `CORRENTE_APP_DIR` if set.
//! - With no `dist/`, the plugin still builds (its tests need no app) and the window says to build it.
//! - Writes `app.rs` into Cargo's output folder: `FILES`, a list of (path, bytes), which `editor.rs`
//!   includes. Cargo runs this again whenever a file under `dist/` changes.
//!
//! Rust notes, for reading this file:
//! - A `build.rs` is a program Cargo compiles and runs before the crate itself. What it prints as
//!   `cargo::...` lines are instructions to Cargo; `OUT_DIR` is the folder it may write into.
//! - `include_bytes!("path")` puts a file's bytes into the binary when it's compiled, as a `&[u8]`.

use std::path::{Path, PathBuf};

fn main() {
    // TS: const dist = process.env.CORRENTE_APP_DIR ?? join(__dirname, "../../dist");
    let dist = std::env::var_os("CORRENTE_APP_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| Path::new(env!("CARGO_MANIFEST_DIR")).join("../../dist"));
    println!("cargo::rerun-if-env-changed=CORRENTE_APP_DIR");
    // A folder here means "any file under it": a new app build rebuilds the plugin.
    println!("cargo::rerun-if-changed={}", dist.display());

    // TS: const entries = files(dist).map((file) => `(${JSON.stringify(relative(dist, file))}, include_bytes!(${JSON.stringify(file)}))`);
    let entries: Vec<String> = files(&dist)
        .iter()
        .map(|file| {
            let path = file.strip_prefix(&dist).unwrap().to_string_lossy().replace('\\', "/");
            // `{:?}` writes a string as a quoted, escaped Rust literal.
            format!("    ({path:?}, include_bytes!({:?})),", file.display().to_string())
        })
        .collect();
    let code = format!(
        "/// The app's `dist/`, built in by build.rs: each file's path under it, and its bytes.\npub static FILES: &[(&str, &[u8])] = &[\n{}\n];\n",
        entries.join("\n")
    );
    // TS: writeFileSync(join(process.env.OUT_DIR, "app.rs"), code);
    std::fs::write(Path::new(&std::env::var_os("OUT_DIR").unwrap()).join("app.rs"), code).unwrap();
}

/// Every file under `folder`, in a stable order, or none if it doesn't exist.
// TS: const files = (folder) => existsSync(folder) ? readdirSync(folder).sort().flatMap((entry) => isDirectory(entry) ? files(entry) : [entry]) : [];
fn files(folder: &Path) -> Vec<PathBuf> {
    let Ok(entries) = std::fs::read_dir(folder) else { return Vec::new() };
    let mut paths: Vec<PathBuf> = entries.map(|entry| entry.unwrap().path()).collect();
    paths.sort();
    paths.into_iter().flat_map(|path| if path.is_dir() { files(&path) } else { vec![path] }).collect()
}
