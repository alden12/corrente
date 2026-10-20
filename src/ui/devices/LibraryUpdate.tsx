/**
 * "Update" on a custom device whose library version differs from the project's copy (COMM-1.11.1):
 * the device was changed in another project, and this one still plays the version it has, so a
 * finished song keeps its sound until someone chooses otherwise. One edit, undoable; values carry
 * over for every param the new version still has, and the title says which settings won't.
 */
import { useSyncExternalStore } from "react";
import type { Dispatch } from "../../audio/commands/types";
import { sameDevice, type CustomKind } from "../../audio/definitions/custom";
import { libraryDevice, settingsReset } from "../../audio/library/devices";
import { subscribeLibrary } from "../../audio/library/store";
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
  const latest = useSyncExternalStore(subscribeLibrary, () => libraryDevice(type));
  const here = (kind === "instrument" ? projectStore.customInstruments : projectStore.customEffects).find(
    (device) => device.type === type,
  );
  if (!latest || !here || sameDevice(latest, here)) return null;
  const reset = settingsReset(here, latest);
  const title =
    "A newer version is in your library" +
    (reset.length ? `. Updating resets ${reset.join(", ")}.` : ", and every setting carries over.");
  return (
    <button
      type="button"
      title={title}
      onClick={() => dispatch({ type: UPDATE[kind], def: latest })}
      className="font-mono text-[10px] h-5 px-1.5 rounded border border-line text-ink cursor-pointer"
    >
      Update
    </button>
  );
}
