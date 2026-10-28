/**
 * React binding for the recording controller's transient state (status, devices,
 * count-in). Re-renders the transport when recording starts/stops or the device
 * list changes.
 */
import { useSyncExternalStore } from "react";
import type { Recorder, RecorderState } from "../audio/recording/recorder";

export function useRecorder(recorder: Recorder): RecorderState;
/** No recorder (the plugin's window), no state. */
export function useRecorder(recorder: Recorder | undefined): RecorderState | undefined;
export function useRecorder(recorder: Recorder | undefined): RecorderState | undefined {
  return useSyncExternalStore(
    (onChange) => recorder?.subscribe(onChange) ?? (() => undefined),
    () => recorder?.getState(),
  );
}
