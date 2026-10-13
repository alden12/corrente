/**
 * Build the audio engine (INST-36.1) in its pinned toolchain image and write engine.wasm here.
 *
 *   node engine/compile.ts           rebuild engine.wasm (commit it with the change that caused it)
 *   node engine/compile.ts --check   rebuild and fail if it differs from the committed engine.wasm
 *   node engine/compile.ts --test    run the Rust unit tests
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
import { copyFileSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const engineDir = fileURLToPath(new URL(".", import.meta.url));
const PLATFORM = "linux/amd64";
/** What the build reads; the rest of engine/ stays out of the container. */
const SOURCES = ["Cargo.toml", "Cargo.lock", "build.rs", "src", "blocks"];
const CARGO_FLAGS = ["--release", "--locked", "--offline"];
const BUILT_WASM = "/src/target/wasm32-unknown-unknown/release/corrente_engine.wasm";

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

const sha256 = (file: string) => createHash("sha256").update(readFileSync(file)).digest("hex");

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

/** Run cargo on the sources in a fresh container, then copy `collect` out of it before it goes. */
const cargoInToolchain = (image: string, cargoArgs: string[], collect?: { from: string; to: string }) => {
  const container = docker(["create", "--platform", PLATFORM, image, "cargo", ...cargoArgs], { quiet: true }).trim();
  try {
    SOURCES.forEach((source) => docker(["cp", source, `${container}:/src/${source}`], { quiet: true }));
    try {
      docker(["start", "--attach", container]);
    } catch {
      throw new EngineError("The engine did not build: cargo's errors are above.");
    }
    if (collect) docker(["cp", `${container}:${collect.from}`, collect.to], { quiet: true });
  } finally {
    spawnSync("docker", ["rm", "--force", container], { stdio: "ignore" });
  }
};

/** Build engine.wasm into a temporary folder, hand its path to `then`, then clear up. */
const withBuiltWasm = (image: string, then: (wasm: string) => void) => {
  const outDir = mkdtempSync(join(tmpdir(), "corrente-engine-"));
  try {
    const wasm = join(outDir, "engine.wasm");
    cargoInToolchain(image, ["build", ...CARGO_FLAGS, "--target", "wasm32-unknown-unknown"], {
      from: BUILT_WASM,
      to: wasm,
    });
    then(wasm);
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
};

const committedWasm = join(engineDir, "engine.wasm");

const modes: Record<string, (image: string) => void> = {
  build: (image) =>
    withBuiltWasm(image, (wasm) => {
      copyFileSync(wasm, committedWasm);
      console.log(`engine.wasm rebuilt (${sha256(wasm)}, ${statSync(wasm).size} bytes).`);
    }),
  "--check": (image) =>
    withBuiltWasm(image, (wasm) => {
      const [built, committed] = [sha256(wasm), sha256(committedWasm)];
      if (built !== committed) {
        throw new EngineError(
          `engine.wasm is out of date: the sources build ${built}, the committed file is ${committed}.\n` +
            "Run 'yarn engine:build' and commit engine.wasm.",
        );
      }
      console.log(`engine.wasm matches its sources (${built}).`);
    }),
  // On the toolchain's own processor rather than as WebAssembly: the router's logic is the same, and
  // the test runner needs a program it can start.
  "--test": (image) => cargoInToolchain(image, ["test", ...CARGO_FLAGS]),
};

const mode = modes[process.argv[2] ?? "build"];
if (!mode) {
  console.error(`Unknown option ${process.argv[2]}: use --check, --test or nothing.`);
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
