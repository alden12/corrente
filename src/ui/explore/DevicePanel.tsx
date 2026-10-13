/**
 * An effect or MIDI device tapped in Explore, pinned under it like the try panel: its artwork and
 * name, and one way into the project, Add to the selected track. Showing it first says what is about
 * to happen, and is where hearing a device before adding it will go (COMM-1.4.2: through the selected
 * track's sound, or a sample). The row's "+" is the one-click way in.
 */
import type { Dispatch } from "../../audio/commands/types";
import type { ProjectStore } from "../../audio/project/projectStore";
import { useProject } from "../../audio/project/useProject";
import { Button } from "../controls/Button";
import type { ExploreItem } from "./exploreItems";
import { PanelHeader, PlusIcon } from "./PanelParts";
import { ACTION, ACTION_LAYOUT, type PanelLayout } from "./panelStyles";
import { useLibraryActions } from "./useLibraryActions";
import { noteUsed } from "./recent/store";

export function DevicePanel({
  item,
  projectStore,
  dispatch,
  onPicked,
  onClose,
  layout,
}: {
  item: ExploreItem;
  projectStore: ProjectStore;
  dispatch: Dispatch;
  /** Wraps Add, so the host can get out of the way after it (see `LibraryPanel`). */
  onPicked: (act: () => void) => void;
  onClose: () => void;
  layout: PanelLayout;
}) {
  const project = useProject(projectStore);
  const actions = useLibraryActions(projectStore, dispatch);
  const source = item.source;
  if (source.kind !== "effect" && source.kind !== "midi") return null;
  // A MIDI device shapes notes, so it needs an instrument track; an effect goes on any track.
  const selected = project.tracks.find(
    (track) => track.id === project.selectedTrackId && (source.kind === "effect" || track.kind === "instrument"),
  );
  const add = () => {
    onClose();
    onPicked(() => {
      if (source.kind === "effect") actions.addEffect(source.type);
      else actions.addMidiDevice(source.type);
      noteUsed(item.key);
    });
  };
  const needs = source.kind === "effect" ? "a track" : "an instrument track";

  return (
    <section
      aria-label={item.name}
      className="@container shrink-0 border-t border-line bg-stage px-3 pt-2.5 pb-3 flex flex-col gap-2.5"
    >
      <PanelHeader item={item} name={item.name} closeLabel="Close" onClose={onClose} />
      <Button
        variant="solid"
        onClick={add}
        disabled={!selected}
        aria-label={selected ? `Add to ${selected.name}` : `Add to ${needs}`}
        title={selected ? `Add ${item.name} to ${selected.name}` : `Select ${needs} to add it to`}
        // One button with the panel's whole width, so the icon always fits beside its label.
        className={`${ACTION} ${ACTION_LAYOUT.phone} ${layout === "desktop" ? "text-[11.5px]!" : ""}`}
      >
        <PlusIcon />
        {/* A phone names the track, since the Studio is out of sight there; on desktop the
            arrangement beside the panel shows it. */}
        <span className="min-w-0 leading-tight">
          {!selected
            ? `Select ${needs} first`
            : layout === "desktop"
              ? "Add to current track"
              : `Add to ${selected.name}`}
        </span>
      </Button>
    </section>
  );
}
