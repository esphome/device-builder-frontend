import { stripBase } from "../../util/base-path.js";
import { navigate } from "../../util/navigation.js";
import { getTourConfiguration, setTourConfiguration } from "./tour-session.js";
import type { TourStep } from "./tour-steps.js";

export function onTourDeviceRoute(): boolean {
  return stripBase(window.location.pathname).startsWith("/device/");
}

function onDashboardRoute(): boolean {
  const path = stripBase(window.location.pathname);
  return path === "" || path === "/";
}

export function navigateToTourStep(
  step: TourStep,
  resuming: boolean,
  onArrived: () => void,
  onCancelled: () => void
): boolean {
  let target: string | null = null;
  if (step.route === "dashboard" && !onDashboardRoute()) {
    target = "/";
  } else if (resuming && step.route === "device" && !onTourDeviceRoute()) {
    const configuration = getTourConfiguration();
    if (configuration) target = `/device/${encodeURIComponent(configuration)}`;
  }
  if (target === null) return false;

  void (async () => {
    try {
      await navigate(target);
    } catch (err) {
      console.warn("Guided tour navigation failed:", err);
      onCancelled();
      return;
    }
    const arrived = step.route === "dashboard" ? onDashboardRoute() : onTourDeviceRoute();
    if (arrived) onArrived();
    else onCancelled();
  })();
  return true;
}

export function captureTourConfiguration(active: boolean): void {
  if (!active || !onTourDeviceRoute()) return;
  const encoded = stripBase(window.location.pathname).slice("/device/".length);
  if (!encoded) return;
  try {
    setTourConfiguration(decodeURIComponent(encoded));
  } catch {
    setTourConfiguration(encoded);
  }
}
