/**
 * Explore's Most favourited shelf (COMM-1.9.11): the most hearted built-in devices and factory
 * patches across everyone, from `GET /shelves/most-favourited`, which the edge caches so a visit
 * rarely wakes the server: refreshed hourly while signed-in people (whose sessions wake it anyway)
 * ask for it, daily otherwise. Asked once per session; the last answer is kept on this device, so the
 * shelf shows at once, and offline, and is simply missing on a standalone run with no server.
 */
import { useEffect, useSyncExternalStore } from "react";
import { apiClient } from "../../hosting/api";
import { accountOwner, SIGNED_OUT } from "../../auth/session";
import { createValueStore } from "../../listeners";
import { readPersistent, writePersistent } from "../persistentStore";

const KEY = "corrente:most-favourited";

function remembered(): readonly string[] {
  try {
    const parsed: unknown = JSON.parse(readPersistent(KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((ref): ref is string => typeof ref === "string") : [];
  } catch {
    return [];
  }
}

const refs = createValueStore<readonly string[]>(remembered());
let asked = false;

function load(): void {
  if (asked || !apiClient) return;
  asked = true;
  apiClient
    .mostFavourited(accountOwner() !== SIGNED_OUT)
    .then((latest) => {
      refs.set(latest);
      writePersistent(KEY, JSON.stringify(latest));
    })
    .catch(() => {
      // Offline or the server unreachable: keep what was remembered, and ask again next time.
      asked = false;
    });
}

/** The shelf's refs, most hearted first. */
export function useMostFavourited(): readonly string[] {
  useEffect(load, []);
  return useSyncExternalStore(refs.subscribe, refs.read, refs.read);
}
