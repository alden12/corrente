/** Shared by the panels pinned under Explore: the try panel (COMM-1.4.1) and the effect panel. */

/**
 * The panel's two actions: a pill with an icon and a label. The labels are set by the shell: short on
 * desktop, fuller on a phone. On desktop the library column is resizable (150 to 420px), so there
 * the icon sits beside the label once the column has room for it, and above it below that.
 */
export const ACTION =
  "h-auto! min-h-10 py-1.5 rounded-2xl! whitespace-normal! min-w-0 inline-flex items-center justify-center text-center";
export const ACTION_LAYOUT = {
  desktop: "px-2! text-[11.5px]! flex-col gap-1 @[16rem]:px-2.5! @[16rem]:flex-row @[16rem]:gap-1.5",
  phone: "px-2.5! flex-row gap-1.5",
} as const;

/** The phone is the shell that passes pads; it gets roomier buttons with fuller labels. */
export type PanelLayout = keyof typeof ACTION_LAYOUT;
