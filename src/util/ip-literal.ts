/**
 * Bare IP-literal shape checks, dependency-free so advice derivation
 * and YAML helpers can share them without pulling each other in.
 */

export const IPV4_RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
// Loose shape check: hex groups and colons; esphome validates properly
// at compile time.
export const IPV6_RE = /^[0-9a-f]{0,4}(:[0-9a-f]{0,4}){2,7}$/i;

/** Loose IPv6 shape: one optional `::` run; without it, exactly 8 hextets. */
export function isIpv6Shape(value: string): boolean {
  if (value.includes(":::") || value.split("::").length > 2) return false;
  // A bare leading/trailing colon is only valid as part of `::`.
  if (value.startsWith(":") && !value.startsWith("::")) return false;
  if (value.endsWith(":") && !value.endsWith("::")) return false;
  if (!IPV6_RE.test(value)) return false;
  return value.includes("::") || value.split(":").length === 8;
}

/** True for a bare IPv4/IPv6 literal (not a hostname). */
export function isIpLiteral(value: string): boolean {
  if (/^[\d.]+$/.test(value)) {
    const v4 = IPV4_RE.exec(value);
    // A zero-padded octet is ambiguous: glibc's inet_aton reads it as
    // octal (192.168.010.1 -> 192.168.8.1), other stacks reject it.
    return (
      v4 !== null &&
      v4
        .slice(1)
        .every(
          (octet) => Number(octet) <= 255 && (octet.length === 1 || octet[0] !== "0")
        )
    );
  }
  return value.includes(":") && isIpv6Shape(value);
}
