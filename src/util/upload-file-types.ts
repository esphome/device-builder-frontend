/** File types the device-create wizard's "Import from file" accepts. */

export const YAML_EXTENSIONS = [".yaml", ".yml"];

/** Bundle archives (binary): an `esphome bundle` .tar.gz. */
export const BUNDLE_EXTENSIONS = [".tar.gz", ".tgz", ".esphomebundle"];

/** Extensions accepted by drag-drop (matched against the filename directly). */
export const ACCEPTED_UPLOAD_EXTENSIONS = [...YAML_EXTENSIONS, ...BUNDLE_EXTENSIONS];

/** Value for the file input's `accept` attribute.
 *
 * Adds bare `.gz` on top of the real extensions: macOS' native file dialog
 * filters on the *last* extension only, so a compound `.tar.gz` /
 * `.esphomebundle.tar.gz` is greyed out without it. Drag-drop matches the
 * whole filename (see `isBundleFilename`) and doesn't need the widening.
 */
export const FILE_INPUT_ACCEPT = [...ACCEPTED_UPLOAD_EXTENSIONS, ".gz"].join(",");

/** True when *filename* is a bundle archive rather than a text YAML config. */
export function isBundleFilename(filename: string): boolean {
  const lower = filename.toLowerCase();
  return BUNDLE_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

/** True when *filename* is a plain YAML config. */
export function isYamlFilename(filename: string): boolean {
  const lower = filename.toLowerCase();
  return YAML_EXTENSIONS.some((ext) => lower.endsWith(ext));
}
