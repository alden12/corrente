#!/bin/sh
# Build engine.wasm from the Faust blocks and the Rust sources (INST-36.1). Runs inside the pinned
# toolchain image (toolchain/Dockerfile); from the host, use compile.sh, which streams the sources in
# and the build out.
set -eu
rm -rf gen && mkdir -p gen

# A block's kind is its index in this order, so sort the same way everywhere.
KINDS=$(cd blocks && ls *.dsp | sed 's/\.dsp$//' | LC_ALL=C sort)

# Faust: each block to its own Rust struct. -ftz 1 flushes values too small to hear to zero, so
# decaying filters don't slow to a crawl on chips that compute them slowly (INST-33 roadblock 5).
for kind in $KINDS; do
  faust -lang rust -cn "Block_$kind" -ftz 1 -o "gen/$kind.rs" "blocks/$kind.dsp"
done

# The registry src/faust.rs includes: one module per block, then what the engine needs per kind.
{
  for kind in $KINDS; do echo "pub mod $kind { use super::*; include!(\"$kind.rs\"); }"; done
  echo 'pub const FACTORIES: &[fn() -> Box<Block>] = &['
  for kind in $KINDS; do echo "  || -> Box<Block> { Box::new($kind::Block_$kind::new()) },"; done
  echo '];'
  echo 'pub const INPUTS: &[usize] = &['
  for kind in $KINDS; do echo "  $kind::FAUST_INPUTS,"; done
  echo '];'
  echo 'pub const OUTPUTS: &[usize] = &['
  for kind in $KINDS; do echo "  $kind::FAUST_OUTPUTS,"; done
  echo '];'
  echo 'pub const COUNT: usize = INPUTS.len();'
} > gen/registry.rs

cargo build --release --locked --offline --target wasm32-unknown-unknown
cp target/wasm32-unknown-unknown/release/corrente_engine.wasm engine.wasm
