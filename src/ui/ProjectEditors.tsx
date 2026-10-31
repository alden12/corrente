/**
 * Who has edited this project, as a stack of circles in their colours at the right of the editor
 * tabs (DAW-47). Clips are coloured by their track now, so the notes in them, still in their
 * editor's colour, need a key: this is it. Opened, it names each one by their colour, and any of them
 * goes to where those colours are picked.
 *
 * The agent is one entry however many people drove it, as it is one colour; you are one entry
 * whether an edit was stamped with your id or the unattributed "you". Shown only once there are
 * two: a project only you have edited has nothing to tell apart.
 */
import { useProject } from "../audio/project/useProject";
import type { ProjectStore } from "../audio/project/projectStore";
import { isAgentAuthor } from "../audio/commands/authors";
import { authorHex, authorLabel } from "./authorStyle";
import { useAuthorPresence } from "./authorColorsContext";
import { isViewer } from "./authorColors";
import { Menu } from "./Menu";

/** Circles shown before the rest are counted ("+2"). */
const SHOWN = 4;
/** A circle's size, and how far each sits down and right of the one before: a diagonal stack. */
const CIRCLE = 13;
const STEP = { x: 5, y: 3 };

export function ProjectEditors({
  projectStore,
  onOpenColors,
}: {
  projectStore: ProjectStore;
  onOpenColors: () => void;
}) {
  useProject(projectStore);
  const presence = useAuthorPresence();
  // One per person: you first, then the agent, then everyone else in the order they appear.
  const byPerson = new Map<string, string>();
  const personOf = (author: string) =>
    isViewer(author, presence.self) ? "you" : isAgentAuthor(author) ? "agent" : author;
  for (const author of projectStore.editors())
    if (!byPerson.has(personOf(author))) byPerson.set(personOf(author), author);
  const order = (person: string) => (person === "you" ? 0 : person === "agent" ? 1 : 2);
  const editors = [...byPerson.entries()]
    .sort(([left], [right]) => order(left) - order(right))
    .map(([person, author]) => ({
      person,
      label: person === "agent" ? "Agent" : authorLabel(author, presence.self),
      color: authorHex(author, presence),
    }));
  // A key to one colour tells nothing, so it waits for a second editor.
  if (editors.length < 2) return null;
  const stacked = editors.slice(0, SHOWN);

  return (
    <span className="flex items-center shrink-0 px-2">
      <Menu
        label="Who's edited this project"
        align="right"
        triggerClassName="flex items-center pl-1.5 pr-1 h-7 rounded-md hover:bg-control cursor-pointer"
        trigger={
          <>
            <span
              aria-hidden="true"
              className="relative block"
              style={{
                width: CIRCLE + (stacked.length - 1) * STEP.x,
                height: CIRCLE + (stacked.length - 1) * STEP.y,
              }}
            >
              {stacked.map((editor, index) => (
                <span
                  key={editor.person}
                  className="absolute rounded-full border-2 border-frame"
                  style={{
                    width: CIRCLE,
                    height: CIRCLE,
                    left: index * STEP.x,
                    top: index * STEP.y,
                    background: editor.color,
                  }}
                />
              ))}
            </span>
            {editors.length > SHOWN && (
              <span aria-hidden="true" className="ml-1 font-mono text-[10px] text-muted">
                +{editors.length - SHOWN}
              </span>
            )}
          </>
        }
        items={[
          ...editors.map((editor) => ({ label: editor.label, swatch: editor.color, onClick: onOpenColors })),
          { separator: true },
          { label: "Change colours…", onClick: onOpenColors },
        ]}
      />
    </span>
  );
}
