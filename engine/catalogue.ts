/**
 * The block catalogue (INST-36.2): everything known about each block the engine can run, built from
 * Faust's JSON description of each block's source, so it can't drift from what the engine runs.
 * compile.ts writes it to catalogue.json beside engine.wasm, and the credits from the same
 * licences to CREDITS.md. Pure: no files, no Docker, so the rules here are unit-tested directly.
 *
 * What a block declares in its source, besides its sliders and bargraphs:
 *
 *   declare description "A band-limited sawtooth.";
 *   declare input_ports "frequency 0 24000 Hz";          (name min max [unit], comma-separated)
 *   declare output_ports "signal -1 1";
 *
 * The ranges are real ones: the block tests drive every input across its range and check every
 * output stays within its own (Faust sizes some internals assuming inputs stay within -1..1, which
 * is how the prototype's delay came out 3 samples long).
 */

/** What Faust's `-json` writes about a block: the parts read here. */
export interface FaustJson {
  name: string;
  version: string;
  inputs: number;
  outputs: number;
  meta: Record<string, string>[];
  ui: FaustUiItem[];
}

interface FaustUiItem {
  type: string;
  label: string;
  meta?: Record<string, string>[];
  init?: number;
  min?: number;
  max?: number;
  items?: FaustUiItem[];
}

/** An audio input or output, or a meter: its name and the range its values stay within. */
export interface Port {
  name: string;
  min: number;
  max: number;
  unit?: string;
}

/** A control input (a Faust slider): a port with a starting value. */
export interface Control extends Port {
  init: number;
}

/** Library code a block embeds, and who to credit for it. */
export interface Credit {
  /** A library (`maths.lib`) or one function in it (`vaeffects.lib/moogLadder`). */
  source: string;
  author?: string;
  copyright?: string;
  licence?: string;
}

export interface BlockSpec {
  name: string;
  /** The number a plan names it by: its index in name order, or 1000 and up for native blocks. */
  kind: number;
  description: string;
  inputs: Port[];
  outputs: Port[];
  /** In the order the engine reads them, which is the order the block declares them ([n]). */
  controls: Control[];
  meters: Port[];
  credits: Credit[];
  licences: string[];
}

export interface Catalogue {
  /** The Faust version the blocks were compiled with. */
  faust: string;
  blocks: BlockSpec[];
}

/**
 * The licences a block's library code may carry. Anything else fails the build, so adding one is a
 * decision rather than an accident: Faust's reverbs.lib, for one, has a GPL-3.0-only reverb, which
 * the engine (AGPL, sole copyright) shouldn't take on unnoticed.
 */
export const ALLOWED_LICENCES: Record<string, string> = {
  "LicenseRef-LGPL-2.1-or-later-with-Faust-exception":
    "LGPL 2.1 or later, with the Faust exception: code generated from it may carry any licence",
  "LicenseRef-STK-4.3": "STK 4.3 (MIT-style): free to use, with this credit",
  MIT: "MIT",
};

/**
 * Blocks the engine implements itself, in Rust, rather than from Faust (engine/src/router/delay.rs,
 * sampler.rs and wavetable.rs).
 */
export const NATIVE_BLOCKS: BlockSpec[] = [
  {
    name: "delay",
    kind: 1000,
    description:
      "A delay line: its signal, `length` samples late, interpolated between samples. In a feedback loop it lets the loop run in chunks rather than a sample at a time.",
    inputs: [
      { name: "signal", min: -1, max: 1 },
      { name: "length", min: 0, max: 4094, unit: "samples" },
    ],
    outputs: [{ name: "signal", min: -1, max: 1 }],
    controls: [],
    meters: [],
    credits: [],
    licences: [],
  },
  {
    name: "sampler",
    kind: 1001,
    description:
      "Plays a sample the engine holds, from `start` each time `gate` rises, `frequency` over the `root` note's times its own speed (so pitch and length move together), interpolated between frames. Goes silent at `end`, waiting there (moving `end` out again plays on), or with `loop` on goes round from `start` to `end`. `start` and `end` are fractions of the sample. Stereo out; a mono sample plays in both.",
    inputs: [
      { name: "frequency", min: 0, max: 24000, unit: "Hz" },
      { name: "gate", min: 0, max: 1 },
    ],
    outputs: [
      { name: "left", min: -1, max: 1 },
      { name: "right", min: -1, max: 1 },
    ],
    controls: [
      { name: "sample", min: 0, max: 255, init: 0 },
      { name: "root", min: 0, max: 127, init: 60 },
      { name: "start", min: 0, max: 1, init: 0 },
      { name: "end", min: 0, max: 1, init: 1 },
      { name: "loop", min: 0, max: 1, init: 0 },
    ],
    meters: [],
    credits: [],
    licences: [],
  },
  {
    name: "wavetable",
    kind: 1002,
    description:
      "A wavetable oscillator: one cycle of a waveform read round at `frequency`, morphing through the table's cycles (dark to bright) by `position`, 0 to 1. The table is a sample param on `table`: a built-in wavetable, or any sample cut into 2048-sample cycles. Band-limited, so high notes stay clean.",
    inputs: [
      { name: "frequency", min: 0, max: 24000, unit: "Hz" },
      { name: "position", min: 0, max: 1 },
    ],
    // Band-limiting a table whose cycles peak at 1 can overshoot a little (a square's ringing).
    outputs: [{ name: "signal", min: -1.2, max: 1.2 }],
    controls: [{ name: "table", min: 0, max: 255, init: 0 }],
    meters: [],
    credits: [],
    licences: [],
  },
];

