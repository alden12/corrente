/**
 * The output buffer setting (INST-36.9, INST-43): picked for you by default, the smallest unless this
 * device has glitched, or one size by hand. Part of the Recording tab, beside the output device.
 */
import { useSyncExternalStore } from "react";
import type { BufferControl } from "../audio/engine/bufferControl";
import { BUFFER_SETTINGS, type BufferSetting, type BufferSize } from "../audio/engine/bufferSize";
import { Select } from "./controls/Select";

const SETTING_LABELS: Record<BufferSetting, string> = {
  auto: "Automatic",
  interactive: "Smallest",
  balanced: "Medium",
  playback: "Largest",
};

const SIZE_NAMES: Record<BufferSize, string> = { interactive: "smallest", balanced: "medium", playback: "largest" };

export function BufferSettings({ control }: { control: BufferControl }) {
  const { setting, size, liveSize, playbackSize } = useSyncExternalStore(
    (onChange) => control.subscribe(onChange),
    () => control.snapshot,
  );
  return (
    <div className="flex flex-col gap-2">
      <label className="flex items-center gap-2">
        <span className="text-[12.5px] text-ink">Output buffer</span>
        <Select
          aria-label="Output buffer"
          value={setting}
          onChange={(event) => control.setSetting(event.target.value as BufferSetting)}
          size="md"
          className="ml-auto"
        >
          {BUFFER_SETTINGS.map((each) => (
            <option key={each} value={each}>
              {SETTING_LABELS[each]}
            </option>
          ))}
        </Select>
      </label>
      <p className="text-[11px] text-faint leading-relaxed">
        {setting === "auto"
          ? `Now ${SIZE_NAMES[size]}. As small as this device manages, so notes answer at once: ${SIZE_NAMES[liveSize]} while stopped, ${SIZE_NAMES[playbackSize]} for playback. If either keeps glitching, it steps up a size until Corrente is next opened.`
          : `Always ${SIZE_NAMES[setting]}. Smaller answers sooner; larger glitches less.`}{" "}
        A change is a moment's silence, so it waits for one: on Play, or once stopped.
      </p>
    </div>
  );
}
