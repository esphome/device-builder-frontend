/**
 * Ordered, device-specific advice for the offline troubleshooting
 * dialog. Pure derivation from the device row, the live reachability
 * snapshot, and the on-demand probe result — most-specific first, so
 * the first section is the likeliest explanation.
 */
import type { ConfiguredDevice } from "../api/types/devices.js";
import type { ReachabilityStateEvent } from "../api/types/reachability.js";
import type { DeviceTroubleshootResult } from "../api/types/troubleshoot.js";
import { isIpLiteral } from "./ip-literal.js";

export const MAC_SUFFIX_DOCS_URL =
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
  /** The config's current `use_address`, empty when unset. */
  existingAddress: string;
}

/** The DNS verdict carries evidence: the leg completed and the address
 *  is a name that can fail to resolve, not an IP literal. */
export function dnsVerdictMeaningful(result: DeviceTroubleshootResult): boolean {
  return (
    !result.dns_inconclusive && Boolean(result.address) && !isIpLiteral(result.address)
  );
}

/** A reply at the sidecar-persisted IP proves reachability of the
 *  address, not identity. */
export function pingReplyUnverified(result: DeviceTroubleshootResult): boolean {
  return result.ping_rtt_ms !== null && result.ping_target_source === "persisted";
}

/** A miss at a last-known address (RAM or sidecar) is evidence about
 *  that address; a miss at a live resolve says nothing about leases. */
export function pingMissAtKnownAddress(result: DeviceTroubleshootResult): boolean {
  return (
    result.ping_attempted &&
    result.ping_rtt_ms === null &&
    (result.ping_target_source === "runtime" || result.ping_target_source === "persisted")
  );
}

export function buildTroubleshootSections(
  input: TroubleshootInput
): TroubleshootSection[] {
  const { device, reachability, result, inDocker, existingAddress } = input;
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
  if (existingAddress) {
    // A manual address sidelines mDNS entirely; diagnosing mDNS
    // darkness or DHCP churn would point away from the real lever.
    sections.push({
      id: "use_address_set",
      titleKey: "troubleshoot.use_address_set_title",
      bodyKeys: ["troubleshoot.use_address_set_body"],
    });
  } else if (device.mdns_disabled) {
    // The config never broadcasts by design; VLAN/reflector advice
    // would send the user chasing a network problem that isn't there.
    sections.push({
      id: "mdns_disabled",
      titleKey: "troubleshoot.mdns_disabled_title",
      bodyKeys: ["troubleshoot.mdns_disabled_body"],
      docsUrl: FAQ_MDNS_URL,
    });
  } else if (result && !result.zeroconf_running) {
    sections.push({
      id: "zeroconf_down",
      titleKey: "troubleshoot.zeroconf_down_title",
      bodyKeys: ["troubleshoot.zeroconf_down_body"],
    });
  } else if (mdnsNeverSeen(reachability, result)) {
    // Applies to non-api devices too: their `_http._tcp` broadcast is
    // just as mDNS-borne, and the probe's evidence is hostname-level.
    sections.push({
      id: "mdns_dark",
      titleKey: "troubleshoot.mdns_dark_title",
      bodyKeys: inDocker
        ? ["troubleshoot.mdns_dark_docker_body", "troubleshoot.mdns_dark_vlan_body"]
        : ["troubleshoot.mdns_dark_body", "troubleshoot.mdns_dark_vlan_body"],
      // The Docker-reference FAQ note also carries the VLAN/reflector
      // guidance, so it fits both flavors of network-level darkness.
      docsUrl: FAQ_DOCKER_URL,
    });
  }
  if (device.uses_mqtt && mqttStale(reachability)) {
    sections.push({
      id: "mqtt",
      titleKey: "troubleshoot.mqtt_title",
      bodyKeys: ["troubleshoot.mqtt_body"],
    });
  }
  if (result && !result.dns_resolved && dnsVerdictMeaningful(result)) {
    sections.push({
      id: "dns_fail",
      titleKey: "troubleshoot.dns_fail_title",
      bodyKeys: ["troubleshoot.dns_fail_body"],
    });
  }
  if (
    result &&
    pingReplyUnverified(result) &&
    !result.dns_resolved &&
    result.mdns_addresses.length === 0
  ) {
    sections.push({
      id: "unverified_ping",
      titleKey: "troubleshoot.unverified_ping_title",
      bodyKeys: ["troubleshoot.unverified_ping_body"],
    });
  }
  if (!existingAddress && result && pingMissAtKnownAddress(result) && device.ip) {
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
  // Rendered as a drill row (title only); the address screen owns its
  // own body copy and docs link.
  sections.push({
    id: "use_address",
    titleKey: "troubleshoot.use_address_title",
    bodyKeys: [],
    showUseAddressForm: true,
  });
  return sections;
}

function mdnsNeverSeen(
  reachability: ReachabilityStateEvent | null,
  result: DeviceTroubleshootResult | null
): boolean {
  if (result?.mdns_inconclusive) return false;
  if (reachability !== null && reachability.mdns_last_seen_seconds_ago !== null) {
    return false;
  }
  if (result === null) return reachability !== null;
  return !result.mdns_has_cached_trace && result.mdns_addresses.length === 0;
}

function mqttStale(reachability: ReachabilityStateEvent | null): boolean {
  // No snapshot yet is unknown, not evidence of a stale link.
  if (reachability === null) return false;
  const age = reachability.mqtt_last_seen_seconds_ago;
  return age === null || age > MQTT_STALE_AFTER_SECONDS;
}
