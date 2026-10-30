import { lazy } from "react";

/** A graph's view (INST-44), fetched with React Flow the first time one is opened: by a tab, or the phone's page. */
export const LazyDeviceGraphView = lazy(() => import("./DeviceGraphView"));
