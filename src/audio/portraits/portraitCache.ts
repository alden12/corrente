/**
 * Portraits of what the user made (COMM-1.9.6): custom instruments and effects, and saved patches.
 * A portrait is a pure function of what it draws, so it's a **local cache keyed by that content's
 * hash**, never synced: each device draws a version once and keeps it in IndexedDB, and an edit makes
 * a new hash, so the old portrait is simply never asked for again.
 *
 * Drawn on demand: a card asks while it's on screen (`wantPortrait`) and lets go when it scrolls
 * away, so a draw queued for a card no longer in view is dropped before it starts. Draws run on the
 * render worker one at a time, so a long list never queues up the engine. One that fails (offline in
 * dev, where the worker's code comes over the network) keeps its card's glyph, and is tried again
 * when the browser is back online, or when its card is next on screen after a pause.
 */
import { openDB, type IDBPDatabase } from "idb";
import { documentHash } from "../contentHash";
import { drawPortraitInWorker } from "../engine/renderInWorker";
import type { PortraitJob } from "./devicePortrait";
import type { Portrait } from "./draw";

/** Bump when a change to how portraits are drawn should redraw the ones already kept. */
const DRAWING = 1;

const DATABASE = "corrente-portraits";
const STORE = "portraits";

/** Each key's portrait once known. */
const known = new Map<string, Portrait>();
/** Draws that failed: when, and what to draw, to try again. */
const failed = new Map<string, { at: number; job: PortraitJob }>();
/** How long a failed draw waits before a card on screen may ask for it again. */
const RETRY_MS = 30_000;
/** How many cards on screen want each key. */
const wanted = new Map<string, number>();
/** Keys being looked up or drawn, so asking twice does the work once. */
const working = new Set<string>();
/** Draws waiting their turn, oldest first. */
const queue: { key: string; job: PortraitJob }[] = [];
let drawing = false;

const listeners = new Set<() => void>();
const notify = () => listeners.forEach((listener) => listener());

let database: Promise<IDBPDatabase | null> | undefined;
/** The cache's database, or null where there's no IndexedDB (portraits then last until reload). */
const openCache = () =>
  (database ??= openDB(DATABASE, 1, { upgrade: (opened) => opened.createObjectStore(STORE) }).catch(
    (error: unknown) => {
      console.warn("[corrente] portraits won't be kept:", error);
      return null;
    },
  ));

/** The key a job's portrait is kept under: the hash of what it draws, and how it's drawn. */
export const portraitKey = async (job: PortraitJob): Promise<string> => `${DRAWING}:${await documentHash(job)}`;

/** A key's portrait, if it's been drawn or read this session. */
export const knownPortrait = (key: string): Portrait | undefined => known.get(key);

const settle = (key: string, portrait: Portrait) => {
  known.set(key, portrait);
  failed.delete(key);
  working.delete(key);
  notify();
};

/** Draw the next portrait still wanted, one at a time. */
async function drawNext(): Promise<void> {
  if (drawing) return;
  const next = queue.shift();
  if (!next) return;
  if (!wanted.get(next.key)) {
    working.delete(next.key);
    return drawNext();
  }
  drawing = true;
  try {
    const portrait = await drawPortraitInWorker(next.job);
    // Kept before it's announced, so what's shown is what a reload finds. Not kept is drawn again next time, no worse.
    await openCache()
      .then((cache) => cache?.put(STORE, portrait, next.key))
      .catch(() => undefined);
    settle(next.key, portrait);
  } catch (error) {
    console.warn("[corrente] couldn't draw a portrait:", error);
    failed.set(next.key, { at: Date.now(), job: next.job });
    working.delete(next.key);
  } finally {
    drawing = false;
  }
  return drawNext();
}

/** Look a key up in the cache, and queue a draw if it isn't there and is still wanted. */
async function fetchPortrait(key: string, job: PortraitJob): Promise<void> {
  const cache = await openCache();
  const kept = (await cache?.get(STORE, key).catch(() => undefined)) as Portrait | undefined;
  if (kept) return settle(key, kept);
  if (!wanted.get(key)) {
    working.delete(key);
    return;
  }
  queue.push({ key, job });
  void drawNext();
}

/**
 * A card on screen wants this portrait: read from the cache or drawn, then announced. Returns the
 * call to make when the card leaves the screen.
 */
export function wantPortrait(key: string, job: PortraitJob): () => void {
  wanted.set(key, (wanted.get(key) ?? 0) + 1);
  const waiting = (failed.get(key)?.at ?? -Infinity) > Date.now() - RETRY_MS;
  if (!known.has(key) && !working.has(key) && !waiting) {
    working.add(key);
    void fetchPortrait(key, job);
  }
  return () => {
    const left = (wanted.get(key) ?? 1) - 1;
    if (left > 0) wanted.set(key, left);
    else wanted.delete(key);
  };
}

/** Back online: try again what failed and is still on screen. */
const retryFailed = () =>
  failed.forEach(({ job }, key) => {
    if (!wanted.get(key) || working.has(key)) return;
    failed.delete(key);
    working.add(key);
    void fetchPortrait(key, job);
  });
if (typeof window !== "undefined") window.addEventListener("online", retryFailed);

/** Subscribe to portraits arriving. Returns an unsubscribe fn. */
export function subscribePortraits(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
