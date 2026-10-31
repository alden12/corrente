/**
 * The row over your preview track's editor (COMM-1.4.5, canvas "Corrente Preview Rack"): what it is,
 * that it isn't in the arrangement, and the ways it reaches the rest of the project, each one edit
 * (`previewTakes`), the preview staying to keep trying things:
 *
 * - **Create new track in <group> ▾** (a phone: **New track**, in the main group), and
 * - **Use on… ▾**: a track, then replace its sound or add just the devices tried.
 *
 * **Discard** puts it away, an edit too, so undo brings it back.
 */
import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { instrumentFold, useDeviceFolds } from "../devices/deviceFolds";
import type { Dispatch } from "../../audio/commands/types";
import type { InstrumentTrack, ProjectStore } from "../../audio/project/projectStore";
import { useProject } from "../../audio/project/useProject";
import { Button } from "../controls/Button";
import { IconButton } from "../controls/IconButton";
import { Menu, type MenuItem } from "../Menu";
import { PlusIcon, SwapIcon } from "../explore/PanelParts";
import { ACTION, ACTION_LAYOUT } from "../explore/panelStyles";
import { exploreItems } from "../explore/exploreItems";
import { FavouriteButton } from "../explore/favourites/FavouriteButton";
import { useSavedPatches } from "../explore/useSavedPatches";
import { previewTakes } from "./previewTakes";
import { previewTitle } from "./previewTitle";
import { previewTrying, triedItem } from "./previewTrying";

export function PreviewBar({
  preview,
  projectStore,
  dispatch,
  layout,
  onPicked,
}: {
  preview: InstrumentTrack;
  projectStore: ProjectStore;
  dispatch: Dispatch;
  layout: "desktop" | "phone";
  /** Wraps New track and Use on: the phone goes to the Studio after, as any pick does. */
  onPicked?: (act: () => void) => void;
}) {
  const project = useProject(projectStore);
  const takes = previewTakes(preview, projectStore, dispatch, onPicked);
  const discard = () => previewTrying(projectStore, dispatch).discard();
  const rootGroup = project.groups.find((group) => group.parentId === null);
  const [pickedGroup, setPickedGroup] = useState<string | null>(null);
  const group = project.groups.find((each) => each.id === pickedGroup) ?? rootGroup;
  const groupName = (each: { parentId: string | null; name: string }) => (each.parentId === null ? "Main" : each.name);
  const groupItems = (): MenuItem[] =>
    project.groups.map((each) => ({
      label: groupName(each),
      checked: each.id === group?.id,
      onClick: () => setPickedGroup(each.id),
    }));
  const useOn = takes.useOnItems();
  // The row it was tried from, so it can be hearted from here, as from its row (DAW-58).
  const tried = useSyncExternalStore(triedItem.subscribe, triedItem.read);
  const item = exploreItems({ savedPatches: useSavedPatches(), samples: project.samples, project: projectStore }).find(
    (each) => each.key === tried,
  );
  const trackMenu = (trigger: ReactNode, triggerClassName: string) =>
    useOn.length > 0 ? (
      <Menu
        label="Use on a track"
        items={() => takes.useOnItems()}
        align="right"
        trigger={trigger}
        triggerClassName={triggerClassName}
      />
    ) : null;

  // A phone shows a row a device (board `Phone`): the instrument starts folded there too, rather
  // than open on its sections, unless you've opened it before.
  const folds = useDeviceFolds();
  const instrument = instrumentFold(preview.id);
  const instrumentChosen = folds.isChosen(instrument);
  useEffect(() => {
    if (layout === "phone" && !instrumentChosen) folds.putAll([instrument], true);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, for a preview never folded by hand
  }, [layout, instrumentChosen, instrument]);

  if (layout === "phone") {
    return (
      <div className="flex items-center gap-2 px-3 py-2.5 border-b border-line" data-testid="preview-bar">
        <IconButton label="Discard the preview" onClick={discard}>
          <svg
            viewBox="0 0 16 16"
            aria-hidden="true"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            className="w-4 h-4"
          >
            <path d="M4 4l8 8M12 4l-8 8" />
          </svg>
        </IconButton>
        {item?.favouritable && <FavouriteButton item={item} className="w-11 h-11" />}
        <Button
          variant="quiet"
          onClick={takes.createTrack(rootGroup?.id)}
          className={`flex-1 ${ACTION} ${ACTION_LAYOUT.phone}`}
        >
          <PlusIcon />
          <span className="min-w-0 leading-tight">New track</span>
        </Button>
        <span className={`flex-1 ${ACTION} ${ACTION_LAYOUT.phone} rounded-full bg-you text-ground font-semibold flex`}>
          {trackMenu(
            <span className="flex items-center justify-center gap-1.5">
              <SwapIcon />
              Use on… ▾
            </span>,
            "w-full h-full cursor-pointer",
          )}
        </span>
      </div>
    );
  }

  return (
    <div
      className="sticky top-0 z-30 flex flex-wrap items-center gap-x-3.5 gap-y-2 px-4 py-2.5 border-b border-line bg-frame"
      data-testid="preview-bar"
    >
      <span className="font-mono text-[10px] tracking-[0.16em] text-faint">PREVIEW</span>
      <span data-testid="preview-title" className="font-semibold text-[13px] text-strong truncate">
        {previewTitle(preview)}
      </span>
      <span className="text-[12px] text-muted">Yours to try things on: it isn't in the arrangement.</span>
      <span className="flex-1" />
      <Button onClick={discard} title="Put the preview away (undo brings it back)">
        Discard
      </Button>
      <span className="inline-flex items-stretch rounded-full border border-you/50 text-you">
        <button
          type="button"
          onClick={takes.createTrack(group?.id)}
          className="h-8 pl-3.5 pr-2.5 text-[12.5px] cursor-pointer hover:bg-you/10 rounded-l-full"
        >
          Create new track in <span className="font-semibold text-strong">{group ? groupName(group) : "Main"}</span>
        </button>
        <span className="border-l border-you/50 flex">
          <Menu
            label="Choose the group the new track goes in"
            items={groupItems}
            trigger="▾"
            triggerClassName="h-8 px-2.5 text-[15px] leading-none cursor-pointer rounded-r-full text-you hover:bg-you/10"
          />
        </span>
      </span>
      <span className="inline-flex rounded-full bg-you text-ground font-semibold">
        {trackMenu(
          <span className="text-[12.5px]">Use on… ▾</span>,
          "h-8 px-3.5 cursor-pointer rounded-full hover:brightness-110",
        )}
      </span>
    </div>
  );
}
