/**
 * The MCP bridge wire protocol. Pure types, imported by BOTH the browser bridge
 * and the Node server so the two ends can never drift. Messages are sent as
 * JSON over a WebSocket. The project is a tree of groups (buses) with tracks at
 * the leaves: tracks and groups are addressed by id; effects attach to a "host"
 * (a track or a group) addressed by `hostId`; transport and tempo are
 * project-level.
 */
import type { ParamValue } from "../params/types";
import type { ClipData, NoteEvent } from "../sequencer/types";
import type { ClipContent, ProjectData } from "../project/types";
import type { CustomDevice } from "../definitions/custom";
import type { DeviceRef } from "../library/backend";
import type { DeviceAnalysisRequest } from "../analysis/deviceAlone";
import type { MixAnalysisRequest } from "../analysis/mixScope";

/**
 * Version-history RPC. The commit DAG lives in the tab (OPFS), so the server
 * cannot read it directly: history tools send a `historyRequest` and await the
 * matching `historyReply` (correlated by `id`). This is the one request/response
 * path; everything else is fire-and-forget sync/commands.
 */
export type HistoryMethod = "commit" | "revert" | "history" | "diff" | "state";

/**
 * Patch-library RPC. Saved patches live in the tab (localStorage), so the server
 * cannot read or write them directly: patch tools send a `patchRequest` and await
 * the matching `patchReply` (correlated by `id`), the same shape as the history RPC.
 * `list` reads the library, `save` captures a track's sound, `apply` adds a track.
 */
export type PatchMethod = "list" | "save" | "apply" | "get";

/** Sent by the browser tab to the server (state sync + RPC replies). */
export type BrowserToServer =
  | { type: "projectSnapshot"; project: ProjectData }
  | { type: "projectStructure"; project: ProjectData }
  | { type: "paramChanged"; trackId: string; id: string; value: ParamValue }
  | { type: "clipSnapshot"; trackId: string; clipId: string; clip: ClipData }
  | { type: "effectParamChanged"; hostId: string; effectId: string; id: string; value: ParamValue }
  | { type: "midiDeviceParamChanged"; trackId: string; deviceId: string; id: string; value: ParamValue }
  | { type: "historyReply"; id: string; ok: boolean; result?: unknown; error?: string }
  | { type: "patchReply"; id: string; ok: boolean; result?: unknown; error?: string }
  | { type: "analysisReply"; id: string; ok: boolean; result?: unknown; error?: string }
  | { type: "deviceReply"; id: string; ok: boolean; result?: unknown; error?: string }
  // When this tab last had the user's attention (focus, or shown), in epoch ms: the server drives the
  // tab with the latest, so the agent edits the project in front of the user (AGENT-32).
  | { type: "attention"; at: number }
  // Not from a tab: a newer server, started by another Claude Code session, asking for the port.
  | { type: "takeover" };

