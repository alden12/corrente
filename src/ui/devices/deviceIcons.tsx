/** The rack's small glyphs: a drag handle's dots, and the power symbol on a device's bypass switch. */

/** Six dots, two columns of three: the handle a device is dragged by. */
export function GripIcon() {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden="true">
      {[4, 8, 12].flatMap((y) => [6, 10].map((x) => <circle key={`${x}:${y}`} cx={x} cy={y} r="1.2" />))}
    </svg>
  );
}

/** The power symbol: a device's bypass switch. */
export function PowerIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      width="15"
      height="15"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M8 2.5v5" />
      <path d="M4.6 4.6a5 5 0 1 0 6.8 0" />
    </svg>
  );
}