/** Every problem found, so one build reports them all. */
export class CatalogueError extends Error {
  readonly problems: string[];

  constructor(problems: string[]) {
    super(`The block catalogue has problems:\n${problems.map((problem) => `  - ${problem}`).join("\n")}`);
    this.problems = problems;
  }
}

const CONTROL_TYPES = new Set(["hslider", "vslider", "nentry", "button", "checkbox"]);
const METER_TYPES = new Set(["hbargraph", "vbargraph"]);
const CREDIT_FIELDS = { author: "author", copyright: "copyright", license: "licence", licence: "licence" } as const;

/** The block's own declarations and Faust's notes on the libraries it used, as one lookup. */
const metaOf = (json: FaustJson) => Object.assign({}, ...json.meta) as Record<string, string>;

/** "frequency 0 24000 Hz, offset 0 100 samples" into ports, or a problem. */
const parsePorts = (text: string): Port[] | string =>
  text.trim() === ""
    ? []
    : text.split(",").reduce<Port[] | string>((ports, entry) => {
        if (typeof ports === "string") return ports;
        const [name, min, max, unit, ...rest] = entry.trim().split(/\s+/);
        const [low, high] = [Number(min), Number(max)];
        if (!name || !Number.isFinite(low) || !Number.isFinite(high) || low > high || rest.length > 0) {
          return `"${entry.trim()}" is not "name min max [unit]"`;
        }
        return [...ports, { name, min: low, max: high, ...(unit ? { unit } : {}) }];
      }, []);

/** The UI items in the order the block describes them, groups flattened. */
const uiItems = (items: FaustUiItem[]): FaustUiItem[] => items.flatMap((item) => [item, ...uiItems(item.items ?? [])]);

const unitOf = (item: FaustUiItem) => item.meta?.find((entry) => "unit" in entry)?.unit;

const portOf = (item: FaustUiItem): Port => ({
  name: item.label,
  min: item.min ?? 0,
  max: item.max ?? 1,
  ...(unitOf(item) ? { unit: unitOf(item) } : {}),
});

/**
 * Who to credit, from Faust's notes: `maths.lib/author` belongs to the library, and
 * `vaeffects.lib/moogLadder:author` to one function in it. Both spellings of licence occur.
 */
const creditsOf = (meta: Record<string, string>): Credit[] => {
  const bySource = Object.entries(meta).reduce<Record<string, Credit>>((credits, [key, value]) => {
    const match = /^(.+\.lib)\/(?:([^:/]+):)?(author|copyright|license|licence)$/.exec(key);
    if (!match) return credits;
    const [, library, fn, field] = match;
    const source = fn ? `${library}/${fn}` : library;
    return {
      ...credits,
      [source]: { ...credits[source], source, [CREDIT_FIELDS[field as keyof typeof CREDIT_FIELDS]]: value },
    };
  }, {});
  return Object.values(bySource).sort((a, b) => a.source.localeCompare(b.source));
};

