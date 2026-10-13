# Corrente - conventions

The short list of coding conventions to follow throughout the codebase.

Comments cite the maintainer's roadmap: a bare ticket ref (`DAW-10`, `INST-4`, `MOBILE-6`) or
`apm: "<section>"` for one of its design sections. The roadmap itself is not published, so
treat these as labels that tie related code together, not as links to follow.

## Validation

- Use **zod** for validation at every untrusted boundary (MCP tool inputs,
  parsing/loading external data). Derive zod schemas from the parameter schema
  rather than hand-writing checks - see `specToZod` in `src/audio/params/zod.ts`.
- Keep "validation" (reject bad input, with a message) distinct from
  "coercion/normalization" (clamp/snap a trusted value). The `ParamStore` coerces;
  the MCP boundary validates.

## Style: functional and declarative

- Favour functional, declarative code over imperative. Prefer `map`/`filter`/
  `reduce`/`flatMap` and immutable transforms over manual loops and mutation. Reach
  for a `for` loop only where it genuinely reads better or matters for performance -
  the realtime hot paths (the scheduler `tick`, the worklet `process()` sample loops)
  are the legitimate exceptions, not the rule.
- **Use full, descriptive variable names, including in iterators and short lambdas**
  (`tracks.map((track) => ...)`, not `(t) =>`; `clip`, `placement`, `effect`, `note`,
  not `c`/`p`/`fx`/`n`). Existing single-letter code is grandfathered; write new code
  the readable way and tidy names as you touch the surrounding lines.
- For key-based dispatch, use an **object key -> value (or key -> function) map**
  instead of `switch`/`case` or long `if`/`else if` chains. Examples in the code:
  the MCP bridge inbound handlers (`src/audio/mcp/bridge.ts`), the param coercers
  (`src/audio/params/store.ts`), and the schema-to-zod builders
  (`src/audio/params/zod.ts`). This keeps the set of cases data, so it is easy to
  extend and hard to leave a case unhandled.

## Extensibility: don't hardcode the catalog

- Instruments, effects, and their parameters are declared once in the pure
  catalogs (`src/audio/instruments/catalog.ts`, `src/audio/effects/catalog.ts`)
  and realized by the registries (`registry.ts`). These are the single extension
  points. Adding one should be: add a schema + catalog entry, add a factory, then
  `yarn portraits` to draw its Explore card art (a unit test fails until you do).
- The registries are typed `Record<InstrumentType, ...>` / `Record<EffectType, ...>`
  off the catalog keys, so a cataloged type without a factory is a compile error.
- UI and MCP must **iterate the catalogs**, never hardcode instrument/effect/param
  names or lists. New entries should appear in the library, the add menus, and the
  MCP palette automatically.
- The parameter schema is the keystone: UI, MCP, automation, and persistence are
  projections of it. Don't add per-parameter or per-type UI/branching - map over
  the schema/catalog.
- Keep the Node MCP server DOM-free: pure data (schemas/catalogs) stays in
  `catalog.ts`; anything touching Web Audio stays in `registry.ts`/engine.
- **Follow MIDI / General MIDI conventions** where a standard exists, so the app
  interoperates with other tools and matches what an LLM already knows. Notably: C4 = MIDI
  60; drum kits default their pad notes to the GM drum map (kick = 36, snare = 38, closed
  hat = 42, open hat = 46, ...), not an ad-hoc layout. Defaults stay data (remappable), but
  pick the standard as the default.

## Files & formatting

- **Split files before they get unwieldy.** When a file grows past a few hundred
  lines or starts holding several unrelated responsibilities, break it up (extract a
  component, a helper module, a sub-store). Prefer many small, focused files over one
  large one. Current oversized files to chip away at when touched: `projectStore.ts`,
  `AudioEngine.ts`, `ArrangementTimeline.tsx`.
- **Leave every file formatted after editing** (`yarn format`; CI runs `yarn format:check`).
- No em-dash characters in committed text (commits, comments, docs).
- **UI glyph icons: size them up.** Small glyph controls (disclosure arrows, chevrons,
  kebab dots) tend to render too cramped. Default new ones to ~16-18px with an adequate
  hit area (~`w-6`/`w-7`), not `text-[10px]`; size up existing small ones when you touch
  them.

## Persistence: forward migrations, no legacy formats

- Saved projects must keep loading, so a project-document (`project.json`) schema bump needs
  a pure `fromVersion -> fromVersion + 1` upcaster in `src/audio/project/documentMigration.ts`;
  `ProjectRepository.load` chains them and heals the bundle.
- Forward-only: no downgrades, no reading arbitrarily old shapes, and no `LEGACY_*` keys or
  `Legacy*` back-compat fields beside the upcasters.

## Running locally

- **`yarn dev`** runs the app on **:5155**. With no `.env`, it runs on its own and keeps
  projects in the browser (OPFS). `.env.example` lists the optional client settings.
- **`yarn mcp-server`** is the **local MCP** server, which lets an MCP client drive the open app.
  Claude Code spawns it over stdio from `.mcp.json`, which calls `tsx server/index.ts` directly
  (yarn's banner on stdout would corrupt the MCP stream). Never run it by hand; it talks MCP on
  stdout and would just sit there. If it dies, reconnect it from Claude Code's `/mcp` menu.
- **`yarn test:e2e`** needs no setup. Playwright starts the dev server with `vite --mode test`,
  which loads the committed `.env.test` (blank `VITE_*` values) *after* `.env`, so a local
  `.env` cannot turn sign-in on and strand every test at a login screen. If you add a new
  build-time `VITE_*` that must be off in e2e, blank it in `.env.test`.

## CI

- `lint`, `format:check`, `build` (with `tsc`), `check:server` (the local MCP's types), `test`,
  `check:pwa` and `test:e2e` run in GitHub Actions on every push and pull request. Keep them
  green; a red gate blocks the merge.
