/**
 * Build the audio engine (INST-36.1) in its pinned toolchain image, and write here what it makes:
 * engine.wasm, catalogue.json (every block's ports, ranges and licences, INST-36.2) and CREDITS.md.
 *
 *   node engine/compile.ts           rebuild all three (commit them with the change that caused it)
 *   node engine/compile.ts --check   rebuild and fail if any differs from the committed one
 *   node engine/compile.ts --test    run the Rust unit tests
 *   node engine/compile.ts --gen     write the blocks' generated Rust to gen/, so cargo can build the
 *                                    engine natively outside the toolchain (PLUGIN-2.1)
 *
 * Needs Docker. The toolchain always runs as x86 Linux, emulated on an ARM Mac, because the
 * compilers' output can differ by the processor they run on and CI's is x86: the same platform is
 * what makes a laptop's engine.wasm match CI's byte for byte.
 *
 * The image is built on first use and tagged by a hash of toolchain/ and the platform, so changing
 * either builds a new one. ENGINE_TOOLCHAIN_IMAGE names an image built elsewhere (CI's cache).
 * Sources are copied into a container and the build out of it with `docker cp`, rather than through
 * a mounted folder, which hangs for folders under ~/Documents on macOS.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { CatalogueError, buildCatalogue, creditsFile, licenceTextsFrom, type FaustJson } from "./catalogue.ts";

const engineDir = fileURLToPath(new URL(".", import.meta.url));
const PLATFORM = "linux/amd64";
/** What the build reads; the rest of engine/ stays out of the container. */
const SOURCES = ["Cargo.toml", "Cargo.lock", "src", "blocks"];
const CARGO_FLAGS = ["--release", "--locked", "--offline"];
const BUILT_WASM = "/src/target/wasm32-unknown-unknown/release/corrente_engine.wasm";
/** Where the toolchain's Faust keeps its libraries, and the two that hold their licence texts. */
const FAUST_LIBRARIES = "/usr/local/share/faust";
const LICENCE_LIBRARIES = ["filters.lib", "maths.lib"];

/** A failure with a message for whoever ran the script, rather than a stack trace. */
class EngineError extends Error {}

/** Run docker in engine/. Its output shows as it runs, unless `quiet`, which keeps it for the error. */
const docker = (args: string[], { quiet = false } = {}) => {
  const result = spawnSync("docker", args, {
    cwd: engineDir,
    encoding: "utf8",
    stdio: ["ignore", quiet ? "pipe" : "inherit", quiet ? "pipe" : "inherit"],
  });
  if (result.error) throw new EngineError(`Could not run docker: ${result.error.message}. Is Docker installed?`);
  if (result.status !== 0) throw new EngineError(`docker ${args[0]} failed.${quiet ? `\n${result.stderr}` : ""}`);
  return result.stdout ?? "";
};

/** The toolchain image to build in, built first if this machine doesn't have it. */
const toolchainImage = () => {
  const preBuilt = process.env.ENGINE_TOOLCHAIN_IMAGE;
  if (preBuilt) return preBuilt;
  const toolchainDir = join(engineDir, "toolchain");
  const hash = readdirSync(toolchainDir)
    .sort()
    .reduce(
      (digest, file) => digest.update(readFileSync(join(toolchainDir, file))),
      createHash("sha256").update(PLATFORM),
    )
    .digest("hex");
  const image = `corrente-engine-toolchain:${hash.slice(0, 12)}`;
  const present = spawnSync("docker", ["image", "inspect", image], { stdio: "ignore" }).status === 0;
  if (!present) {
    console.error(`Building the toolchain image ${image}, once (10 minutes or more, longer when emulated).`);
    docker(["build", "--platform", PLATFORM, "--tag", image, "toolchain"]);
  }
  return image;
};

/**
 * The block kinds, by file name in blocks/. A block's kind is its index in this order, so the app's
 * tests sort the same way. Names become Rust module names and shell words, so they stay plain.
 */
