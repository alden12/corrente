/**
 * The 16 macros in the plugin's Macros section (PLUGIN-3.4, PLUGIN-3.12): what each of the host's knobs moves.
 * A knob's right-click menu maps one; clicking a mapped macro here unmaps it.
 */
import type { MacroView } from "./useMacros";

export function MacroStrip({ view }: { view: MacroView }) {
  return (
    <div className="grid grid-cols-8 gap-1 p-3">
      {view.mapping.map((name, index) => {
        const label = `M${index + 1}`;
        return name ? (
          <button
            key={index}
            type="button"
            onClick={() => view.unmap(name)}
            title={`Macro ${index + 1}: ${view.titleOf(name)}. Click to unmap`}
            className="flex items-baseline gap-1 min-w-0 h-7 px-1.5 rounded-md bg-you/10 text-left cursor-pointer hover:bg-you/20"
          >
            <span className="font-mono text-[9.5px] text-you">{label}</span>
            <span className="truncate text-[10.5px] text-ink">{view.labelOf(name)}</span>
          </button>
        ) : (
          <span
            key={index}
            title={`Macro ${index + 1}: not mapped. Right-click a knob to map it`}
            className="flex items-baseline gap-1 h-7 px-1.5 rounded-md border border-dashed border-line"
          >
            <span className="font-mono text-[9.5px] text-faint">{label}</span>
          </span>
        );
      })}
    </div>
  );
}
