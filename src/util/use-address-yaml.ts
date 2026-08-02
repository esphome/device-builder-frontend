/**
 * Write `use_address` into a config's network block for the
 * troubleshooting dialog's manual-address fix. Splices through the
 * section machinery so comments and untouched keys survive; a config
 * with no local network block at all (`packages:` include) gets a new
 * block appended that deep-merges per-device; a network header that is
 * not a bare mapping key (`wifi: !include net.yaml`) falls back to a
 * copyable snippet.
 */
import { yamlHasMergedSources } from "./config-entry-yaml-scan.js";
import { isIpLiteral, isIpv6Shape } from "./ip-literal.js";
import {
  NETWORK_SECTIONS,
  type NetworkPresence,
  type NetworkSection,
} from "./network-sections.js";
import { splitYamlDocLines } from "./yaml-doc-lines.js";
import { BARE_MAPPING_KEY_RE } from "./yaml-section-lexer.js";
import { findSectionStart, parseSectionCore } from "./yaml-section-reader.js";
import { appendSectionToYaml, updateSectionInYaml } from "./yaml-section-values.js";

const HOSTNAME_RE =
  /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/i;

export type ApplyUseAddressResult =
  { yaml: string } | { snippet: NetworkSection } | { noNetwork: true };

/**
 * Splice `use_address: value` into the local network block, or append a
 * new block that deep-merges with a `packages:`-supplied one.

 * A network header that is not a bare mapping key (`wifi: !include
 * net.yaml`) yields `{snippet}`: a second top-level header beside it
 * would be a duplicate key. A config with no network component
 * anywhere yields `{noNetwork}` — appending a bare `wifi:` block to
 * it would not compile.
 */
export function applyUseAddress(
  yaml: string,
  value: string,
  loadedIntegrations: string[]
): ApplyUseAddressResult {
  const lines = splitYamlDocLines(yaml);
  const section = findSpliceableSection(lines);
  if (section !== null) {
    const values = cloneSectionValues(lines, section);
    values.use_address = value;
    return { yaml: updateSectionInYaml(yaml, section, values) };
  }
  const header = firstHeaderSection(lines);
  if (header !== null) return { snippet: header };
  const target = NETWORK_SECTIONS.find((candidate) =>
    loadedIntegrations.includes(candidate)
  );
  if (target === undefined) return { noNetwork: true };
  return { yaml: appendSectionToYaml(yaml, target, { use_address: value }) };
}

/**
 * One-parse read of the address form's inputs and the YAML's network
 * classification.

 * `presence` is `present` for any network header (inline `!include`
 * included), `unknown` when merged sources (`packages:` / `<<:`) could
 * supply one from another file, else the definitive `absent`.
 * `useAddress` is null when nothing is spliceable and empty when the
 * key isn't set; `staticIp` is the block's `manual_ip.static_ip` — the
 * firmware already knows its fixed IP, so it is the best prefill.
 */
export function readAddressPrefill(yaml: string): {
  presence: NetworkPresence;
  useAddress: string | null;
  staticIp: string | null;
} {
  const lines = splitYamlDocLines(yaml);
  const section = findSpliceableSection(lines);
  if (section === null) {
    const presence: NetworkPresence =
      firstHeaderSection(lines) !== null
        ? "present"
        : yamlHasMergedSources(yaml)
          ? "unknown"
          : "absent";
    return { presence, useAddress: null, staticIp: null };
  }
  const values = parseSectionCore(lines, section).values;
  const raw = values.use_address;
  const useAddress =
    typeof raw === "string" || typeof raw === "number" ? String(raw) : "";
  // wifi and ethernet both take manual_ip; openthread has none and
  // falls out of staticIpOf naturally.
  return { presence: "present", useAddress, staticIp: staticIpOf(values) };
}

/** Remove `use_address` from the network block; null when nothing is
 *  spliceable, the unchanged YAML when the key isn't set. */
export function removeUseAddress(yaml: string): string | null {
  const lines = splitYamlDocLines(yaml);
  const section = findSpliceableSection(lines);
  if (section === null) return null;
  const values = cloneSectionValues(lines, section);
  if (!("use_address" in values)) return yaml;
  delete values.use_address;
  return updateSectionInYaml(yaml, section, values);
}

/** Accept an IPv4/IPv6 literal or an RFC-1123 hostname.

 *  Loopback and unspecified addresses are rejected: they point at the
 *  dashboard host itself, and the always-answering ping would latch
 *  the device Online forever. */
export function isValidUseAddress(value: string): boolean {
  if (value.length === 0 || value.length > 253) return false;
  if (value.toLowerCase() === "localhost") return false;
  if (/^127\./.test(value) || value === "0.0.0.0") return false;
  if (/^[\d.]+$/.test(value)) {
    // All digits and dots is an IPv4 attempt, not a hostname; a typo
    // like 255.42.2.1.3 must not slip through the hostname rule.
    return isIpLiteral(value);
  }
  if (value.includes(":")) {
    // Loopback/unspecified in any compression (::1, 0:0:0:0:0:0:0:1).
    if (/^[0:]+1?$/.test(value)) return false;
    return isIpv6Shape(value);
  }
  return HOSTNAME_RE.test(value);
}

function findSpliceableSection(lines: string[]): NetworkSection | null {
  for (const section of NETWORK_SECTIONS) {
    const start = findSectionStart(lines, section);
    if (start >= 0 && BARE_MAPPING_KEY_RE.test(lines[start])) return section;
  }
  return null;
}

/** First network header in pick order, bare or inline-valued. */
function firstHeaderSection(lines: string[]): NetworkSection | null {
  for (const section of NETWORK_SECTIONS) {
    if (findSectionStart(lines, section) >= 0) return section;
  }
  return null;
}

// Keep the parser's null prototype so a YAML key named __proto__ stays
// inert data (see parseSectionCore).
function cloneSectionValues(
  lines: string[],
  section: NetworkSection
): Record<string, unknown> {
  return Object.assign(Object.create(null), parseSectionCore(lines, section).values);
}

function staticIpOf(values: Record<string, unknown>): string | null {
  const manual = values.manual_ip;
  if (manual === null || typeof manual !== "object") return null;
  const value = (manual as Record<string, unknown>).static_ip;
  return typeof value === "string" && value.length > 0 ? value : null;
}
