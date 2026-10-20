/**
 * "Update" on a custom device whose library version isn't the project's copy (COMM-1.11): the device
 * was changed in another project, and this one still plays the version it has, so a finished song
 * keeps its sound until someone chooses otherwise. Matched by hash where the project knows which
 * version it has (COMM-1.11.2), by content where it doesn't. One edit, undoable; values carry over
 * for every param the new version still has, and the title says which settings won't.
 */
import { useSyncExternalStore } from "react";
import type { Dispatch } from "../../audio/commands/types";
import { sameDevice, type CustomDevice, type CustomKind } from "../../audio/definitions/custom";
import { deviceRefOf, settingsReset } from "../../audio/library/devices";
import { libraryEntry, subscribeLibrary } from "../../audio/library/store";
import type { ProjectStore } from "../../audio/project/projectStore";

const UPDATE = { instrument: "updateCustomInstrument", effect: "updateCustomEffect" } as const;

export function LibraryUpdate({
  type,
  kind,
  projectStore,
  dispatch,
}: {
  type: string;
  kind: CustomKind;
  projectStore: ProjectStore;
  dispatch: Dispatch;
}) {
  const kept = useSyncExternalStore(subscribeLibrary, () => libraryEntry(type));
  const here = (kind === "instrument" ? projectStore.customInstruments : projectStore.customEffects).find(
    (device) => device.type === type,
  );
  if (!kept || kept.item.hiddenAt !== undefined || !here) return null;
  const latest = kept.current.document as CustomDevice;
  const ref = projectStore.deviceRef(type);
  if (ref ? ref.hash === kept.current.hash : sameDevice(latest, here)) return null;
  const reset = settingsReset(here, latest);
  const title =
    `Version ${kept.current.version} is in your library` +
    (ref ? `, and this project has version ${ref.version}` : "") +
    (reset.length ? `. Updating resets ${reset.join(", ")}.` : ". Every setting carries over.");
  return (
    <button
      type="button"
      title={title}
      onClick={() => dispatch({ type: UPDATE[kind], def: latest, library: deviceRefOf(kept) })}
      className="font-mono text-[10px] h-5 px-1.5 rounded border border-line text-ink cursor-pointer"
    >
      Update
    </button>
  );
}
