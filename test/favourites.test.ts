/**
 * The favourites merge rules (COMM-1.9.3): local-first toggles, a queue the server settles, and
 * hearts made signed out folding into an account.
 */
import { describe, expect, it } from "vitest";
import {
  applyServerList,
  changesToSend,
  EMPTY_FAVOURITES,
  mergeSignedOut,
  toggleFavourite,
  type FavouritesState,
} from "../src/ui/explore/favourites/state";

const hearted = (...refs: string[]): FavouritesState => refs.reduce(toggleFavourite, EMPTY_FAVOURITES);

describe("favourites state", () => {
  it("hearts newest first and queues each change", () => {
    const state = hearted("instrument:fm", "effect:reverb");
    expect(state.refs).toEqual(["effect:reverb", "instrument:fm"]);
    expect(state.pending).toEqual({ "instrument:fm": "add", "effect:reverb": "add" });

    const unhearted = toggleFavourite(state, "instrument:fm");
    expect(unhearted.refs).toEqual(["effect:reverb"]);
    expect(unhearted.pending["instrument:fm"]).toBe("remove");
  });

  it("sends at most the limit, split into hearts and un-hearts", () => {
    const state = toggleFavourite(hearted("a:1", "a:2", "a:3"), "a:1");
    expect(changesToSend(state, 10)).toEqual({ add: ["a:2", "a:3"], remove: ["a:1"] });
    expect(changesToSend(state, 2)).toEqual({ add: ["a:2"], remove: ["a:1"] });
  });

  it("takes the server's list once it confirms what was sent", () => {
    const state = hearted("instrument:fm");
    const sent = changesToSend(state, 10);
    // The server also has a heart from another device.
    const synced = applyServerList(state, ["instrument:fm", "midi:arpeggiator"], sent);
    expect(synced).toEqual({ refs: ["instrument:fm", "midi:arpeggiator"], pending: {} });
  });

  it("keeps a change made while the request was in flight", () => {
    const before = hearted("instrument:fm");
    const sent = changesToSend(before, 10);
    // Tapped again before the answer arrived: un-hearted locally, which the answer must not undo.
    const during = toggleFavourite(before, "instrument:fm");
    const synced = applyServerList(during, ["instrument:fm"], sent);
    expect(synced.refs).toEqual([]);
    expect(synced.pending).toEqual({ "instrument:fm": "remove" });
  });

  it("lays unsent hearts over the server's list, newest on top", () => {
    const state = hearted("effect:delay");
    const synced = applyServerList(state, ["instrument:fm"], { add: [], remove: [] });
    expect(synced.refs).toEqual(["effect:delay", "instrument:fm"]);
    expect(synced.pending).toEqual({ "effect:delay": "add" });
  });

  it("merges signed-out hearts into an account, the account's own changes winning", () => {
    const account: FavouritesState = { refs: ["instrument:fm"], pending: { "effect:reverb": "remove" } };
    const signedOut = hearted("effect:reverb", "instrument:fm", "midi:euclidean");
    const merged = mergeSignedOut(account, signedOut);
    expect(merged.refs).toEqual(["midi:euclidean", "instrument:fm"]);
    expect(merged.pending).toEqual({ "midi:euclidean": "add", "effect:reverb": "remove" });
  });
});
