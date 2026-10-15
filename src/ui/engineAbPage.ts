/**
 * The engine A/B as a page (INST-36.8): every built-in rendered on the old engine and the new, to
 * play one after the other and compare by number. Open `?ab=engine` in a dev build.
 *
 * Dev-only and plain DOM with inline styles, like the rebuild bench: it takes over the page before the
 * app mounts, so nothing else is playing, and it works on a phone, which is where the new engine has
 * to hold up.
 */
import { AB_CASES, renderNew, renderOld, type AbCase, type Measured } from "../audio/engine/engineAb";

const COLOURS = { ground: "#0a0c0e", text: "#e8e7e3", quiet: "#8b929c", rule: "#2a3038", warn: "#e0a458" };

const style = (element: HTMLElement, css: Partial<CSSStyleDeclaration>): HTMLElement => {
  Object.assign(element.style, css);
  return element;
};

const element = (tag: string, text = "", css: Partial<CSSStyleDeclaration> = {}): HTMLElement => {
  const made = document.createElement(tag);
  made.textContent = text;
  return style(made, css);
};

/** One output for the page, made on the first press: a browser won't start audio before one. */
let context: AudioContext | null = null;
let playing: AudioBufferSourceNode | null = null;

const play = (channels: Float32Array[]) => {
  context ??= new AudioContext();
  playing?.stop();
  const buffer = context.createBuffer(channels.length, channels[0].length, 48000);
  channels.forEach((channel, index) => buffer.copyToChannel(new Float32Array(channel), index));
  const source = context.createBufferSource();
  source.buffer = buffer;
  source.connect(context.destination);
  source.start();
  playing = source;
};

const button = (label: string, onPress: () => void) => {
  const made = element("button", label, {
    font: "inherit",
    padding: "6px 14px",
    marginRight: "8px",
    background: "#1b2027",
    color: COLOURS.text,
    border: `1px solid ${COLOURS.rule}`,
    borderRadius: "4px",
    cursor: "pointer",
  }) as HTMLButtonElement;
  made.addEventListener("click", onPress);
  return made;
};

const db = (value: number) => `${value.toFixed(1)} dB`;

/** The biggest gap between the two in any octave band that either has much in. */
const largestBandGap = (old: Measured, converted: Measured) =>
  old.spectrum.bands.reduce(
    (largest, band, index) => {
      const other = converted.spectrum.bands[index];
      if (Math.max(band.db, other.db) < -60) return largest;
      const gap = other.db - band.db;
      return Math.abs(gap) > Math.abs(largest.gap) ? { hz: band.hz, gap } : largest;
    },
    { hz: 0, gap: 0 },
  );

const numbers = (old: Measured, converted: Measured) => {
  const gap = largestBandGap(old, converted);
  const rows: [string, string, string][] = [
    ["peak", db(old.peakDbfs), db(converted.peakDbfs)],
    ["RMS", db(old.rmsDbfs), db(converted.rmsDbfs)],
    ["centroid", `${Math.round(old.spectrum.centroidHz)} Hz`, `${Math.round(converted.spectrum.centroidHz)} Hz`],
  ];
  const table = element("table", "", {
    borderCollapse: "collapse",
    fontVariantNumeric: "tabular-nums",
    margin: "8px 0",
  });
  table.append(
    ...[["", "old", "new"], ...rows].map((row, index) => {
      const tr = document.createElement("tr");
      tr.append(
        ...row.map((value) =>
          element(index === 0 ? "th" : "td", value, {
            padding: "2px 12px 2px 0",
            textAlign: "right",
            color: index === 0 ? COLOURS.quiet : COLOURS.text,
          }),
        ),
      );
      return tr;
    }),
  );
  const bands = element(
    "p",
    gap.hz === 0
      ? "octaves: within a dB everywhere"
      : `octaves: largest gap ${gap.gap > 0 ? "+" : ""}${gap.gap.toFixed(1)} dB at ${gap.hz} Hz`,
    { margin: "0", color: Math.abs(gap.gap) > 3 ? COLOURS.warn : COLOURS.quiet },
  );
  return [table, bands];
};

/** A device's row: render both, then its buttons and numbers. */
const section = async (abCase: AbCase): Promise<HTMLElement> => {
  const block = element("section", "", { borderTop: `1px solid ${COLOURS.rule}`, padding: "12px 0" });
  block.append(
    element("h2", `${abCase.type} ${abCase.effect ? "(effect)" : ""}`, {
      font: "600 15px/1.3 system-ui, sans-serif",
      margin: "0 0 6px",
    }),
  );
  if ("problem" in abCase.converted) {
    block.append(element("p", `not converted: ${abCase.converted.problem}`, { color: COLOURS.warn, margin: "0" }));
    return block;
  }
  try {
    const [old, converted] = [await renderOld(abCase), await renderNew(abCase)];
    block.append(
      button("Old", () => play(old.channels)),
      button("New", () => play(converted.channels)),
      ...numbers(old, converted),
      ...abCase.converted.notes.map((note) =>
        element("p", `note: ${note}`, { color: COLOURS.warn, margin: "4px 0 0" }),
      ),
    );
  } catch (error) {
    block.append(
      element("p", `couldn't render: ${error instanceof Error ? error.message : String(error)}`, {
        color: COLOURS.warn,
      }),
    );
  }
  return block;
};

export async function renderEngineAb(): Promise<void> {
  document.body.innerHTML = "";
  style(document.body, {
    background: COLOURS.ground,
    color: COLOURS.text,
    font: "14px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace",
    padding: "16px",
    margin: "0",
  });
  const status = element("p", "", { color: COLOURS.quiet });
  document.body.append(
    element("h1", "Old engine and new, side by side", {
      font: "600 18px/1.3 system-ui, sans-serif",
      margin: "0 0 4px",
    }),
    element(
      "p",
      "Each built-in converted to the new engine. Instruments play A3 for a second; effects get a second of a 220 Hz tone. Levels are RMS dBFS; octave gaps over 3 dB are marked.",
      { color: COLOURS.quiet, margin: "0 0 12px", maxWidth: "65ch" },
    ),
    status,
  );
  for (const abCase of AB_CASES) {
    status.textContent = `rendering ${abCase.type}…`;
    await null; // let the last section paint before the next render holds the thread
    document.body.insertBefore(await section(abCase), status);
  }
  status.textContent = "done";
}
