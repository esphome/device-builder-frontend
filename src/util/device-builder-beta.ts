/**
 * Whether the Device Builder backend is a pre-release build.
 *
 * Stable versions are pure dotted digits (``0.1.0``); any PEP 440
 * pre-release / dev / local suffix (``0.1.0b117``, ``0.2.0.dev3+g…``)
 * counts as beta. An empty or ``0.0.0`` version is unknown → assume beta.
 */
export function isDeviceBuilderBeta(version: string): boolean {
  const v = version.trim().replace(/^v/, "");
  if (!v || v === "0.0.0") return true;
  return !/^\d+(\.\d+)*$/.test(v);
}
