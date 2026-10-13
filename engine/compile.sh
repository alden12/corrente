#!/bin/sh
# Build the audio engine (INST-36.1) in its pinned toolchain image and write engine.wasm here.
#
#   sh engine/compile.sh           rebuild engine.wasm (commit it with the change that caused it)
#   sh engine/compile.sh --check   rebuild elsewhere and fail if it differs from the committed one
#
# Needs Docker. The image is built on first use and tagged by a hash of toolchain/, so changing the
# toolchain builds a new one. ENGINE_TOOLCHAIN_IMAGE names an image built elsewhere (CI's cache).
# Sources go in and the build comes out as tar streams rather than a mounted folder, which hangs for
# folders under ~/Documents on macOS and behaves the same everywhere.
set -eu
cd "$(dirname "$0")"

TOOLCHAIN_HASH=$(cat toolchain/* | shasum -a 256 | cut -c1-12)
IMAGE=${ENGINE_TOOLCHAIN_IMAGE:-corrente-engine-toolchain:$TOOLCHAIN_HASH}
docker image inspect "$IMAGE" >/dev/null 2>&1 || docker build -t "$IMAGE" toolchain

# macOS tar adds its own metadata, which the toolchain's GNU tar warns about.
TAR_FLAGS=""
if tar --version | grep -q bsdtar; then TAR_FLAGS="--no-mac-metadata --no-xattrs"; fi

OUT=$(mktemp -d)
trap 'rm -rf "$OUT"' EXIT
# shellcheck disable=SC2086
COPYFILE_DISABLE=1 tar $TAR_FLAGS -cf - build.sh Cargo.toml Cargo.lock src blocks \
  | docker run --rm -i "$IMAGE" sh -c 'tar -xf - && sh build.sh >&2 && tar -cf - engine.wasm' \
  | tar -xf - -C "$OUT"
# A failed build leaves nothing to compare (sh has no pipefail to catch it in the pipeline above).
if [ ! -f "$OUT/engine.wasm" ]; then
  echo "The engine did not build: the errors are above." >&2
  exit 1
fi

BUILT=$(shasum -a 256 "$OUT/engine.wasm" | cut -c1-64)
if [ "${1:-}" = "--check" ]; then
  COMMITTED=$(shasum -a 256 engine.wasm | cut -c1-64)
  if [ "$BUILT" != "$COMMITTED" ]; then
    echo "engine.wasm is out of date: the sources build $BUILT, the committed file is $COMMITTED." >&2
    echo "Run 'yarn engine:build' and commit engine.wasm." >&2
    exit 1
  fi
  echo "engine.wasm matches its sources ($BUILT)."
else
  cp "$OUT/engine.wasm" engine.wasm
  echo "engine.wasm rebuilt ($BUILT, $(wc -c < engine.wasm | tr -d ' ') bytes)."
fi
