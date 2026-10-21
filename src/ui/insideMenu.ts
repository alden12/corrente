/**
 * Every popover (`Popover` in Menu.tsx) carries `data-menu-popover`, so "did this click land inside a
 * menu?" is one query, for the menus and for anything else that closes on a click outside.
 */
export const insideMenu = (target: EventTarget | null): boolean =>
  target instanceof Element && Boolean(target.closest("[data-menu-popover]"));
