/**
 * The selected track's device chain: MIDI devices, then the instrument, then effects -
 * the signal path, read like text: left to right, wrapping when there is no room. "Save as patch"
 * captures the whole chain as a reusable library entry.
 *
 * On touch it fills a whole tab with its own heading (MOBILE-1), where narrow width makes the
 * wrap into a vertical stack of one block per device on its own. On desktop it is `bare`: the
 * workbench column draws the heading (`DevicesBar`, with Save as patch) and does the scrolling.
 */
import { useState, type KeyboardEvent } from "react";
import type { InstrumentTrack, ProjectStore, Track } from "../../audio/project/projectStore";
import type { Dispatch } from "../../audio/commands/types";
import type { SampleAsset } from "../../audio/samples/catalog";
import { savePatchFromTrack } from "../../audio/patches/patchTools";
import { parseTags } from "../../audio/tags";
import { EMPTY_INSTRUMENT, pickableInstrumentInfos } from "../../audio/instruments/catalog";
import { MidiDeviceChain } from "../MidiDeviceChain";
import { InstrumentPanel } from "../InstrumentPanel";
import { DrumkitPanel } from "../DrumkitPanel";
import { EffectChain } from "../EffectChain";
import { Button } from "../controls/Button";
import { Menu, type MenuItem } from "../Menu";

/**
 * "Save as patch": capture the instrument + its params + effect chain as a named,
 * reusable library entry. Picking it from the ⋮ reveals inline name and tags fields (the name
 * defaulting to the track's); Enter or Save writes it to the global patch library.
 */
export function SavePatchControl({
  track,
  projectStore,
  moreItems = [],
}: {
  track: InstrumentTrack;
  /** Where the track's custom devices are, which the patch carries. */
  projectStore: ProjectStore;
  /** Other actions on the chain, after Save as patch in the same menu. */
  moreItems?: MenuItem[];
}) {
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  const [tags, setTags] = useState("");

  const save = () => {
    savePatchFromTrack(track, "you", projectStore, { name, tags: parseTags(tags) });
    setNaming(false);
    setName("");
    setTags("");
  };
  const keys = (event: KeyboardEvent) => {
    if (event.key === "Enter") save();
    if (event.key === "Escape") setNaming(false);
  };

  if (!naming)
    return (
      <Menu
        label="Device chain actions"
        items={[
          {
            label: "Save as patch…",
            onClick: () => {
              setName(track.name);
              setNaming(true);
            },
          },
          ...moreItems,
        ]}
      />
    );

  return (
    <span className="inline-flex items-center gap-1">
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={keys}
        placeholder="Patch name…"
        className="w-32 font-mono text-[11px] px-1.5 py-0.5 rounded border border-line bg-ground text-strong placeholder:text-faint"
      />
      {/* What it sounds like, role first: what Explore's chips and the agent's lookup find it by. */}
      <input
        value={tags}
        onChange={(e) => setTags(e.target.value)}
        onKeyDown={keys}
        placeholder="Tags: pad, dark…"
        aria-label="Tags, separated by commas"
        className="w-28 font-mono text-[11px] px-1.5 py-0.5 rounded border border-line bg-ground text-strong placeholder:text-faint"
      />
      {/* The one primary action on this little form, and the only thing that commits it, so
          it takes the solid variant rather than a tint. */}
      <Button variant="solid" size="sm" onClick={save} className="font-mono text-[10.5px]">
        Save
      </Button>
    </span>
  );
}

/** Shown for an empty track (no instrument yet): pick one to assign. */
function InstrumentPicker({ trackId, dispatch }: { trackId: string; dispatch: Dispatch }) {
  return (
    <div className="w-full p-1">
      <p className="text-[11.5px] text-muted mb-2">This track has no instrument yet. Choose one:</p>
      <div className="flex flex-wrap gap-1.5">
        {pickableInstrumentInfos().map((info) => (
          <button
            key={info.type}
            type="button"
            onClick={() => dispatch({ type: "setInstrument", trackId, instrumentType: info.type })}
            className="px-2.5 py-1 rounded-md border border-line text-[12px] text-ink hover:text-strong hover:border-you cursor-pointer"
          >
            {info.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function DeviceRack({
  track,
  samples,
  dispatch,
  projectStore,
  onRevealSamples,
  bare = false,
}: {
  track: Track;
  samples: SampleAsset[];
  dispatch: Dispatch;
  projectStore: ProjectStore;
  /** Reveal the Samples library view (threaded to an empty Sampler's picker). */
  onRevealSamples?: () => void;
  /** Just the devices: the desktop column draws its own heading and scrolls itself (DAW-61.1). */
  bare?: boolean;
}) {
  const devices = (
    <div className="flex flex-wrap items-start content-start gap-3 p-3">
      {/* MIDI devices transform notes before the instrument, so they lead the chain. */}
      <MidiDeviceChain projectStore={projectStore} trackId={track.id} dispatch={dispatch} />
      {track.kind === "instrument" &&
        (track.instrumentType === EMPTY_INSTRUMENT ? (
          <InstrumentPicker trackId={track.id} dispatch={dispatch} />
        ) : track.instrumentType === "drumkit" ? (
          // A drum kit uses its own pad panel in place of the generic one.
          <DrumkitPanel
            params={track.params}
            trackId={track.id}
            dispatch={dispatch}
            samples={samples}
            onRevealSamples={onRevealSamples}
            projectStore={projectStore}
          />
        ) : (
          <InstrumentPanel
            params={track.params}
            instrumentType={track.instrumentType}
            trackId={track.id}
            dispatch={dispatch}
            samples={samples}
            onRevealSamples={onRevealSamples}
            projectStore={projectStore}
          />
        ))}
      <EffectChain projectStore={projectStore} trackId={track.id} dispatch={dispatch} />
    </div>
  );
  if (bare) return devices;
  return (
    <>
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-line bg-panel shrink-0">
        <span className="font-mono text-[10px] tracking-[0.16em] uppercase text-faint">Devices</span>
        {track.kind === "instrument" && track.instrumentType !== EMPTY_INSTRUMENT && (
          <span className="ml-auto">
            <SavePatchControl track={track} projectStore={projectStore} />
          </span>
        )}
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto">{devices}</div>
    </>
  );
}
