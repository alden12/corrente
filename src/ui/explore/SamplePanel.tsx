/**
 * A sample tapped in Explore, pinned under it like the try panel: Play hears it once, and Add puts it
 * on an audio track. With an audio track selected it goes after that track's last clip; otherwise it
 * becomes a new audio track. A project sample's bytes are already in the audio store under its
 * content hash, which is what an audio clip points at, so nothing is copied.
 */
import { useEffect } from "react";
import type { Dispatch } from "../../audio/commands/types";
import type { ProjectStore } from "../../audio/project/projectStore";
import type { SoundPreview } from "../../audio/live/preview";
import { newClipId, newPlacementId, newTrackId } from "../../audio/commands/ids";
import { assetRef } from "../../audio/samples/catalog";
import { useProject } from "../../audio/project/useProject";
import { Button } from "../controls/Button";
import type { ExploreItem } from "./exploreItems";
import { PanelHeader, PlusIcon } from "./PanelParts";
import { ACTION, ACTION_LAYOUT, type PanelLayout } from "./panelStyles";
import { noteUsed } from "./recent/store";

function PlayIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" fill="currentColor" className="w-3.5 h-3.5 shrink-0">
      <path d="M4 2.5l9 5.5-9 5.5z" />
    </svg>
  );
}

export function SamplePanel({
  item,
  projectStore,
  dispatch,
  preview,
  onPicked,
  onClose,
  layout,
}: {
  item: ExploreItem;
  projectStore: ProjectStore;
  dispatch: Dispatch;
  /** Plays the sample once, and measures it to place it. */
  preview: SoundPreview;
  /** Wraps Add, so the host can get out of the way after it (see `LibraryPanel`). */
  onPicked: (act: () => void) => void;
  onClose: () => void;
  layout: PanelLayout;
}) {
  const project = useProject(projectStore);
  // Whatever it is playing stops with the panel.
  useEffect(() => preview.stopSample, [preview, item.key]);
  const source = item.source;
  const sample = source.kind === "sample" ? project.samples.find((each) => each.id === source.id) : undefined;
  if (!sample) return null;
  const ref = assetRef(sample.id);
  const audioTrack = project.tracks.find((track) => track.id === project.selectedTrackId && track.kind === "audio");

  const add = async () => {
    const durationSec = (await preview.sampleDuration(ref)) ?? undefined;
    const name = sample.name;
    onClose();
    onPicked(() => {
      if (audioTrack) {
        // After the track's last clip, so nothing already there is cut into.
        const startBeat = Math.max(0, ...audioTrack.placements.map((each) => each.startBeat + each.length));
        dispatch({
          type: "addAudioClip",
          trackId: audioTrack.id,
          id: newClipId(),
          placementId: newPlacementId(),
          fileId: sample.contentHash,
          name,
          durationSec,
          startBeat,
        });
      } else {
        dispatch({ type: "addAudioTrack", id: newTrackId(), fileId: sample.contentHash, name, durationSec });
      }
      noteUsed(item.key);
    });
  };
  const addLabel = !audioTrack
    ? "Add as audio track"
    : layout === "desktop"
      ? "Add to current track"
      : `Add to ${audioTrack.name}`;

  return (
    <section
      aria-label={item.name}
      className="@container shrink-0 border-t border-line bg-stage px-3 pt-2.5 pb-3 flex flex-col gap-2.5"
    >
      <PanelHeader item={item} name={item.name} closeLabel="Close" onClose={onClose} />
      <div className="grid grid-cols-[2fr_3fr] gap-2">
        <Button
          variant="quiet"
          onClick={() => void preview.playSample(ref)}
          aria-label={`Play ${item.name}`}
          className={`${ACTION} ${ACTION_LAYOUT[layout]}`}
        >
          <PlayIcon />
          <span className="min-w-0 leading-tight @[16rem]:whitespace-nowrap">Play</span>
        </Button>
        <Button
          variant="solid"
          onClick={() => void add()}
          aria-label={audioTrack ? `Add to ${audioTrack.name}` : "Add as a new audio track"}
          title={audioTrack ? `Add after the last clip on ${audioTrack.name}` : "Add as a new audio track"}
          className={`${ACTION} ${ACTION_LAYOUT[layout]}`}
        >
          <PlusIcon />
          <span className="min-w-0 leading-tight @[16rem]:whitespace-nowrap">{addLabel}</span>
        </Button>
      </div>
    </section>
  );
}
