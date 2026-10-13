# The audio engine's build toolchain (INST-36.1): Faust turns the blocks into Rust, Rust compiles
# them and the router into engine.wasm. Both versions are pinned, so the same sources always build
# the same bytes; CI rebuilds and compares the hash with the committed engine.wasm.
#
# Changing a version here changes the engine's output, so rebuild and commit engine.wasm with it.
FROM rust:1.99.0-slim-bookworm

ARG FAUST_VERSION=2.88.0
RUN apt-get update \
  && apt-get install -y --no-install-recommends cmake make g++ pkg-config curl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
RUN rustup target add wasm32-unknown-unknown
COPY faust-backends.cmake faust-targets.cmake /tmp/
RUN curl -fsSL https://github.com/grame-cncm/faust/releases/download/${FAUST_VERSION}/faust-${FAUST_VERSION}.tar.gz \
    | tar -xz -C /tmp \
  && cd /tmp/faust-${FAUST_VERSION} \
  && cp /tmp/faust-backends.cmake build/backends/ \
  && cp /tmp/faust-targets.cmake build/targets/ \
  && make -C build cmake BACKENDS=faust-backends.cmake TARGETS=faust-targets.cmake \
  && make -C build -j"$(nproc)" \
  && make install \
  && rm -rf /tmp/faust-${FAUST_VERSION}

WORKDIR /src
