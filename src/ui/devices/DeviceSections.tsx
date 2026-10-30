/**
 * A device's controls as sections (DAW-61.3), for every kind of device: its params grouped by id
 * namespace (`paramSections.ts`), side by side with a hairline between them, wrapping when there is
 * no room; a section wider than its device wraps its controls too. With more than one, each folds to
 * a narrow column, its title running down it, and starts folded. One alone is the whole device, so it has no title to
 * fold, and nor does one named for the device (a Delay's `delay.` params), which would only repeat
 * its name.
 *
 * Within a section the switches and choices stack in a column on the left, so a device with several
 * (the Arpeggiator's rate and pattern) reads as a tidy list rather than a wide row. Schema-driven: it
 * maps over the specs and hands each to the generic Knob, branching only on kind, never on names.
 */
import type { ParamSchema, ParamSpec, ParamValue } from "../../audio/params/types";
import type { ParamStore } from "../../audio/params/store";
import { Knob, type SampleContext } from "../Knob";
import { toSections } from "../paramSections";
import { sectionFold, sectionHeading, useOpenSections } from "./deviceFolds";
import { paramCount } from "./paramCount";

const stacks = (spec: ParamSpec) => spec.kind === "boolean" || spec.kind === "enum";

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

  return (
    // Sections sit side by side with a hairline between them, and wrap with room beneath, rather
    // than each in a box of its own.
    <div className="flex flex-wrap items-start gap-y-3 px-1 py-2.5">
      {sections.map((section, index) => {
        const title = sectionHeading(label, sections.length, section.namespace);
        const key = sectionFold(foldKey, section.namespace);
        const open = !title || opened.has(key);
        const stacked = section.specs.filter(stacks);
        const rest = section.specs.filter((spec) => !stacks(spec));
        return (
          <div
            key={section.namespace}
            role="group"
            aria-label={title || undefined}
            className={`flex flex-col gap-1.5 min-w-0 max-w-full px-2.5 ${index > 0 ? "border-l border-line/60" : ""}`}
          >
            {title && (
              // Folded, the section is a narrow column, its title running down it: a folded section
              // that kept its title across would take nearly the room it had open.
              <button
                type="button"
                aria-expanded={open}
                onClick={() => toggleFold(key)}
                title={open ? undefined : paramCount(section.specs.length)}
                className={`flex items-center gap-1 shrink-0 text-left cursor-pointer text-faint hover:text-ink ${
                  open ? "h-6" : "flex-col py-1"
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
                  style={open ? undefined : { writingMode: "vertical-rl" }}
                >
                  {title}
                </span>
              </button>
            )}
            {open && (
              // Wider than the device, a section wraps its own controls rather than overflowing.
              <div className="flex flex-wrap items-end gap-2.5 px-1 pb-1">
                {stacked.length > 0 && <div className="flex flex-col justify-center gap-2">{stacked.map(control)}</div>}
                {rest.map(control)}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
