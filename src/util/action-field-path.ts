import { isIndexSegment } from "./nested-values.js";

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
export function splitActionFieldPath(field: string): (string | number)[] {
  return field.split(".").map((seg) => (isIndexSegment(seg) ? Number(seg) : seg));
}

/** The leaf key naming the action list (`…set_action` → `set_action`). */
export function actionFieldLeaf(field: string): string {
  const segments = field.split(".");
  return segments[segments.length - 1];
}
