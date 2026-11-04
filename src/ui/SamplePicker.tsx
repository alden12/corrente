/**
 * The control for a `sample` param: choose a built-in or a project-library sample,
 * or import a file. Used by the generic Knob for `kind: "sample"` specs. Kept as
 * its own component because, unlike the other param controls, it needs the
 * project's sample library and an import action threaded in from the panel.
 */
import { useRef, useSyncExternalStore } from "react";
import type { ParamSpec } from "../audio/params/types";
import {
  BUILTIN_KITS,
  BUILTIN_WAVETABLES,
  builtinRef,
  parseRef,
  wavetableRef,
  type SampleAsset,
} from "../audio/samples/catalog";
import { Select } from "./controls/Select";
import { FACTORY_SETS, FACTORY_SOUNDS } from "../audio/samples/factory";
import { factoryLoading } from "../audio/samples/factoryFiles";

export function SamplePicker({
  spec,
  value,
  onChange,
  assets,
  onImportFile,
  onReveal,
  hideLabel,
}: {
  spec: ParamSpec;
  value: string;
  onChange: (id: string, value: string) => void;
  assets: SampleAsset[];
  /** Import a local file into the library; resolves to its ref (or null on failure). */
  onImportFile?: (file: File) => Promise<string | null>;
  /** Jump to the Samples library view - offered when the picker is empty. */
  onReveal?: () => void;
  /** Drop the stacked label + fill the available width (the compact drum-pad layout). */
  hideLabel?: boolean;
}) {
  const fileInput = useRef<HTMLInputElement | null>(null);
  // A sampled instrument downloads the first time it's used (INST-55): how far it has got.
  const loading = useSyncExternalStore(factoryLoading.subscribe, factoryLoading.read);
  const parsed = parseRef(value);
  const downloading = parsed.kind === "factory" ? loading[parsed.id] : undefined;

  const onPick = async (file: File) => {
    const ref = await onImportFile?.(file);
    if (ref) onChange(spec.id, ref);
  };

  return (
    <label className={hideLabel ? "flex items-center gap-1 w-full" : "flex flex-col items-center gap-1.5 w-24"}>
      {!hideLabel && <span className="text-[9px] uppercase tracking-wide text-muted">{spec.label}</span>}
      <div className="flex items-center gap-1 w-full">
        <Select
          value={value}
          onChange={(e) => onChange(spec.id, e.target.value)}
          aria-label={spec.label}
          className="flex-1 min-w-0 font-mono"
        >
          <option value="">None</option>
          {spec.kind === "sample" && spec.wavetable && (
            <optgroup label="Wavetables">
              {BUILTIN_WAVETABLES.map((table) => (
                <option key={table.id} value={wavetableRef(table.id)}>
                  {table.name}
                </option>
              ))}
            </optgroup>
          )}
          {/* A group per kit and per sampled set, so the list reads as kits rather than one long run. */}
          {BUILTIN_KITS.map((kit) => (
            <optgroup key={kit.id} label={`${kit.name} kit`}>
              {kit.samples.map((sample) => (
                <option key={sample.id} value={builtinRef(sample.id)}>
                  {sample.name}
                </option>
              ))}
            </optgroup>
          ))}
          {!(spec.kind === "sample" && spec.wavetable) &&
            // Downloaded the first time they're used, so each says how big it is.
            FACTORY_SETS.map((set) => (
              <optgroup key={set.id} label={set.name}>
                {FACTORY_SOUNDS.filter((sound) => sound.set === set.name).map((sound) => (
                  <option key={sound.ref} value={sound.ref}>
                    {`${sound.name} (${sound.downloadMB} MB)`}
                  </option>
                ))}
              </optgroup>
            ))}
          {assets.length > 0 && (
            <optgroup label="Imported">
              {assets.map((asset) => (
                <option key={asset.id} value={`asset:${asset.id}`}>
                  {asset.name}
                </option>
              ))}
            </optgroup>
          )}
        </Select>
        {onReveal && value === "" && (
          <button
            type="button"
            title="Browse samples in the library"
            aria-label="Browse samples in the library"
            onClick={onReveal}
            className="shrink-0 w-6 h-6 inline-flex items-center justify-center rounded-md border border-line text-muted hover:text-ink hover:border-you/55 cursor-pointer"
          >
            ⌕
          </button>
        )}
        {onImportFile && (
          <>
            <button
              type="button"
              title="Import a sample file"
              aria-label="Import a sample file"
              onClick={() => fileInput.current?.click()}
              className="shrink-0 w-6 h-6 inline-flex items-center justify-center rounded-md border border-line text-muted hover:text-ink hover:border-hot/55 cursor-pointer"
            >
              +
            </button>
            <input
              ref={fileInput}
              type="file"
              accept="audio/*"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void onPick(file);
                e.target.value = "";
              }}
            />
          </>
        )}
      </div>
      {downloading && (
        <span role="status" className="text-[10px] text-muted tabular-nums">
          {`Downloading ${(downloading.loaded / 1e6).toFixed(1)} of ${(downloading.total / 1e6).toFixed(1)} MB`}
        </span>
      )}
    </label>
  );
}
