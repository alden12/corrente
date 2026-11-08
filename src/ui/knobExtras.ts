/**
 * What a page can add to every knob (PLUGIN-3.4): a right-click menu and a small badge, by the param
 * the knob is. The plugin's window maps its macros this way ("Map to Macro 3", badge "M3"). The app
 * provides none, so its knobs are as they were.
 */
import { createContext, useContext } from "react";
import type { ParamStore } from "../audio/params/store";
import type { MenuItem } from "./Menu";
import type { ReactNode } from "react";

export interface KnobExtras {
  /** The knob's right-click menu, or undefined for none. */
  menu: (store: ParamStore, id: string) => MenuItem[] | undefined;
  /** A short badge on the knob, or undefined for none. */
  badge: (store: ParamStore, id: string) => string | undefined;
  /**
   * Something laid over the knob, or undefined for none: automation's marks on it, or the button
   * that binds it while an automation clip is picking its knobs (DAW-67).
   */
  overlay?: (store: ParamStore, id: string) => ReactNode;
}

const KnobExtrasContext = createContext<KnobExtras | undefined>(undefined);

export const KnobExtrasProvider = KnobExtrasContext.Provider;

export const useKnobExtras = (): KnobExtras | undefined => useContext(KnobExtrasContext);
