/**
 * A device's controls as sections (DAW-61.3), for every kind of device: its params grouped by id
 * namespace (`paramSections.ts`), side by side with a hairline between them, wrapping when there is
 * no room. On the desktop each section is the device's height (`SECTION_HEIGHT`), so open devices
 * line up with folded ones: knobs fill a column top to bottom and go on in the next, and sliders run
 * the whole height. With more than one, each folds to
 * a narrow column, its title running down it, and starts folded. One alone is the whole device, so
 * it has no title to fold, and nor does one named for the device (a Delay's `delay.` params), which
 * would only repeat its name. Stacked on a phone (`RackStacked`), sections are rows one under another,
 * their titles across, so everything flows down the screen.
 *
 * Within a section the switches and choices stack in a column of their own on the left, so a device with several
 * (the Arpeggiator's rate and pattern) reads as a tidy list rather than a wide row. Schema-driven: it
 * maps over the specs and hands each to the generic Knob, branching only on kind, never on names.
 */
import type { ReactNode } from "react";
import type { ParamSchema, ParamSpec, ParamValue } from "../../audio/params/types";
import type { ParamStore } from "../../audio/params/store";
import { Knob, type SampleContext } from "../Knob";
import { toSections } from "../paramSections";
import { useContext } from "react";
import { sectionFold, sectionHeading, useOpenSections } from "./deviceFolds";
import { RackStacked, SECTION_HEIGHT } from "./rackLayout";
import { paramCount } from "./paramCount";

const stacks = (spec: ParamSpec) => spec.kind === "boolean" || spec.kind === "enum";

/** The room a row of a knob or a switch takes, so a column holds as many as its height has room for. */
const ROW_HEIGHTS = { knob: 78, switch: 46 } as const;
const ROW_GAP = 6;
/** What a section's controls don't get of its height: its padding (`py-2`), and its title and the gap under it. */
const SECTION_PADDING = 16;
const TITLE_ROOM = 30;

/**
 * Controls down a column, then on into the next when it's full, as many to a column as the section's
 * height holds. Split here rather than left to a wrapping column flexbox or a grid flowing by
 * column, which browsers size as if all their controls were in one row, leaving a gap beside them.
 */
function Columns({ row, height, children }: { row: keyof typeof ROW_HEIGHTS; height: number; children: ReactNode[] }) {
  const perColumn = Math.max(1, Math.floor((height + ROW_GAP) / (ROW_HEIGHTS[row] + ROW_GAP)));
  const columns = Array.from({ length: Math.ceil(children.length / perColumn) }, (_unused, index) =>
    children.slice(index * perColumn, (index + 1) * perColumn),
  );
  return columns.map((column, index) => (
    <div key={index} className="flex flex-col justify-center gap-1.5">
      {column}
    </div>
  ));
}

export function DeviceSections({
  label,
  schema,
  store,
  onChange,
  authorOf,
  foldKey,
  variant,
  sampleContext,
}: {
  /** The device's name, which a section's title shouldn't repeat. */
  label: string;
  schema: ParamSchema;
  store: ParamStore;
  onChange: (id: string, value: ParamValue) => void;
  authorOf: (paramId: string) => string | undefined;
  /** The device's fold key, which its sections' keys extend. */
  foldKey: string;
  /** How number params draw (Knob's `variant`): an instrument's are faders. */
  variant?: "knob" | "slider";
  sampleContext?: SampleContext;
}) {
  const [opened, toggleFold] = useOpenSections();
  // Stacked on a phone, sections are rows down the device, their titles across.
  const rows = useContext(RackStacked);
  const sections = toSections(schema);
  const control = (spec: ParamSpec) => (
    <Knob
      key={spec.id}
      spec={spec}
      store={store}
      variant={variant}
      onChange={onChange}
      sampleContext={sampleContext}
      author={authorOf(spec.id)}
    />
  );

  const laidOut = (
    // Sections sit side by side with a hairline between them, and wrap, rather than each in a box of
    // its own; stacked, one under another. Side by side, each draws a rule on its left and top, and the
    // device's edge hides those along it (`-ml-px -mt-px` under `overflow-hidden`), so a row that wraps
    // starts flush with the one above and a rule runs between them.
    <div className={rows ? "flex flex-col py-1" : "flex flex-wrap items-start -ml-px -mt-px"}>
      {sections.map((section, index) => {
        const title = sectionHeading(label, sections.length, section.namespace);
        const key = sectionFold(foldKey, section.namespace);
        const open = !title || opened.has(key);
        const stacked = section.specs.filter(stacks);
        const height = SECTION_HEIGHT - SECTION_PADDING - (title ? TITLE_ROOM : 0);
        const rest = section.specs.filter((spec) => !stacks(spec));
        return (
          <div
            key={section.namespace}
            role="group"
            aria-label={title || undefined}
            className={`flex flex-col gap-1.5 min-w-0 max-w-full ${
              rows
                ? `px-3 py-1 ${index > 0 ? "border-t border-line/60" : ""}`
                : "px-3.5 py-2 border-l border-t border-line/60"
            }`}
            // Its top rule is hidden on the first row, so it takes a pixel more to keep the device's height.
            style={rows ? undefined : { height: SECTION_HEIGHT + 1 }}
          >
            {title && (
              // Folded, the section is a narrow column, its title running down it: a folded section
              // that kept its title across would take nearly the room it had open. Stacked, a row.
              <button
                type="button"
                aria-expanded={open}
                onClick={() => toggleFold(key)}
                title={open ? undefined : paramCount(section.specs.length)}
                className={`flex items-center gap-1 shrink-0 text-left cursor-pointer text-faint hover:text-ink ${
                  rows ? "w-full h-9" : open ? "h-6" : "flex-col py-1"
                }`}
              >
                <span
                  aria-hidden="true"
                  className={`flex items-center justify-center w-4 pointer-coarse:w-6 text-[14px] pointer-coarse:text-[19px] leading-none ${open ? "rotate-90" : ""}`}
                >
                  ▸
                </span>
                <span
                  className="font-mono text-[9px] tracking-[0.16em] uppercase whitespace-nowrap"
                  style={open || rows ? undefined : { writingMode: "vertical-rl" }}
                >
                  {title}
                </span>
              </button>
            )}
            {open &&
              (rows ? (
                // Wider than the device, a section wraps its own controls rather than overflowing.
                <div className="flex flex-wrap items-end gap-2.5 px-1 pb-1">
                  {stacked.length > 0 && (
                    <div className="flex flex-col justify-center gap-2">{stacked.map(control)}</div>
                  )}
                  {rest.map(control)}
                </div>
              ) : (
                // The section's height, filled: sliders stretch down it, knobs wrap into columns.
                <div className="flex-1 min-h-0 flex items-stretch gap-2.5 px-1">
                  <Columns row="switch" height={height}>
                    {stacked.map(control)}
                  </Columns>
                  {variant === "slider" ? (
                    rest.map(control)
                  ) : (
                    <Columns row="knob" height={height}>
                      {rest.map(control)}
                    </Columns>
                  )}
                </div>
              ))}
          </div>
        );
      })}
    </div>
  );
  return rows ? laidOut : <div className="overflow-hidden">{laidOut}</div>;
}
