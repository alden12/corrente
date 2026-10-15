# The audio engine's build toolchain (INST-36.1): Faust turns the blocks into Rust, Rust compiles
# them and the router into engine.wasm. Both versions are pinned, so the same sources always build
# the same bytes; CI rebuilds and compares the hash with the committed engine.wasm. It is always
# built and run as linux/amd64 (compile.ts and CI say so), since output can differ by processor.
# One compile job: emulating x86 on an ARM Mac, more than that runs Docker out of memory.
#
# Changing a version here changes the engine's output, so rebuild and commit engine.wasm with it.
# Each is pinned by its content too, not only its name, so a tag moved or a release re-uploaded
# upstream can't change the build unseen: the base image by its digest, Faust by its checksum.
# (rustup checks what it downloads itself. The apt packages only build Faust, whose output doesn't
# depend on the compiler that built it, and CI's comparison would show it if it did.)
FROM rust:1.99.0-slim-bookworm@sha256:2c3a22f0a5533ea2dd5a16627bc841228151faa2d4de2644ac9987e4a2f1f2fa

ARG FAUST_VERSION=2.88.0
ARG FAUST_SHA256=e4e175cf236924b5b7d4784cbb8c50cc01e211159e169655dd9e6d8f92b871d9
RUN apt-get update \
  && apt-get install -y --no-install-recommends cmake make g++ pkg-config curl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
RUN rustup target add wasm32-unknown-unknown
COPY faust-backends.cmake faust-targets.cmake /tmp/
RUN curl -fsSL -o /tmp/faust.tar.gz https://github.com/grame-cncm/faust/releases/download/${FAUST_VERSION}/faust-${FAUST_VERSION}.tar.gz \
  && echo "${FAUST_SHA256}  /tmp/faust.tar.gz" | sha256sum -c - \
  && tar -xzf /tmp/faust.tar.gz -C /tmp \
  && rm /tmp/faust.tar.gz \
  && cd /tmp/faust-${FAUST_VERSION} \
  && cp /tmp/faust-backends.cmake build/backends/ \
  && cp /tmp/faust-targets.cmake build/targets/ \
  && make -C build cmake BACKENDS=faust-backends.cmake TARGETS=faust-targets.cmake \
  && make -C build -j1 \
  && make install \
  && rm -rf /tmp/faust-${FAUST_VERSION}

WORKDIR /src
