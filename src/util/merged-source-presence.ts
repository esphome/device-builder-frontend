import { yamlHasMergedSources } from "./config-entry-yaml-scan.js";

/**
 * Widen a YAML-scanned presence set with the backend-resolved list when the
 * YAML root-merges sources the scan can't see (packages: / <<:). Serves both
 * id shapes: bare components against `loaded_integrations`, and dotted
 * `domain.platform` pairs against `loaded_platforms`.
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
  resolved: readonly string[]
): ReadonlySet<string> {
  if (resolved.length === 0 || !yamlHasMergedSources(yaml)) return present;
  const widened = new Set(present);
  for (const id of resolved) widened.add(id);
  return widened;
}
