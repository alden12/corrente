/**
 * Who made a clip, as a small dot by its name in their colour (DAW-47), shown only when it wasn't the
 * viewer: clips are coloured by their track now, so authorship moved here. Perspective-relative like
 * the rest of authorship, so your own clips never carry one.
 */
import { authorDotStyle, authorLabel } from "./authorStyle";
import { useAuthorPresence } from "./authorColorsContext";
import { isViewer } from "./authorColors";

export function CreatorDot({ author, className = "" }: { author: string; className?: string }) {
  const presence = useAuthorPresence();
  if (isViewer(author, presence.self)) return null;
  return (
    <span
      title={`Made by ${authorLabel(author, presence.self)}`}
      className={`inline-block w-1.5 h-1.5 shrink-0 rounded-full ${className}`}
      style={authorDotStyle(author, presence)}
    />
  );
}