/** Sent by the server to the browser tab (commands). */
export type ServerToBrowser =
  // Track structure (id assigned by the creator so both ends agree)
  | {
      type: "createTrack";
      instrumentType: string;
      name?: string;
      id: string;
      groupId?: string;
      /** Length of the seed clip. Defaults to the project length, and a dispatch pins it (DAW-36). */
      lengthBeats?: number;
    }
  | { type: "removeTrack"; trackId: string }
  | { type: "selectTrack"; trackId: string }
  | { type: "setTrack"; trackId: string; muted?: boolean; solo?: boolean; volume?: number; name?: string }
  // Assign (or swap) the instrument on an existing track - e.g. an empty track picks one.
  | { type: "setInstrument"; trackId: string; instrumentType: string }
  // Custom devices: user/AI-authored instruments & effects (engine definitions), stored in the
  // project. The def carries its own minted `type` id; removal addresses it by `deviceType`. Once
  // the device is kept in the library, `library` says which version it is (COMM-1.11.2).
  | DeviceEdit
  | { type: "removeCustomInstrument"; deviceType: string }
  | { type: "removeCustomEffect"; deviceType: string }
  // Group structure (bus tree; id assigned by the creator so both ends agree)
  | { type: "createGroup"; id: string; name?: string; parentId?: string | null }
  | { type: "removeGroup"; groupId: string }
  | {
      type: "setGroup";
      groupId: string;
      name?: string;
      muted?: boolean;
      solo?: boolean;
      volume?: number;
      collapsed?: boolean;
    }
  | { type: "moveTrack"; trackId: string; groupId: string }
  | { type: "moveGroup"; groupId: string; parentId: string | null }
  // Parameters
  | { type: "setParam"; trackId: string; id: string; value: ParamValue }
  // Effect chain on a host (track or group; effect id assigned by the creator)
  | { type: "addEffect"; hostId: string; effectType: string; id: string }
  | { type: "removeEffect"; hostId: string; effectId: string }
  | { type: "moveEffect"; hostId: string; effectId: string; toIndex: number }
  | { type: "bypassEffect"; hostId: string; effectId: string; bypassed: boolean }
  | { type: "setEffectParam"; hostId: string; effectId: string; id: string; value: ParamValue }
  // MIDI-device chain on an instrument track (device id assigned by the creator)
  | { type: "addMidiDevice"; trackId: string; deviceType: string; id: string }
  | { type: "removeMidiDevice"; trackId: string; deviceId: string }
  | { type: "moveMidiDevice"; trackId: string; deviceId: string; toIndex: number }
  | { type: "bypassMidiDevice"; trackId: string; deviceId: string; bypassed: boolean }
  | { type: "setMidiDeviceParam"; trackId: string; deviceId: string; id: string; value: ParamValue }
  // Clip note editing. `clipId` is optional - omit it to target the track's active
  // clip. Plural forms (addNotes / editNotes / removeNotes) are one atomic edit
  // each - one feed entry, one undo step - so writing a part or a multi-note
  // drag/delete don't flood the history.
  | { type: "addNote"; trackId: string; clipId?: string; note: NoteEvent }
  | { type: "addNotes"; trackId: string; clipId?: string; notes: NoteEvent[] }
  | { type: "editNotes"; trackId: string; clipId?: string; notes: NoteEvent[] }
  | { type: "removeNote"; trackId: string; clipId?: string; id: string }
  | { type: "removeNotes"; trackId: string; clipId?: string; ids: string[] }
  | { type: "clearClip"; trackId: string; clipId?: string }
  | { type: "setClipLength"; trackId: string; clipId?: string; lengthBeats: number }
  // Clip pool (note patterns / launchable slots)
  | {
      type: "addClip";
      trackId: string;
      id: string;
      name?: string;
      fromClipId?: string;
      empty?: boolean;
      lengthBeats?: number;
    }
  | { type: "pasteClip"; trackId: string; id: string; content: ClipContent }
  | { type: "selectClip"; trackId: string; clipId: string }
  | { type: "removeClip"; trackId: string; clipId: string }
  | { type: "renameClip"; trackId: string; clipId: string; name: string }
  // Arrangement placements (clip regions along time)
  | {
      type: "addPlacement";
      trackId: string;
      id: string;
      clipId?: string;
      startBeat: number;
      offset?: number;
      length?: number;
    }
  | { type: "movePlacement"; trackId: string; placementId: string; startBeat: number }
  | {
      type: "resizePlacement";
      trackId: string;
      placementId: string;
      /** Set when trimming the left edge, which moves the start and the offset together. */
      startBeat?: number;
      offset?: number;
      length?: number;
    }
  | { type: "removePlacement"; trackId: string; placementId: string }
  | { type: "splitPlacement"; trackId: string; placementId: string; atBeat: number; newId: string }
  // Clip launching (a launched clip loops over the transport, overriding placements)
  | { type: "launchClip"; trackId: string; clipId: string | null }
  | { type: "stopAllClips" }
  // Feed annotation: a line of intent narration shown in the activity feed (not an edit)
  | { type: "note"; text: string }
  // Live notes (polyphonic)
  | { type: "noteOn"; trackId: string; midi: number; velocity?: number }
  | { type: "noteOff"; trackId: string; midi: number }
  | { type: "allNotesOff" }
  // Transport (project-level)
  | { type: "setTempo"; bpm: number }
  | { type: "setTimeSignature"; numerator: number; denominator: number }
  | { type: "setGroove"; grooveId?: string; amount?: number }
  | { type: "setLength"; lengthBeats: number }
  | { type: "setLoopStart"; beats: number }
  | { type: "transport"; action: "play" | "stop" }
  // Version-history RPC (expects a matching historyReply, correlated by `id`)
  | { type: "historyRequest"; id: string; method: HistoryMethod; params?: Record<string, unknown> }
  // Patch-library RPC (expects a matching patchReply, correlated by `id`)
  | { type: "patchRequest"; id: string; method: PatchMethod; params?: Record<string, unknown> }
  // Mix-analysis RPC (expects a matching analysisReply): the tab renders the project, since it holds
  // the project's own samples and recordings (AGENT-4.9). With `device`, one track's sound alone (AGENT-4.6).
  | { type: "analysisRequest"; id: string; device?: DeviceAnalysisRequest; mix?: MixAnalysisRequest }
  // A device edit that expects a matching deviceReply: the tab keeps the device in the library before
  // the edit lands (COMM-1.11.2), and says if it couldn't, so the agent never builds on a device
  // that isn't there.
  | { type: "deviceRequest"; id: string; edit: DeviceEdit }
  // Whether the agent drives this tab: with several open, only the one most recently in front does.
  | { type: "agentTarget"; active: boolean }
  // Send a whole projectSnapshot: the server has just started driving this tab.
  | { type: "resync" };

/**
 * The edits that add or change a custom device. Add and update are the same store call; the edit
 * stays distinct for history. Updating replaces a device's def under its type: tracks and slots
 * using it keep the values of params it still has. Once the device is kept in the library,
 * `library` says which version it is (COMM-1.11.2).
 */
export type DeviceEdit = {
  [Type in DeviceEditType]: { type: Type; def: CustomDevice; library?: DeviceRef };
}[DeviceEditType];

type DeviceEditType = "addCustomInstrument" | "addCustomEffect" | "updateCustomInstrument" | "updateCustomEffect";

export const DEFAULT_WS_PORT = 8765;

/**
 * The hostnames of this machine. Only a page served from one can reach the local MCP server, and the
 * server takes tabs only from such pages, so a website open in the same browser can't pose as the tab.
 */
export const LOCAL_HOSTNAMES = ["localhost", "127.0.0.1", "::1", "[::1]"];
