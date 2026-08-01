import { type ConfiguredDevice, DeviceState } from "../api/types/devices.js";
import type { ReachabilityStateEvent } from "../api/types/reachability.js";
import { setFittedConfigParam } from "./crash-report-budget.js";
import { devicePlatform, ESPHOME_BUG_FORM_URL, issuePlatform } from "./crash-report.js";
import { deviceSortKey } from "./device-sort.js";
import { mdnsExpiryPhase } from "./mdns-expiry.js";
import { formatCountdown } from "./relative-time.js";

/**
 * Prefill assembly for the report-a-bug device picker: which GitHub
 * form each bug path opens and the pure URL/facts building, kept
 * DOM-free so the shapes are unit-testable.
 */

/** The bug paths that carry a device config. */
export type DeviceTarget = "builder" | "esphome" | "status";

// Field ids come from each repo's issue templates: esphome/esphome's
// bug form has `config` + `additional`; the builder bug form has
// `config` + `extra` (config added in esphome/device-builder#2482); the
// device-status form has `config` + `observed` + `mdns-expiry`
// (esphome/device-builder#2487). GitHub silently drops unknown params,
// so these must track the templates.
const DEVICE_TARGETS: Record<
  DeviceTarget,
  { href: string; factsParam: "additional" | "extra" | "observed" }
> = {
  builder: {
    href: "https://github.com/esphome/device-builder/issues/new?template=bug_report.yml",
    factsParam: "extra",
  },
  esphome: {
    href: ESPHOME_BUG_FORM_URL,
    factsParam: "additional",
  },
  status: {
    href: "https://github.com/esphome/device-builder/issues/new?template=device_status.yml",
    factsParam: "observed",
  },
};

// The builder and status templates' `config` fields are required; their
// own descriptions tell reporters to write this when no device applies.
const NOT_DEVICE_SPECIFIC = "not device specific";

export interface PrefillContext {
  serverVersion: string;
  esphomeVersion: string;
  /** Bug-form installation dropdown value; "" when unknown. */
  installation: string;
}

/** The fully prefilled form URL for a picked device, and whether the
 *  config had to be truncated to fit the URL budget. */
export function buildDeviceIssueUrl(
  target: DeviceTarget,
  device: ConfiguredDevice,
  /** Masked YAML; "" opens the form without a config. */
  maskedConfig: string,
  ctx: PrefillContext,
  /** Status-target reachability snapshot; null when the read stalled. */
  reachability?: ReachabilityStateEvent | null
): { url: URL; truncated: boolean } {
  const url = deviceTargetUrl(target, ctx, device);
  url.searchParams.set(
    DEVICE_TARGETS[target].factsParam,
    deviceFacts(device, target, ctx, reachability)
  );
  if (target === "status") {
    // Set before the config fit so it counts against the URL budget.
    url.searchParams.set("mdns-expiry", mdnsExpirySummary(reachability ?? null, device));
  }
  const truncated = maskedConfig ? setFittedConfigParam(url, maskedConfig) : false;
  return { url, truncated };
}

/** Today's URL for the no-specific-device row; the builder and status
 *  paths fill their required fields with the template's own sentence. */
export function skipDeviceUrl(target: DeviceTarget, ctx: PrefillContext): URL {
  const url = deviceTargetUrl(target, ctx);
  if (target !== "esphome") url.searchParams.set("config", NOT_DEVICE_SPECIFIC);
  if (target === "status") url.searchParams.set("mdns-expiry", NOT_DEVICE_SPECIFIC);
  return url;
}

/**
 * The facts the form's dropdowns can't carry (GitHub only prefills
 * input/textarea fields), rendered as a bullet list.
 */
export function deviceFacts(
  device: ConfiguredDevice,
  target: DeviceTarget,
  ctx: PrefillContext,
  /** Status-target snapshot; when present its active source wins so the
   *  observed line agrees with the mdns-expiry answer. State stays on
   *  the live device — the snapshot can be stale on the OFFLINE
   *  transition. */
  reachability?: ReachabilityStateEvent | null
): string {
  const platform = issuePlatform(devicePlatform(device));
  return [
    `Device: ${deviceSortKey(device)} (${device.configuration})`,
    device.board_id && `Board: ${device.board_id}`,
    platform && `Platform: ${platform}`,
    device.runtime_state.deployed_version &&
      `ESPHome running: ${device.runtime_state.deployed_version}`,
    target !== "esphome" && ctx.esphomeVersion && `ESPHome: ${ctx.esphomeVersion}`,
    ctx.installation && `Installation: ${ctx.installation}`,
    ...(target === "status"
      ? [
          `State: ${device.runtime_state.state}`,
          `Reachability source: ${
            reachability?.active_source ?? device.runtime_state.active_source
          }`,
          ipLine(device),
        ]
      : []),
  ]
    .filter(Boolean)
    .map((fact) => `- ${fact}`)
    .join("\n");
}

const IPV4_LITERAL = /^\d{1,3}(\.\d{1,3}){3}$/;

// Blunt each address for the public issue: enough prefix to tell LAN
// from Docker-bridge from link-local, never the full host address.
// Fails closed — anything not a recognised IP literal masks entirely.
const maskIp = (address: string): string => {
  if (address.includes(":")) return `${address.split(":")[0]}::x`;
  if (!IPV4_LITERAL.test(address)) return "x";
  const [a, b] = address.split(".");
  return `${a}.${b}.x.x`;
};

const ipLine = (device: ConfiguredDevice): string => {
  const addresses = device.runtime_state.ip_addresses;
  const ips = (addresses.length ? addresses : device.ip ? [device.ip] : []).map(maskIp);
  return `IP: ${ips.length ? ips.join(", ") : "none resolved"}`;
};

/**
 * The status form's `mdns-expiry` answer, in English (the form is
 * English-only): the countdown the drawer would show, else why there
 * isn't one.
 */
function mdnsExpirySummary(
  reachability: ReachabilityStateEvent | null,
  device: ConfiguredDevice
): string {
  if (reachability === null) return "reachability read failed";
  const phase = mdnsExpiryPhase(
    reachability.mdns_last_seen_seconds_ago,
    reachability.mdns_ptr_ttl_seconds,
    device.runtime_state.state === DeviceState.OFFLINE,
    reachability.active_source
  );
  switch (phase.kind) {
    case "no-signal":
      return "no mDNS row";
    case "offline":
      return "no expiry countdown (device offline)";
    case "inactive-source":
      return "no expiry countdown (mDNS not the active source)";
    case "no-ttl":
      return "no expiry countdown (no PTR TTL)";
    case "fresh":
      return "no expiry countdown (heard recently)";
    case "soon":
      return "Expires soon";
    case "countdown":
      return `Expires in ${formatCountdown(phase.remaining, "en")}`;
  }
}

// Base form URL for *target* with the version param set: the builder
// and status forms take the dashboard version, esphome's the device's
// compiled version falling back to the installed core version.
function deviceTargetUrl(
  target: DeviceTarget,
  ctx: PrefillContext,
  device?: ConfiguredDevice
): URL {
  const url = new URL(DEVICE_TARGETS[target].href);
  const version =
    target === "esphome"
      ? device?.current_version || ctx.esphomeVersion
      : ctx.serverVersion;
  if (version) url.searchParams.set("version", version);
  return url;
}
