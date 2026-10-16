/**
 * A device's controls as sections (DAW-61.3), for every kind of device: its params grouped by id
 * namespace (`paramSections.ts`), each section a box that sits beside the others and wraps when
 * there is no room. With more than one, each folds to its title and a line of its values; one alone
 * is the whole device, so it has no title to fold, and nor does one named for the device (a Delay's
 * `delay.` params), which would only repeat its name.
 *
 * Within a section the switches and choices stack in a column on the left, so a device with several
 * (the Arpeggiator's rate and pattern) reads as a tidy list rather than a wide row. Schema-driven: it
 * maps over the specs and hands each to the generic Knob, branching only on kind, never on names.
 */
import type { ParamSchema, ParamSpec, ParamValue } from "../../audio/params/types";
import type { ParamStore } from "../../audio/params/store";
import { Knob, type SampleContext } from "../Knob";
import { toSections, sectionTitle } from "../paramSections";
import { DeviceSummary } from "./DeviceSummary";
import { sectionFold, useDeviceFolds } from "./deviceFolds";

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
  const [folded, toggleFold] = useDeviceFolds();
  const sections = toSections(schema);
  const titled = sections.length > 1;
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
    <div className="flex flex-wrap items-start gap-2 p-2.5">
      {sections.map((section) => {
        const named = sectionTitle(section.namespace);
        const title = titled && named.toLowerCase() !== label.toLowerCase() ? named : "";
        const key = sectionFold(foldKey, section.namespace);
        const open = !title || !folded.has(key);
        const stacked = section.specs.filter(stacks);
        const rest = section.specs.filter((spec) => !stacks(spec));
        return (
          <div
            key={section.namespace}
            role="group"
            aria-label={title || undefined}
            // One section alone is the whole device: no box inside the device's own.
            className={`flex flex-col gap-1.5 min-w-0 ${titled ? "rounded-lg border border-line/60 px-2 py-1.5" : ""}`}
          >
            {title && (
              <div className="flex items-center gap-1 min-w-0">
                <button
                  type="button"
                  aria-expanded={open}
                  onClick={() => toggleFold(key)}
                  className="flex items-center gap-1 h-6 shrink-0 text-left cursor-pointer text-faint hover:text-ink"
                >
                  <span
                    aria-hidden="true"
                    className={`flex items-center justify-center w-4 text-[14px] leading-none ${open ? "rotate-90" : ""}`}
                  >
                    ▸
                  </span>
                  <span className="font-mono text-[9px] tracking-[0.16em] uppercase">{title}</span>
                </button>
                {!open && <DeviceSummary schema={section.specs} store={store} />}
              </div>
            )}
            {open && (
              <div className="flex items-end gap-2.5 px-1 pb-1">
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
