/**
 * "Update" on a custom device the library has a newer version of (COMM-1.11, `offeredUpdate`): the
 * device was changed in another project, and this one still plays the version it has, so a finished
 * song keeps its sound until someone chooses otherwise. One edit, undoable; values carry over for
 * every param the new version still has, and the title says which settings won't.
 */
import { useSyncExternalStore } from "react";
import type { Dispatch } from "../../audio/commands/types";
import type { CustomKind } from "../../audio/definitions/custom";
import { deviceRefOf, offeredUpdate, settingsReset } from "../../audio/library/devices";
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
  const ref = projectStore.deviceRef(type);
  const latest = offeredUpdate(kept, here, ref);
  if (!kept || !here || !latest) return null;
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
