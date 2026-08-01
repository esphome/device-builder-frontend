/**
 * Write `use_address` into a config's network block for the
 * troubleshooting dialog's manual-address fix. Splices through the
 * section machinery so comments and untouched keys survive; a config
 * whose network block lives in a package/include can't be spliced and
 * falls back to a copyable snippet in the dialog.
 */
import { findSectionStart, parseSectionCore } from "./yaml-section-reader.js";
import { updateSectionInYaml } from "./yaml-section-values.js";

/** esphome components that accept `use_address`, in pick order. */
export const NETWORK_SECTIONS = ["wifi", "ethernet", "openthread"] as const;
export type NetworkSection = (typeof NETWORK_SECTIONS)[number];

const IPV4_RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
// Loose shape check: hex groups and colons with at least one colon;
// esphome validates properly at compile time.
const IPV6_RE = /^[0-9a-f]{0,4}(:[0-9a-f]{0,4}){2,7}$/i;
const HOSTNAME_RE =
  /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/i;

/** First network block present as a top-level key in the raw text, or null. */
export function findNetworkSection(yaml: string): NetworkSection | null {
  const lines = yaml.split("\n");
  for (const section of NETWORK_SECTIONS) {
    if (findSectionStart(lines, section) >= 0) return section;
  }
  return null;
}

/** Splice `use_address: value` into the network block; null when there is none. */
export function applyUseAddress(yaml: string, value: string): string | null {
  const section = findNetworkSection(yaml);
  if (section === null) return null;
  const parsed = parseSectionCore(yaml.split("\n"), section);
  return updateSectionInYaml(yaml, section, { ...parsed.values, use_address: value });
}

/** Accept an IPv4/IPv6 literal or an RFC-1123 hostname. */
export function isValidUseAddress(value: string): boolean {
  if (value.length === 0 || value.length > 253) return false;
  const v4 = IPV4_RE.exec(value);
  if (v4 !== null) return v4.slice(1).every((octet) => Number(octet) <= 255);
  if (value.includes(":")) return IPV6_RE.test(value);
  return HOSTNAME_RE.test(value);
}
