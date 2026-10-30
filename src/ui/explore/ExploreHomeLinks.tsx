/**
 * What Explore's home offers beyond its own items: a way back to your projects (COMM-2), and, while
 * no MCP client is connected, the invitation to make your own devices with an agent (COMM-4).
 */
import type { McpStatus } from "../../audio/mcp/bridge";
import { MCP_GUIDE_URL } from "../../hosting";

/** What home links to beyond Explore: the open project, the list of projects, and an agent's setup. */
export interface ExploreLinks {
  mcpStatus?: McpStatus;
  onOpenProject?: () => void;
  onOpenProjects?: () => void;
  /** From Projects, back to Explore: shown while Projects was reached from here (`fromExplore`). */
  onBackToExplore?: () => void;
}

/** Explore home's way back to what you are making (COMM-2): the open project, and the list of them. */
export function YourWork({ name, links }: { name: string; links: ExploreLinks }) {
  const { onOpenProject, onOpenProjects } = links;
  if (!onOpenProject && !onOpenProjects) return null;
  const linkClass =
    "flex items-center gap-2 h-9 pointer-coarse:h-11 px-2.5 rounded-md border border-line text-[12px] text-ink text-left cursor-pointer hover:border-you hover:text-strong min-w-0";
  return (
    <nav aria-label="Your projects" className="grid grid-cols-2 gap-1.5">
      {onOpenProject && (
        <button type="button" onClick={onOpenProject} className={linkClass} title={`Back to ${name}`}>
          <FolderIcon open />
          <span className="truncate">{name}</span>
        </button>
      )}
      {onOpenProjects && (
        <button type="button" onClick={onOpenProjects} className={linkClass}>
          <FolderIcon />
          <span className="truncate">All projects</span>
        </button>
      )}
    </nav>
  );
}

const FolderIcon = ({ open = false }: { open?: boolean }) => (
  <svg
    viewBox="0 0 16 16"
    aria-hidden="true"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.4"
    strokeLinejoin="round"
    className="w-4 h-4 shrink-0 text-faint"
  >
    <path d="M2.5 4.5a1 1 0 0 1 1-1h3l1.5 1.5h4.5a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1z" />
    {open && <path d="M2.5 7h11" />}
  </svg>
);

/**
 * Making your own (COMM-4): devices are what an agent builds over MCP (any MCP client, not only
 * Claude), and Explore is where you would want more than the built-ins. Shown only while nothing is
 * connected; the link is the setup.
 */
export function MakeYourOwn() {
  return (
    <section aria-label="Make your own" className="mx-3 mt-1 rounded-md border border-line px-3 py-2.5 text-[12px]">
      <p className="font-semibold text-strong">Make your own with an agent</p>
      <p className="mt-0.5 text-muted">
        Describe an instrument, an effect or a MIDI device, and your agent builds it here, ready to play.
      </p>
      <a
        href={MCP_GUIDE_URL}
        target="_blank"
        rel="noreferrer"
        className="inline-block mt-1.5 text-you underline underline-offset-2 hover:text-strong"
      >
        Connect an agent over MCP
      </a>
    </section>
  );
}
