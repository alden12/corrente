/**
 * How far a device's samples have downloaded (INST-55), in its header: a sampled instrument is silent
 * until its recordings are in, and folded, its Sample picker's progress is out of sight. Any device
 * whose sample params name a factory sound shows it, summed across them; nothing once they're in.
 */
import { useCallback, useSyncExternalStore } from "react";
import type { ParamStore } from "../../audio/params/store";
import type { ParamSchema } from "../../audio/params/types";
import { factoryLoading } from "../../audio/samples/factoryFiles";
import { parseRef } from "../../audio/samples/catalog";

export function DeviceDownload({
  schema,
  store,
  column,
}: {
  schema: ParamSchema;
  store: ParamStore;
  /** Folded on the desktop, the header is a column: the percentage alone, without the bar. */
  column: boolean;
}) {
  const loading = useSyncExternalStore(factoryLoading.subscribe, factoryLoading.read);
  // The factory sounds its sample params name, joined, so the snapshot is a string that only changes with them.
  const sounds = useSyncExternalStore(
    useCallback((onChange: () => void) => store.subscribe(onChange), [store]),
    () =>
      schema
        .filter((spec) => spec.kind === "sample")
        .map((spec) => parseRef(String(store.get(spec.id))))
        .flatMap((ref) => (ref.kind === "factory" ? [ref.id] : []))
        .join("\n"),
  );
  const downloads = sounds
    .split("\n")
    .flatMap((sound) => (loading[sound] ? [loading[sound]] : []))
    .reduce((sum, download) => ({ loaded: sum.loaded + download.loaded, total: sum.total + download.total }), {
      loaded: 0,
      total: 0,
    });
  if (downloads.total === 0) return null;
  const percent = Math.round((100 * downloads.loaded) / downloads.total);
  const megabytes = (bytes: number) => (bytes / 1e6).toFixed(1);
  return (
    <span
      role="progressbar"
      aria-label="Downloading samples"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      title={`Downloading samples: ${megabytes(downloads.loaded)} of ${megabytes(downloads.total)} MB`}
      className={`flex items-center gap-1.5 shrink-0 font-mono text-[10px] tabular-nums text-muted ${column ? "flex-col" : ""}`}
    >
      {!column && (
        <span aria-hidden="true" className="relative w-12 h-1 rounded-full bg-line overflow-hidden">
          <span className="absolute inset-y-0 left-0 rounded-full bg-you" style={{ width: `${percent}%` }} />
        </span>
      )}
      {`${percent}%`}
    </span>
  );
}
