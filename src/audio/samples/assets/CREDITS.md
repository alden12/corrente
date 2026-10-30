# Built-in sample kit - credits & license

Every WAV in this directory is **synthesized from scratch** (no third-party audio is
sampled, recorded, or copied): the house kit by `generate.mjs`, and the `808-*` kit by
rendering its voices (`../kits/voices808.ts`, small devices built from the engine's own
blocks) on the engine, with `yarn kits`. The output is therefore an
original work and is released into the public domain under
[CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) - free to use,
modify, and redistribute with no attribution required.

These are intentionally simple "house kit" placeholders (a synthesized kick, snare,
hats, clap, rim, and tom). They exist so the Sampler makes sound out of the box and
stay license-clean. For richer, real-world samples, import your own files (any
WAV) - that path lands in the follow-up slice.

Regenerate the WAVs with:

```
node src/audio/samples/assets/generate.mjs   # the house kit
yarn kits                                    # the 808 kit
```
