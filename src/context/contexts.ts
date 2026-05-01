/**
 * Lit Context definitions for passing data through the component tree.
 *
 * Uses @lit/context to provide reactive context values
 * without prop-drilling through intermediate components.
 */
import { createContext } from "@lit/context";
import { ESPHomeAPI } from "../api/index.js";
import type { ConfiguredDevice, AdoptableDevice, FirmwareJob } from "../api/types.js";
import type { LocalizeFunc } from "../common/localize.js";

/** Context for the ESPHome API client instance. */
export const apiContext = createContext<ESPHomeAPI>(Symbol("esphome-api"));

/** Context for the list of configured devices. */
export const devicesContext = createContext<ConfiguredDevice[]>(
  Symbol("esphome-devices")
);

/** Context for the list of importable/adoptable devices. */
export const importableDevicesContext = createContext<AdoptableDevice[]>(
  Symbol("esphome-importable-devices")
);

/** Context for the ESPHome version string. */
export const versionContext = createContext<string>(Symbol("esphome-version"));

/** Context for dark mode state. */
export const darkModeContext = createContext<boolean>(Symbol("esphome-dark-mode"));

/** Context for the localize function. */
export const localizeContext = createContext<LocalizeFunc>(
  Symbol("esphome-localize")
);

/** Context for whether the initial device list has been loaded. */
export const devicesLoadedContext = createContext<boolean>(
  Symbol("esphome-devices-loaded")
);

/** Context for whether the frontend is running inside HA ingress. */
export const isHaIngressContext = createContext<boolean>(
  Symbol("esphome-is-ha-ingress")
);

/** Context for active firmware jobs, keyed by device configuration.
 *  Tracks the latest non-terminal job per device (used for the busy
 *  spinner on cards/tables). For the full multi-job view, see
 *  `firmwareJobsContext`. */
export const activeJobsContext = createContext<Map<string, FirmwareJob>>(
  Symbol("esphome-active-jobs")
);

/** Context for every firmware job the backend currently exposes
 *  (active and the trimmed terminal history), keyed by `job_id`.
 *  Powers the firmware-tasks dialog — a device can have several jobs
 *  in flight (e.g. compile + clean queued back-to-back), so we key
 *  by job_id to keep them all distinct. */
export const firmwareJobsContext = createContext<Map<string, FirmwareJob>>(
  Symbol("esphome-firmware-jobs")
);

/** Context for whether the YAML diff button is enabled in the editor. */
export const yamlDiffButtonContext = createContext<boolean>(
  Symbol("esphome-yaml-diff-button")
);
