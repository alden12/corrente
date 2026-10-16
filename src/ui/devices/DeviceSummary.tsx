/**
 * The line a folded device shows in place of its controls (DAW-61.3): its first few values, live,
 * so a closed device still says what it is doing. Values only, to stay short; hovering names them.
 */
import type { ParamSchema, ParamSpec } from "../../audio/params/types";
import type { ParamStore } from "../../audio/params/store";
import { useParam } from "../../audio/params/useParam";
import { formatParam } from "../paramFormat";

/** How many values the line shows. */
const SHOWN = 3;

function Value({ spec, store }: { spec: ParamSpec; store: ParamStore }) {
  const [value] = useParam(store, spec.id);
  return <span title={spec.label}>{formatParam(spec, value)}</span>;
}

export function DeviceSummary({ schema, store }: { schema: ParamSchema; store: ParamStore }) {
  // A sample's name is long and says little out of context; the rest read as values.
  const shown = schema.filter((spec) => spec.kind !== "sample").slice(0, SHOWN);
  return (
    <span className="min-w-0 truncate font-mono text-[10.5px] text-muted">
      {shown.map((spec, index) => (
        <span key={spec.id}>
          {index > 0 && " · "}
          <Value spec={spec} store={store} />
        </span>
      ))}
    </span>
  );
}
