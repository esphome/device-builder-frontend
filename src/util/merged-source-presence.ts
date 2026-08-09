import { yamlHasMergedSources } from "./config-entry-yaml-scan.js";

/**
 * Widen a present-components set with the backend-resolved list when the
 * YAML root-merges sources the top-level scan can't see (packages: / <<:).
 *
 * For a plain config the scan is complete and live, so the resolved set is
 * deliberately ignored: deleting a block in the buffer must re-flag its
 * dependents immediately. On a merged config the mirror-image staleness is
 * accepted: a just-deleted local block stays satisfied until the backend
 * re-resolves on save, where validation is the final arbiter.
 */
export function withMergedSourcePresence(
  present: ReadonlySet<string>,
  yaml: string,
  resolvedComponents: readonly string[]
): ReadonlySet<string> {
  if (resolvedComponents.length === 0 || !yamlHasMergedSources(yaml)) return present;
  const widened = new Set(present);
  for (const id of resolvedComponents) widened.add(id);
  return widened;
}
