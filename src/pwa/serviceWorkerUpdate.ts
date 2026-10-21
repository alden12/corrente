/**
 * Knowing that a new version is waiting, and taking it (MOBILE-3).
 *
 * The worker is registered on `registerType: "prompt"`, which means a new one installs in the
 * background and then **waits**: it does not call `skipWaiting`, so it will not activate under
 * someone in the middle of a take. That is the right default and it has a cost, which a phone
 * found immediately: the new version arrives on the load *after* the one that downloaded it, so
 * you are always a launch behind, and on an installed app "close it" means swiping it out of the
 * recents list rather than just going to the home screen.
 *
 * So the waiting worker is surfaced as a choice instead. `updateSW(true)` tells it to take over
 * and reloads once it has - the same thing the close-and-reopen dance does, in one tap and at a
 * moment the person picked.
 *
 * Registration stays eager (from `main.tsx`, before React mounts) rather than moving into the
 * hook: a worker that only installs once a component has rendered is a worker that is not there
 * for the render that needed it. The hook subscribes to what registration finds.
 */
import { useSyncExternalStore } from "react";
import { registerSW } from "virtual:pwa-register";

let applyWaitingUpdate: ((reload?: boolean) => Promise<void>) | null = null;
let registration: ServiceWorkerRegistration | undefined;
let waiting = false;
/** A reload was asked for before the new version had downloaded: take it as soon as it has. */
let reloadWhenReady = false;
const listeners = new Set<() => void>();

const announce = () => {
  waiting = true;
  listeners.forEach((listener) => listener());
  if (reloadWhenReady) applyUpdate();
};

/** Install the worker and start watching for a newer one. Called once, from `main.tsx`. */
export function registerServiceWorker(): void {
  applyWaitingUpdate = registerSW({
    onNeedRefresh: announce,
    onRegisteredSW: (_url, registered) => {
      registration = registered;
    },
  });
}

/** Whether a new version has finished downloading and is waiting to take over. */
export function useUpdateWaiting(): boolean {
  return useSyncExternalStore(
    (onStoreChange) => {
      listeners.add(onStoreChange);
      return () => void listeners.delete(onStoreChange);
    },
    () => waiting,
    () => false,
  );
}

/** Let the waiting worker take over, then reload onto it. */
export function applyUpdate(): void {
  void applyWaitingUpdate?.(true);
}

/** How long to wait for a new version to download before reloading anyway. */
const FETCH_UPDATE_MS = 10_000;

/**
 * Get onto the newest version, when this one is too old to go on (HOST-23.1). A plain reload would
 * come back from the worker's cache as the same old app, so: take the waiting version if one has
 * downloaded, or ask for it and take it once it has. Without a worker (dev), or if nothing arrives,
 * reload anyway.
 */
export function reloadOntoLatest(): void {
  if (waiting) return applyUpdate();
  if (!registration) return location.reload();
  reloadWhenReady = true;
  void registration.update().catch(() => location.reload());
  setTimeout(() => location.reload(), FETCH_UPDATE_MS);
}
