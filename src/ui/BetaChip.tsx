/** "Beta", as Corrente wears it: on the welcome card, and at the foot of the activity rail. */
export function BetaChip({ className = "" }: { className?: string }) {
  return (
    <span
      title="Corrente is in beta: things move, and some will break"
      className={`inline-block font-mono text-[10px] font-medium uppercase tracking-wider text-you border border-you/50 bg-you/10 rounded px-1.5 py-0.5 ${className}`}
    >
      Beta
    </span>
  );
}
