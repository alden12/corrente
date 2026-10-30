/** Three boxes wired left to right: a device's graph. */
export function GraphIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      aria-hidden="true"
    >
      <rect x="1.5" y="2.5" width="4" height="4" rx="1" />
      <rect x="1.5" y="9.5" width="4" height="4" rx="1" />
      <rect x="10.5" y="6" width="4" height="4" rx="1" />
      <path d="M5.5 4.5h2.5v3.5h2.5M5.5 11.5h2.5V8" />
    </svg>
  );
}
