/**
 * A param named as a plugin host lists it (PLUGIN-3): the host shows params flat, so the app's section
 * goes first ("Filter Env Attack"). The window's packages and export.ts's name them the same, so the
 * device a plugin was built with and the one its window sends are the same device.
 */
import type { ParamSpec } from "../audio/params/types";
import { namespaceOf, sectionTitle } from "../ui/paramSections";

export const paramTitle = (id: string, spec: Pick<ParamSpec, "label">): string => {
  const namespace = namespaceOf(id);
  return namespace ? `${sectionTitle(namespace)} ${spec.label}` : spec.label;
};