const blockKinds = () => {
  const kinds = readdirSync(join(engineDir, "blocks"))
    .filter((file) => file.endsWith(".dsp"))
    .map((file) => file.replace(/\.dsp$/, ""))
    .sort();
  const badName = kinds.find((kind) => !/^[a-z][a-z0-9_]*$/.test(kind));
  if (badName) throw new EngineError(`blocks/${badName}.dsp: block names are lower case letters, digits and _.`);
  return kinds;
};

/**
 * Faust turns one block into its own Rust struct, `Block_<kind>`, in gen/, and describes it in
 * blocks/<kind>.dsp.json for the catalogue. -ftz 1 flushes values too small to hear to zero, so
 * decaying filters don't slow to a crawl on chips that compute them slowly (INST-33 roadblock 5).
 */
const faustCommand = (kind: string) =>
  `faust -lang rust -cn Block_${kind} -ftz 1 -json -o gen/${kind}.rs blocks/${kind}.dsp`;

/** The registry src/faust.rs includes: one module per block, then what the engine needs per kind. */
const registry = (kinds: string[]) => {
  const each = (line: (kind: string) => string) => kinds.map(line).join("");
  return [
    each((kind) => `pub mod ${kind} { use super::*; include!("${kind}.rs"); }\n`),
    `pub const FACTORIES: &[fn() -> Box<Block>] = &[\n${each((kind) => `  || -> Box<Block> { Box::new(${kind}::Block_${kind}::new()) },\n`)}];\n`,
    `pub const INPUTS: &[usize] = &[\n${each((kind) => `  ${kind}::FAUST_INPUTS,\n`)}];\n`,
    `pub const OUTPUTS: &[usize] = &[\n${each((kind) => `  ${kind}::FAUST_OUTPUTS,\n`)}];\n`,
    "pub const COUNT: usize = INPUTS.len();\n",
    `pub const NAMES: &[&str] = &[\n${each((kind) => `  "${kind}",\n`)}];\n`,
  ].join("");
};

/**
 * In a fresh container: copy the sources and the registry in, run Faust over the blocks, then cargo
 * (unless there are no `cargoArgs`), then copy each of `collect` out before the container goes.
 */
const cargoInToolchain = (image: string, cargoArgs: string[], collect: { from: string; to: string }[] = []) => {
  const kinds = blockKinds();
  const cargo = cargoArgs.length > 0 ? [["cargo", ...cargoArgs].join(" ")] : [];
  const command = [...kinds.map(faustCommand), ...cargo].join(" && ");
  const genDir = mkdtempSync(join(tmpdir(), "corrente-engine-gen-"));
  const container = docker(["create", "--platform", PLATFORM, image, "sh", "-c", command], { quiet: true }).trim();
  try {
    writeFileSync(join(genDir, "registry.rs"), registry(kinds));
    SOURCES.forEach((source) => docker(["cp", source, `${container}:/src/${source}`], { quiet: true }));
    docker(["cp", genDir, `${container}:/src/gen`], { quiet: true });
    try {
      docker(["start", "--attach", container]);
    } catch {
      throw new EngineError("The engine did not build: Faust's or cargo's errors are above.");
    }
    collect.forEach(({ from, to }) => docker(["cp", `${container}:${from}`, to], { quiet: true }));
  } finally {
    spawnSync("docker", ["rm", "--force", container], { stdio: "ignore" });
    rmSync(genDir, { recursive: true, force: true });
  }
};

/** What a build makes, by the file name each is committed under in engine/. */
type Artifacts = Record<string, Buffer>;