/** One block's spec, or the problems with it. */
const blockOf = (json: FaustJson, kind: number): BlockSpec | string[] => {
  const meta = metaOf(json);
  const inputs = parsePorts(meta.input_ports ?? "");
  const outputs = parsePorts(meta.output_ports ?? "");
  const credits = creditsOf(meta);
  const licences = [...new Set(credits.flatMap((credit) => (credit.licence ? [credit.licence] : [])))].sort();
  const items = uiItems(json.ui);
  const problems = [
    !meta.description && "it declares no description",
    meta.input_ports === undefined && json.inputs > 0 && "it declares no input_ports",
    meta.output_ports === undefined && "it declares no output_ports",
    typeof inputs === "string" && `input_ports: ${inputs}`,
    typeof outputs === "string" && `output_ports: ${outputs}`,
    meta.input_ports !== undefined &&
      Array.isArray(inputs) &&
      inputs.length !== json.inputs &&
      `it declares ${inputs.length} input ports but has ${json.inputs} inputs`,
    meta.output_ports !== undefined &&
      Array.isArray(outputs) &&
      outputs.length !== json.outputs &&
      `it declares ${outputs.length} output ports but has ${json.outputs} outputs`,
    ...licences
      .filter((licence) => !(licence in ALLOWED_LICENCES))
      .map((licence) => `its library code is under ${licence}, which isn't allowed (catalogue.ts: ALLOWED_LICENCES)`),
  ].filter((problem): problem is string => typeof problem === "string");
  if (problems.length > 0 || typeof inputs === "string" || typeof outputs === "string") {
    return problems.map((problem) => `${json.name}: ${problem}`);
  }
  return {
    name: json.name,
    kind,
    description: meta.description,
    inputs,
    outputs,
    controls: items
      .filter((item) => CONTROL_TYPES.has(item.type))
      .map((item) => ({ ...portOf(item), init: item.init ?? 0 })),
    meters: items.filter((item) => METER_TYPES.has(item.type)).map(portOf),
    credits,
    licences,
  };
};

/** The catalogue from every block's Faust JSON. Kinds follow name order, as the engine numbers them. */
export const buildCatalogue = (jsons: FaustJson[]): Catalogue => {
  const sorted = [...jsons].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const built = sorted.map((json, kind) => blockOf(json, kind));
  const problems = built.flatMap((block) => (Array.isArray(block) ? block : []));
  if (problems.length > 0) throw new CatalogueError(problems);
  return {
    faust: sorted[0]?.version ?? "",
    blocks: [...built.filter((block): block is BlockSpec => !Array.isArray(block)), ...NATIVE_BLOCKS],
  };
};

/**
 * CREDITS.md: who wrote the library code each block embeds, under what licence, and those licences'
 * texts (taken from the pinned Faust's own filters.lib, so they match the code).
 */
export const creditsFile = (catalogue: Catalogue, licenceTexts: string) => {
  const describe = (credit: Credit) =>
    [
      `\`${credit.source}\``,
      credit.author && `by ${credit.author}`,
      credit.copyright && (/copyright/i.test(credit.copyright) ? credit.copyright : `(c) ${credit.copyright}`),
      credit.licence && `under ${credit.licence}`,
    ]
      .filter(Boolean)
      .join(", ");
  const blocks = catalogue.blocks
    .filter((block) => block.credits.length > 0)
    .map((block) =>
      [`### ${block.name}`, "", ...block.credits.map((credit) => `- ${describe(credit)}`), ""].join("\n"),
    );
  return [
    "# Credits for the audio engine's blocks",
    "",
    `Generated by engine/compile.ts from the Faust ${catalogue.faust} libraries the blocks use; edit the`,
    "blocks, not this file. The blocks are compiled from the Faust libraries",
    "(https://github.com/grame-cncm/faustlibraries), whose authors are credited here.",
    "",
    "## Licences used",
    "",
    ...[...new Set(catalogue.blocks.flatMap((block) => block.licences))]
      .sort()
      .map((licence) => `- ${licence}: ${ALLOWED_LICENCES[licence]}`),
    "",
    "## By block",
    "",
    ...blocks,
    "## Licence texts",
    "",
    "As the Faust libraries give them:",
    "",
    "```text",
    licenceTexts.trim(),
    "```",
    "",
  ].join("\n");
};

/**
 * The licence texts, from the pinned Faust's own libraries: the STK and LGPL texts at the end of
 * filters.lib, and from maths.lib (which every block uses) the Faust exception to the LGPL, which is
 * what lets code generated from these libraries carry the engine's own licence.
 */
export const licenceTextsFrom = (filtersLib: string, mathsLib: string) => {
  const start = filtersLib.indexOf("# Licenses");
  const end = filtersLib.indexOf("****/", start);
  const exception = /EXCEPTION TO THE LGPL LICENSE :[\s\S]*?decide so\./.exec(mathsLib)?.[0];
  if (start < 0 || end < 0 || !exception) {
    throw new CatalogueError(["filters.lib or maths.lib no longer has its licence text where catalogue.ts looks"]);
  }
  const texts = filtersLib
    .slice(start, end)
    .replace(/^# Licenses\s*/, "")
    .replace(/\*+$/, "")
    .trim();
  return `${texts}\n\n--------------------------------------------------------------------------------\n\n## The Faust exception to the LGPL\n\n${exception}`;
};
