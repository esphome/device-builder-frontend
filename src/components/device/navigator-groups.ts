import type { YamlSection } from "../../util/yaml-sections.js";
import type { NavRow } from "./navigator-labels.js";

/** A lone config block (i2c) renders as a flat row, not a domain subgroup;
 *  a lone platform component keeps its header. */
export function isFlatDomain(count: number, item: YamlSection): boolean {
  return count === 1 && !item.platform;
}

/** Rows of one domain (the YAML key, e.g. ``sensor``). */
export interface NavGroup {
  key: string;
  rows: NavRow[];
}

/** Group rows by domain (``item.key``), groups and rows in
 *  first-appearance order. */
export function groupRowsByDomain(rows: NavRow[]): NavGroup[] {
  const order: string[] = [];
  const byKey = new Map<string, NavRow[]>();
  for (const row of rows) {
    const key = row.item.key;
    let bucket = byKey.get(key);
    if (!bucket) {
      bucket = [];
      byKey.set(key, bucket);
      order.push(key);
    }
    bucket.push(row);
  }
  return order.map((key) => ({ key, rows: byKey.get(key)! }));
}
