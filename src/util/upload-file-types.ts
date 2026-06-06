/** File types the device-create wizard's "Import from file" accepts. */

export const YAML_EXTENSIONS = [".yaml", ".yml"];

/** Bundle archives (binary): an `esphome bundle` .tar.gz. */
export const BUNDLE_EXTENSIONS = [".tar.gz", ".tgz", ".esphomebundle"];

/** Value for the file input's `accept` attribute. */
export const ACCEPTED_UPLOAD_EXTENSIONS = [...YAML_EXTENSIONS, ...BUNDLE_EXTENSIONS];

/** True when *filename* is a bundle archive rather than a text YAML config. */
export function isBundleFilename(filename: string): boolean {
  const lower = filename.toLowerCase();
  return BUNDLE_EXTENSIONS.some((ext) => lower.endsWith(ext));
}
