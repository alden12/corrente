/**
 * A chained device's header buttons (an effect, a MIDI device): move it earlier or later in its
 * chain, or remove it.
 */
const iconButton = "font-mono text-[11px] w-5 h-5 rounded border border-line text-ink cursor-pointer";

export function ChainActions({
  index,
  count,
  onMove,
  onRemove,
  removeTitle,
}: {
  /** Where it sits in its chain, and how long the chain is. */
  index: number;
  count: number;
  onMove: (toIndex: number) => void;
  onRemove: () => void;
  removeTitle: string;
}) {
  return (
    <>
      <button
        type="button"
        title="Move earlier"
        disabled={index === 0}
        onClick={() => onMove(index - 1)}
        className={`${iconButton} disabled:opacity-30`}
      >
        ←
      </button>
      <button
        type="button"
        title="Move later"
        disabled={index === count - 1}
        onClick={() => onMove(index + 1)}
        className={`${iconButton} disabled:opacity-30`}
      >
        →
      </button>
      <button type="button" title={removeTitle} onClick={onRemove} className={iconButton}>
        ×
      </button>
    </>
  );
}
