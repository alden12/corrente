/**
 * The sound being tried, pinned under Explore in the plugin's one-track window (COMM-1.4.1,
 * `ExploreScope`): its name and Replace, the one way it reaches the track. The app tries things on
 * your preview track instead (COMM-1.4.5), in the desktop's Preview tab or a phone's preview sheet.
 *
 * Read-only on purpose: the plugin's window is the track's rack already. Playing it needs nothing
 * here: while it is open, live notes go to it (`LiveNotes`).
 */
import { useSyncExternalStore } from "react";
import type { Dispatch } from "../../audio/commands/types";
import type { ProjectStore } from "../../audio/project/projectStore";
import type { SoundPreview } from "../../audio/live/preview";
import type { Recorder } from "../../audio/recording/recorder";
import { newTrackId } from "../../audio/commands/ids";
import { soundChains } from "../../audio/patches/sound";
import { useProject } from "../../audio/project/useProject";
import { Button } from "../controls/Button";
import { useRecorder } from "../useRecorder";
import { useExploreScope } from "./exploreScope";
import { PanelHeader, PlusIcon, SwapIcon } from "./PanelParts";
import { ACTION, ACTION_LAYOUT } from "./panelStyles";
import { exploreItems } from "./exploreItems";
import { useSavedPatches } from "./useSavedPatches";

/**
 * What mode the panel is in, as one chip by the name. LIVE: your playing goes
 * to this sound, which is not in the project. On desktop it carries a keyboard, because the computer
 * keys now play this sound and not the selected track, which is the surprise to head off (a phone's
 * pads sit right below). REC: a take is on its way in, and only that pulses, where motion is allowed.
 */
function ModeChip({ recording, keyboard, name }: { recording: boolean; keyboard: boolean; name: string }) {
  return (
    <span
      title={
        recording
          ? "Recording onto a new track"
          : keyboard
            ? `Your keyboard plays ${name}, not the selected track`
            : undefined
      }
      // Desktop's LIVE is in the record colour: the computer keys are live on this sound, and that is
      // the thing to notice. A phone's pads sit right below it, so there it stays in the accent. Only a
      // take in progress pulses.
      className={`inline-flex items-center gap-1 whitespace-nowrap px-1.5 py-px rounded border font-mono text-[10.5px] leading-normal font-semibold tracking-wider ${
        recording || keyboard ? "border-hot/50 bg-hot/15 text-hot" : "border-you/40 bg-you/10 text-you"
      } ${recording ? "motion-safe:animate-pulse" : ""}`}
    >
      {recording ? (
        <span aria-hidden="true" className="w-2 h-2 rounded-full bg-hot" />
      ) : (
        keyboard && (
          <svg
            viewBox="0 0 18 18"
            aria-hidden="true"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            className="w-3.5 h-3.5"
          >
            <rect x="1.5" y="4" width="15" height="10" rx="1.5" />
            <path d="M6.5 4v6M11.5 4v6" />
          </svg>
        )
      )}
      {recording ? "REC" : "LIVE"}
    </span>
  );
}

export function TryPanel({
  preview,
  recorder,
  projectStore,
  dispatch,
  onPicked,
}: {
  preview: SoundPreview;
  /** What records it onto a new track; the plugin has none. */
  recorder?: Recorder;
  projectStore: ProjectStore;
  dispatch: Dispatch;
  /** Wraps Swap and Add, so the host can get out of the way after them (see `LibraryPanel`). */
  onPicked: (act: () => void) => void;
}) {
  const trying = useSyncExternalStore(preview.subscribe, preview.getState);
  const project = useProject(projectStore);
  const { oneTrack } = useExploreScope();
  const recording = (useRecorder(recorder)?.status ?? "idle") !== "idle";
  const savedPatches = useSavedPatches();
  if (!trying) return null;
  // The row it was tried from, for its artwork: the same thumbnail, so the panel reads as that row.
  const item = exploreItems({ savedPatches, samples: project.samples, project: projectStore }).find(
    (each) => each.key === trying.key,
  );

  const selected = project.tracks.find((track) => track.id === project.selectedTrackId && track.kind === "instrument");
  const take = (act: (sound: NonNullable<ReturnType<SoundPreview["current"]>>) => void) => () => {
    const sound = preview.current();
    if (!sound) return;
    onPicked(() => {
      act(sound);
      preview.taken();
    });
  };
  const swap = take(
    (sound) => selected && dispatch({ type: "applyPatch", trackId: selected.id, ...soundChains(sound) }),
  );
  const add = take((sound) => dispatch({ type: "createTrackFromPatch", id: newTrackId(), ...soundChains(sound) }));

  return (
    <section
      aria-label={`Trying ${trying.name}`}
      className="@container shrink-0 border-t border-line bg-stage px-3 pt-2.5 pb-3 flex flex-col gap-2.5"
    >
      <PanelHeader item={item} name={trying.name} closeLabel="Stop trying" onClose={() => preview.close()}>
        <ModeChip recording={recording} keyboard name={trying.name} />
      </PanelHeader>

      {/* Side by side. Desktop's labels are short to fit the library column; which track "current" is,
          and the full action, are in the title and the accessible name. */}
      <div className={`grid gap-2 ${oneTrack ? "grid-cols-1" : "grid-cols-[3fr_2fr]"}`}>
        <Button
          variant="quiet"
          onClick={swap}
          disabled={!selected}
          aria-label={selected ? `Swap onto ${selected.name}` : "Swap onto a track"}
          title={
            selected
              ? `Replace ${selected.name}'s sound with ${trying.name}`
              : "Select an instrument track to swap onto"
          }
          className={`${ACTION} ${ACTION_LAYOUT.desktop}`}
        >
          <SwapIcon />
          <span className="min-w-0 leading-tight @[16rem]:whitespace-nowrap">Replace current</span>
        </Button>
        {!oneTrack && (
          <Button
            variant="solid"
            onClick={add}
            aria-label="Add as a new track"
            className={`${ACTION} ${ACTION_LAYOUT.desktop}`}
          >
            <PlusIcon />
            <span className="min-w-0 leading-tight @[16rem]:whitespace-nowrap">Add new</span>
          </Button>
        )}
      </div>
    </section>
  );
}
