export type DeviceBuilderChannel = "dev" | "beta";

/**
 * Classify the Device Builder backend version's release channel.
 *
 * Returns ``null`` for a stable release (pure dotted digits like
 * ``1.0.0``) and for an unknown version (``null`` / ``undefined``, i.e.
 * no channel is determinable). An empty/whitespace or ``0.0.0`` version,
 * or any ``dev`` marker, is ``"dev"``; anything else with a non-numeric
 * suffix (``0.1.0b117``, ``0.2.0rc1``) is ``"beta"``.
 */
export function deviceBuilderChannel(
  version: string | null | undefined
): DeviceBuilderChannel | null {
  if (version == null) return null;
  const v = version.trim().replace(/^v/, "");
  if (!v || v === "0.0.0" || /dev/i.test(v)) return "dev";
  if (!/^\d+(\.\d+)*$/.test(v)) return "beta";
  return null;
}
