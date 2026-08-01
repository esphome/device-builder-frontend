/**
 * Ordered, device-specific advice for the offline troubleshooting
 * dialog. Pure derivation from the device row, the live reachability
 * snapshot, and the on-demand probe result — most-specific first, so
 * the first section is the likeliest explanation.
 */
import type { ConfiguredDevice } from "../api/types/devices.js";
import type { ReachabilityStateEvent } from "../api/types/reachability.js";
import type { DeviceTroubleshootResult } from "../api/types/troubleshoot.js";

const MAC_SUFFIX_DOCS_URL =
  "https://github.com/esphome/device-builder#device-status-and-name_add_mac_suffix";
const FAQ_DOCKER_URL = "https://esphome.io/guides/faq/#docker-reference";
const FAQ_MDNS_URL = "https://esphome.io/guides/faq/#notes-on-disabling-mdns";
export const USE_ADDRESS_DOCS_URL =
  "https://esphome.io/components/wifi/#configuration-variables";

/** MQTT counts as stale once quiet for this long (discover ticks every 2s). */
const MQTT_STALE_AFTER_SECONDS = 300;

export interface TroubleshootSection {
  id: string;
  titleKey: string;
  bodyKeys: string[];
  docsUrl?: string;
  showUseAddressForm?: boolean;
}

export interface TroubleshootInput {
  device: ConfiguredDevice;
  reachability: ReachabilityStateEvent | null;
  result: DeviceTroubleshootResult | null;
  inDocker: boolean;
}

export function buildTroubleshootSections(
  input: TroubleshootInput
): TroubleshootSection[] {
  const { device, reachability, result, inDocker } = input;
  if (device.name_add_mac_suffix) {
    // No network diagnosis: the broadcast can never match this config.
    return [
      {
        id: "untracked",
        titleKey: "troubleshoot.untracked_title",
        bodyKeys: ["troubleshoot.untracked_body"],
        docsUrl: MAC_SUFFIX_DOCS_URL,
      },
    ];
  }

  const sections: TroubleshootSection[] = [];
  if (device.uses_deep_sleep) {
    sections.push({
      id: "deep_sleep",
      titleKey: "troubleshoot.deep_sleep_title",
      bodyKeys: ["troubleshoot.deep_sleep_body"],
    });
  }
  if (result?.icmp_available === false) {
    sections.push({
      id: "icmp_unavailable",
      titleKey: "troubleshoot.icmp_unavailable_title",
      bodyKeys: ["troubleshoot.icmp_unavailable_body"],
    });
  }
  if (result && !result.zeroconf_running) {
    sections.push({
      id: "zeroconf_down",
      titleKey: "troubleshoot.zeroconf_down_title",
      bodyKeys: ["troubleshoot.zeroconf_down_body"],
    });
  } else if (device.api_enabled && mdnsNeverSeen(reachability, result)) {
    sections.push({
      id: "mdns_dark",
      titleKey: "troubleshoot.mdns_dark_title",
      bodyKeys: inDocker
        ? ["troubleshoot.mdns_dark_docker_body", "troubleshoot.mdns_dark_vlan_body"]
        : ["troubleshoot.mdns_dark_body", "troubleshoot.mdns_dark_vlan_body"],
      docsUrl: inDocker ? FAQ_DOCKER_URL : FAQ_MDNS_URL,
    });
  }
  if (device.uses_mqtt && mqttStale(reachability)) {
    sections.push({
      id: "mqtt",
      titleKey: "troubleshoot.mqtt_title",
      bodyKeys: ["troubleshoot.mqtt_body"],
    });
  }
  if (result && !result.dns_resolved && result.dns_had_cached_failure) {
    sections.push({
      id: "dns_fail",
      titleKey: "troubleshoot.dns_fail_title",
      bodyKeys: ["troubleshoot.dns_fail_body"],
    });
  }
  if (result?.ping_attempted && result.ping_rtt_ms === null && device.ip) {
    sections.push({
      id: "dynamic_ip",
      titleKey: "troubleshoot.dynamic_ip_title",
      bodyKeys: ["troubleshoot.dynamic_ip_body"],
    });
  }
  // deep_sleep alone explains the symptom without pointing anywhere,
  // so the basics still render under it.
  if (
    sections.length === 0 ||
    (sections.length === 1 && sections[0].id === "deep_sleep")
  ) {
    sections.push({
      id: "generic",
      titleKey: "troubleshoot.generic_title",
      bodyKeys: ["troubleshoot.generic_body"],
    });
  }
  sections.push({
    id: "use_address",
    titleKey: "troubleshoot.use_address_title",
    bodyKeys: ["troubleshoot.use_address_body"],
    docsUrl: USE_ADDRESS_DOCS_URL,
    showUseAddressForm: true,
  });
  return sections;
}

function mdnsNeverSeen(
  reachability: ReachabilityStateEvent | null,
  result: DeviceTroubleshootResult | null
): boolean {
  if (reachability !== null && reachability.mdns_last_seen_seconds_ago !== null) {
    return false;
  }
  if (result === null) return reachability !== null;
  return !result.mdns_has_cached_trace && result.mdns_addresses.length === 0;
}

function mqttStale(reachability: ReachabilityStateEvent | null): boolean {
  if (reachability === null) return true;
  const age = reachability.mqtt_last_seen_seconds_ago;
  return age === null || age > MQTT_STALE_AFTER_SECONDS;
}
