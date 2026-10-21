/**
 * What the sync status shows, as against what the socket is doing this instant (HOST-16).
 *
 * Offline is a supported, calm state, but the transport passes through it noisily: retries flip
 * `offline` and `connecting` back and forth, and a blip that recovers in a second still drops to
 * `offline` first. Shown as is, the chip and the banner strobed, which read as broken. So the UI
 * settles it, timing the whole spell without a connection rather than each state in it:
 * - **offline** shows once the socket has been without a connection for `OFFLINE_AFTER_MS` and has
 *   said `offline` in that time, so a blip never shows at all;
 * - once offline shows, it stays until the socket is **online** (or idle) again;
 * - **connecting** shows after `CONNECTING_AFTER_MS` of a first attempt (or a wake) that hasn't yet
 *   failed, so a fast connect goes straight to synced;
 * - **online** and **idle** show at once, since they're the good news.
 *
 * The transport's own state machine is untouched; this is only what the UI is allowed to render.
 */
import { useEffect, useRef, useState } from "react";
import type { WsStatus } from "../contract/client";

export const OFFLINE_AFTER_MS = 2000;
export const CONNECTING_AFTER_MS = 500;

export interface Settled {
  shown: WsStatus | null;
  /** When the current spell without a connection began, or null while connected (or idle). */
  since: number | null;
  /** Whether the socket has said `offline` in this spell, as against only trying to connect. */
  failed: boolean;
}

export const SETTLED_START: Settled = { shown: null, since: null, failed: false };

const connected = (raw: WsStatus | null) => raw === "online" || raw === "idle" || raw === null;

/** The display after the socket says `raw` at `now`, and when to look again if it may change. */
export function settle(state: Settled, raw: WsStatus | null, now: number): { state: Settled; recheckAt?: number } {
  if (connected(raw)) return { state: { shown: raw, since: null, failed: false } };
  const since = state.since ?? now;
  const failed = state.failed || raw === "offline";
  const spell = { since, failed };
  if (state.shown === "offline" || (failed && now - since >= OFFLINE_AFTER_MS)) {
    return { state: { shown: "offline", ...spell } };
  }
  if (!failed && now - since >= CONNECTING_AFTER_MS) return { state: { shown: "connecting", ...spell } };
  return {
    state: { shown: state.shown, ...spell },
    recheckAt: since + (failed ? OFFLINE_AFTER_MS : CONNECTING_AFTER_MS),
  };
}

/** `raw`, settled as above. */
export function useSettledSyncStatus(raw: WsStatus | null): WsStatus | null {
  const [shown, setShown] = useState<WsStatus | null>(raw);
  const state = useRef<Settled>({ ...SETTLED_START, shown: raw });
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const look = () => {
      const next = settle(state.current, raw, Date.now());
      state.current = next.state;
      setShown(next.state.shown);
      if (next.recheckAt !== undefined) timer = setTimeout(look, Math.max(0, next.recheckAt - Date.now()));
    };
    // Looked at from a callback, so a status that lasts no time at all never renders.
    timer = setTimeout(look, 0);
    return () => clearTimeout(timer);
  }, [raw]);
  return shown;
}