/** The catalogue and credits, from the JSON Faust wrote beside each block, and its libraries. */
const catalogueArtifacts = (blocksDir: string, librariesDir: string): Artifacts => {
  const jsons = readdirSync(blocksDir)
    .filter((file) => file.endsWith(".dsp.json"))
    .map((file) => JSON.parse(readFileSync(join(blocksDir, file), "utf8")) as FaustJson);
  try {
    const catalogue = buildCatalogue(jsons);
    return {
      "catalogue.json": Buffer.from(`${JSON.stringify(catalogue, null, 2)}\n`),
      "CREDITS.md": Buffer.from(
        creditsFile(
          catalogue,
          licenceTextsFrom(
            ...(["filters.lib", "maths.lib"].map((library) => readFileSync(join(librariesDir, library), "utf8")) as [
              string,
              string,
            ]),
          ),
        ),
      ),
    };
  } catch (error) {
    if (error instanceof CatalogueError) throw new EngineError(error.message);
    throw error;
  }
};

/** Build everything into a temporary folder, hand the results to `then`, then clear up. */
const withBuild = (image: string, then: (artifacts: Artifacts) => void) => {
  const outDir = mkdtempSync(join(tmpdir(), "corrente-engine-"));
  try {
    const [wasm, blocks, libraries] = ["engine.wasm", "blocks", "libraries"].map((name) => join(outDir, name));
    mkdirSync(libraries);
    cargoInToolchain(
      image,
      ["build", ...CARGO_FLAGS, "--target", "wasm32-unknown-unknown"],
      [
        { from: BUILT_WASM, to: wasm },
        { from: "/src/blocks", to: blocks },
        ...LICENCE_LIBRARIES.map((library) => ({
          from: `${FAUST_LIBRARIES}/${library}`,
          to: join(libraries, library),
        })),
      ],
    );
    then({ "engine.wasm": readFileSync(wasm), ...catalogueArtifacts(blocks, libraries) });
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
};

const hashOf = (contents: Buffer) => createHash("sha256").update(contents).digest("hex");
const committed = (name: string) => {
  try {
    return readFileSync(join(engineDir, name));
  } catch {
    return Buffer.alloc(0);
  }
};

const modes: Record<string, (image: string) => void> = {
  build: (image) =>
    withBuild(image, (artifacts) => {
      Object.entries(artifacts).forEach(([name, contents]) => writeFileSync(join(engineDir, name), contents));
      const wasm = artifacts["engine.wasm"];
      console.log(`engine.wasm rebuilt (${hashOf(wasm)}, ${wasm.length} bytes), with catalogue.json and CREDITS.md.`);
    }),
  "--check": (image) =>
    withBuild(image, (artifacts) => {
      const stale = Object.entries(artifacts).filter(([name, contents]) => !contents.equals(committed(name)));
      if (stale.length > 0) {
        throw new EngineError(
          stale
            .map(
              ([name, contents]) =>
                `${name} is out of date: the sources build ${hashOf(contents)}, the committed file is ${hashOf(committed(name))}.`,
            )
            .join("\n") + "\nRun 'yarn engine:build' and commit what it changes.",
        );
      }
      console.log(
        `engine.wasm, catalogue.json and CREDITS.md match their sources (${hashOf(artifacts["engine.wasm"])}).`,
      );
    }),
  // On the toolchain's own processor rather than as WebAssembly: the router's logic is the same, and
  // the test runner needs a program it can start.
  "--test": (image) => cargoInToolchain(image, ["test", ...CARGO_FLAGS]),
  // Faust's Rust is the same whatever it's compiled for, so it's made here and compiled elsewhere.
  "--gen": (image) => {
    const genDir = join(engineDir, "gen");
    rmSync(genDir, { recursive: true, force: true });
    cargoInToolchain(image, [], [{ from: "/src/gen", to: genDir }]);
    console.log("gen/ written: build natively with cargo in engine/.");
  },
};

const mode = modes[process.argv[2] ?? "build"];
if (!mode) {
  console.error(`Unknown option ${process.argv[2]}: use --check, --test, --gen or nothing.`);
  process.exitCode = 1;
} else {
  try {
    mode(toolchainImage());
  } catch (error) {
    if (!(error instanceof EngineError)) throw error;
    console.error(error.message);
    process.exitCode = 1;
  }
}
