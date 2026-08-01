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

/** Bare block header (`wifi:`), optionally with a trailing comment. A
 *  header carrying an inline value (`wifi: !include net.yaml`) is not
 *  spliceable and must not match. */
const BARE_HEADER_RES = new Map(
  NETWORK_SECTIONS.map((section) => [
    section,
    new RegExp(String.raw`^${section}:[ \t]*(#.*)?$`, "m"),
  ])
);

/** First network block spliceable as a top-level mapping, or null. */
export function findNetworkSection(yaml: string): NetworkSection | null {
  for (const section of NETWORK_SECTIONS) {
    if (BARE_HEADER_RES.get(section)!.test(yaml)) return section;
  }
  return null;
}

/** Best-guess network key for the copyable snippet when nothing is
 *  spliceable: any mention in the raw text wins (an `!include` header
 *  still names the right block), then the compiled integrations, then
 *  wifi. */
export function snippetNetworkSection(
  yaml: string,
  loadedIntegrations: string[]
): NetworkSection {
  const lines = yaml.split("\n");
  for (const section of NETWORK_SECTIONS) {
    if (findSectionStart(lines, section) >= 0) return section;
  }
  for (const section of NETWORK_SECTIONS) {
    if (loadedIntegrations.includes(section)) return section;
  }
  return "wifi";
}

/** Splice `use_address: value` into the network block; null when there is none. */
export function applyUseAddress(yaml: string, value: string): string | null {
  const section = findNetworkSection(yaml);
  if (section === null) return null;
  const parsed = parseSectionCore(yaml.split("\n"), section);
  return updateSectionInYaml(yaml, section, { ...parsed.values, use_address: value });
}

/** True for a bare IPv4/IPv6 literal (not a hostname). */
export function isIpLiteral(value: string): boolean {
  if (/^[\d.]+$/.test(value)) {
    const v4 = IPV4_RE.exec(value);
    return v4 !== null && v4.slice(1).every((octet) => Number(octet) <= 255);
  }
  return value.includes(":") && IPV6_RE.test(value);
}

/** Accept an IPv4/IPv6 literal or an RFC-1123 hostname.

 *  Loopback and unspecified addresses are rejected: they point at the
 *  dashboard host itself, and the always-answering ping would latch
 *  the device Online forever. */
export function isValidUseAddress(value: string): boolean {
  if (value.length === 0 || value.length > 253) return false;
  const lower = value.toLowerCase();
  if (lower === "localhost" || lower === "::1" || lower === "::") return false;
  if (/^127\./.test(value) || /^0\.0\.0\.0$/.test(value)) return false;
  if (/^[\d.]+$/.test(value)) {
    // All digits and dots is an IPv4 attempt, not a hostname; a typo
    // like 255.42.2.1.3 must not slip through the hostname rule.
    const v4 = IPV4_RE.exec(value);
    return v4 !== null && v4.slice(1).every((octet) => Number(octet) <= 255);
  }
  if (value.includes(":")) return IPV6_RE.test(value);
  return HOSTNAME_RE.test(value);
}
