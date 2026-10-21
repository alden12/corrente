import { describe, expect, it } from "vitest";
import type { WsStatus } from "../src/contract/client";
import {
  CONNECTING_AFTER_MS,
  OFFLINE_AFTER_MS,
  SETTLED_START,
  settle,
  type Settled,
} from "../src/ui/settledSyncStatus";

/**
 * HOST-16: the chip and the offline banner show the socket's status without its blips. `replay` runs
 * a timeline of raw statuses through `settle` the way the hook does (looking again at each change and
 * at each recheck) and returns what was on screen, change by change.
 */
function replay(timeline: [atMs: number, raw: WsStatus][], untilMs: number): (WsStatus | null)[] {
  let state: Settled = SETTLED_START;
  const seen: (WsStatus | null)[] = [state.shown];
  let raw: WsStatus | null = null;
  let recheckAt: number | undefined;
  const events = [...timeline];
  const look = (now: number) => {
    const next = settle(state, raw, now);
    state = next.state;
    recheckAt = next.recheckAt;
    if (state.shown !== seen.at(-1)) seen.push(state.shown);
  };
  for (let now = 0; now <= untilMs; now += 10) {
    const arrived = events.filter(([at]) => at === now);
    arrived.forEach(([, status]) => {
      raw = status;
      look(now);
    });
    if (arrived.length === 0 && recheckAt !== undefined && now >= recheckAt) look(now);
  }
  return seen;
}

describe("settle", () => {
  it("shows the good news at once", () => {
    const offline: Settled = { shown: "offline", since: 0, failed: true };
    expect(settle(offline, "online", 100).state.shown).toBe("online");
    expect(settle(offline, "idle", 100).state.shown).toBe("idle");
  });

  it("waits before showing offline or connecting, and says when to look again", () => {
    expect(settle({ ...SETTLED_START, shown: "online" }, "offline", 1000)).toEqual({
      state: { shown: "online", since: 1000, failed: true },
      recheckAt: 1000 + OFFLINE_AFTER_MS,
    });
    expect(settle(SETTLED_START, "connecting", 0).recheckAt).toBe(CONNECTING_AFTER_MS);
  });

  it("keeps offline on screen through a reconnect attempt", () => {
    expect(settle({ shown: "offline", since: 0, failed: true }, "connecting", 9000).state.shown).toBe("offline");
  });
});

describe("what the screen shows", () => {
  it("goes straight to synced on a quick connect", () => {
    expect(
      replay(
        [
          [0, "connecting"],
          [200, "online"],
        ],
        3000,
      ),
    ).toEqual([null, "online"]);
  });

  it("says connecting on a slow first connect", () => {
    expect(
      replay(
        [
          [0, "connecting"],
          [1500, "online"],
        ],
        3000,
      ),
    ).toEqual([null, "connecting", "online"]);
  });

  it("never shows a blip that recovers within a couple of seconds", () => {
    expect(
      replay(
        [
          [0, "online"],
          [1000, "offline"],
          [1500, "connecting"],
          [1800, "online"],
        ],
        6000,
      ),
    ).toEqual([null, "online"]);
  });

  it("settles on offline while the retries come and go, until it's online again", () => {
    const retries: [number, WsStatus][] = [0, 1, 2, 3, 4].flatMap((attempt) => [
      [3000 + attempt * 1000, "offline"],
      [3500 + attempt * 1000, "connecting"],
    ]);
    expect(replay([[0, "online"], ...retries, [9000, "online"]], 12000)).toEqual([null, "online", "offline", "online"]);
  });
});
