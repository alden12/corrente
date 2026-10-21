/**
 * Whether the browser may throw a standalone run's files away (HOST-23.2.1.1), so the "On this
 * device" panel can say so plainly. Browser storage is the user's to manage (HOST-23.2.1's stance):
 * this says what the risk is and the ways out, it doesn't try to make the storage something it isn't.
 *
 * Three answers:
 * - `kept`: the browser agreed to keep it (`navigator.storage.persisted()`), so only clearing site
 *   data loses it.
 * - `may-clear`: it may be evicted when the device runs short of space. Chrome grants persistence by
 *   engagement, so a new visitor usually starts here; installing the app is what earns it.
 * - `week`: Safari deletes a site's script-written storage after 7 days without a visit, unless the
 *   site is installed (added to the Dock or the Home Screen).
 */
import { createListeners } from "../listeners";
import { hosting } from ".";

export type StorageRisk = "kept" | "may-clear" | "week";

export interface StorageFacts {
  persisted: boolean;
  /** Running as an installed app rather than in a browser tab. */
  installed: boolean;
  safari: boolean;
}

export const storageRisk = ({ persisted, installed, safari }: StorageFacts): StorageRisk =>
  safari && !installed ? "week" : persisted ? "kept" : "may-clear";

/** Safari itself, not the other browsers whose user agents also say "Safari". */
export const isSafari = (userAgent: string): boolean =>
  /Safari\//.test(userAgent) && !/Chrome|Chromium|CriOS|FxiOS|EdgiOS|Edg\//.test(userAgent);

const installedNow = (): boolean =>
  typeof window !== "undefined" &&
  (window.matchMedia?.("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true);

async function readFacts(): Promise<StorageFacts> {
  let persisted = false;
  try {
    persisted = (await navigator.storage?.persisted?.()) ?? false;
  } catch {
    // No Storage API answer counts as not kept.
  }
  return { persisted, installed: installedNow(), safari: isSafari(navigator.userAgent) };
}

/** The browser's offer to install the app (Chrome and Edge), kept until it's used. */
interface InstallPrompt extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export interface StorageRiskSnapshot {
  /** Undefined until the browser has answered. */
  risk?: StorageRisk;
  /** Whether the browser will install the app from a button. */
  canInstall: boolean;
}

let snapshot: StorageRiskSnapshot = { canInstall: false };
let installPrompt: InstallPrompt | null = null;
const listeners = createListeners();

const update = (next: Partial<StorageRiskSnapshot>) => {
  snapshot = { ...snapshot, ...next };
  listeners.emit();
};

/** Ask the browser again. */
export const refreshStorageRisk = async (): Promise<void> => update({ risk: storageRisk(await readFacts()) });

// Standalone only: taking the install offer stops the browser showing its own, which a hosted run
// still wants since nothing there offers it instead.
if (typeof window !== "undefined" && hosting.mode === "standalone") {
  // The offer comes once, early, so it's caught when this module loads and kept for the button.
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    installPrompt = event as InstallPrompt;
    update({ canInstall: true });
  });
  window.addEventListener("appinstalled", () => {
    installPrompt = null;
    update({ canInstall: false });
    void refreshStorageRisk();
  });
  void refreshStorageRisk();
}

/** Show the browser's install dialog, from a click. */
export async function installApp(): Promise<void> {
  const prompt = installPrompt;
  if (!prompt) return;
  installPrompt = null;
  update({ canInstall: false });
  await prompt.prompt();
  await prompt.userChoice;
  await refreshStorageRisk();
}

export const subscribeStorageRisk = listeners.subscribe;

export const readStorageRisk = (): StorageRiskSnapshot => snapshot;
