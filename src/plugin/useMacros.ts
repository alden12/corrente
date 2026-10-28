/**
 * The macros as the window shows them (PLUGIN-3.4): what each is mapped to for the device playing,
 * and each knob's menu and badge (`KnobExtras`). Follows both the mapping and the device.
 */
import { useSyncExternalStore } from "react";
import type { KnobExtras } from "../ui/knobExtras";
import { paramTitle } from "./paramTitle";
import type { PluginDevice } from "./pluginDevice";
import type { PluginMacros, Slots } from "./pluginMacros";

export interface MacroView {
  /** What each macro is mapped to, by binding name. */
  mapping: Slots;
  /** A mapped param's name as the host shows it ("Filter Cutoff"). */
  titleOf: (name: string) => string;
  /** Its knob's own label, shorter ("Cutoff"). */
  labelOf: (name: string) => string;
  unmap: (name: string) => void;
  extras: KnobExtras;
}

export function useMacros(device: PluginDevice, macros: PluginMacros): MacroView {
  useSyncExternalStore(device.subscribe, device.deviceKey);
  useSyncExternalStore(macros.subscribe, macros.getSlots);
  const names = device.paramNames();
  const mapping = macros.mapping(names);
  const titleOf = (name: string) => {
    const param = device.paramOf(name);
    return param ? paramTitle(param.id, param.store.spec(param.id)) : name;
  };
  const labelOf = (name: string) => {
    const param = device.paramOf(name);
    return param ? param.store.spec(param.id).label : name;
  };
  const slotOf = (name: string | undefined) => (name === undefined ? -1 : mapping.indexOf(name));
  return {
    mapping,
    titleOf,
    labelOf,
    unmap: (name) => macros.unmap(name, names),
    extras: {
      menu: (store, id) => {
        const name = device.nameOf(store, id);
        if (!name) return undefined;
        const slot = slotOf(name);
        return [
          {
            label: "Map to macro",
            submenu: mapping.map((mapped, index) => ({
              label: `Macro ${index + 1}${mapped && mapped !== name ? `: ${titleOf(mapped)}` : ""}`,
              checked: index === slot,
              onClick: () => macros.map(name, index, names),
            })),
          },
          ...(slot >= 0 ? [{ label: `Unmap from macro ${slot + 1}`, onClick: () => macros.unmap(name, names) }] : []),
        ];
      },
      badge: (store, id) => {
        const slot = slotOf(device.nameOf(store, id));
        return slot >= 0 ? `M${slot + 1}` : undefined;
      },
    },
  };
}
