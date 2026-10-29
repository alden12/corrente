/**
 * "A new version is ready" (MOBILE-3), as a bar above the shell rather than a dialog.
 *
 * It is never urgent - the old version works, and the new one is already downloaded and will be
 * taken on the next cold start regardless. So it takes a strip and waits, the way the offline
 * banner does, instead of interrupting to ask a question that has no wrong answer.
 *
 * **Dismissable, and that matters more here than it looks.** Reloading mid-take loses nothing
 * saved, but it does stop the transport and re-open the project, so it is the last thing you
 * want to be nudged into during a session. Dismissing leaves the worker waiting exactly as it
 * was, to be picked up whenever the app is next closed properly.
 */
import { useState } from "react";
import { Button } from "./controls/Button";

/**
 * `required` is the other case (HOST-23.1): this version is too old for the server, or for a project
 * a newer one saved, so it can't go on and there is no Later. Edits made meanwhile are held, as they
 * are offline, and go up after the reload.
 */
export function UpdateNotice({
  onReload,
  required = false,
  message = required ? "This version of Corrente is out of date." : "A new version is ready.",
  action = "Reload",
}: {
  onReload: () => void;
  required?: boolean;
  /** What's new, and what its button does: the plugin's window offers a download this way (PLUGIN-5). */
  message?: string;
  action?: string;
}) {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed && !required) return null;

  return (
    <div
      role="status"
      className="flex items-center justify-center gap-3 px-3 py-1.5 text-[12px] font-medium bg-panel text-muted"
    >
      <span className="w-2 h-2 rounded-full bg-you" />
      <span>{message}</span>
      <Button variant="solid" size="sm" onClick={onReload}>
        {action}
      </Button>
      {!required && (
        <Button variant="ghost" size="sm" onClick={() => setDismissed(true)}>
          Later
        </Button>
      )}
    </div>
  );
}
