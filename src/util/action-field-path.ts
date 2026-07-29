import { isIndexSegment } from "./nested-values.js";
import type { YamlPathSegment } from "./yaml-ast.js";

/**
 * The one owner of the dotted `component_action` field encoding.
 *
 * A field is the dot-join of a config-entry path: schema keys and list
 * indices, never containing dots (unlike user map keys, which is why
 * `fieldKeyAttr` uses JSON instead), so the join is lossless. The
 * backend addresses nested action lists with the same encoding
 * (`valves.0.run_duration_number.set_action`).
 */

/** Dotted `field` string for a config-entry path. */
export function joinActionFieldPath(path: string[]): string {
  return path.join(".");
}

/** Path segments of a dotted field, indices as the numbers cursor paths carry. */
export function splitActionFieldPath(field: string): YamlPathSegment[] {
  return field.split(".").map((seg) => (isIndexSegment(seg) ? Number(seg) : seg));
}
