/**
 * Lazy fetcher for the ESPHome schema bundle hosted at
 * ``https://schema.esphome.io/<version>/<name>.json``.
 *
 * Mirrors the legacy ``~/dashboard``'s ``ESPHomeSchema`` / coreSchema
 * pattern: pull the core ``esphome.json`` on first call, then fetch
 * per-component bundles on demand. The bundle carries the *typed*
 * schema (``type: "trigger"`` / ``"registry"`` / ``"schema"`` / …)
 * the new dashboard's flattened ``components.json`` doesn't —
 * notably ``on_*`` triggers and the per-component ``action`` /
 * ``condition`` / ``filter`` / ``effects`` registries that drive
 * completion inside automation bodies (``then:`` → ``- ...``).
 *
 * Graceful degradation: every entry point returns ``null`` on any
 * failure (CSP block, network error, non-2xx response, malformed
 * JSON). Callers fall back to whatever they had before — the
 * editor's existing component-catalog completion stays the floor,
 * the schema-driven extras stack on top when reachable.
 */
import type { ESPHomeAPI } from "../api/esphome-api.js";

const SCHEMA_HOST = "https://schema.esphome.io";

/**
 * Tagged union of the schema's ``ConfigVar`` shapes. Mirrors the
 * legacy dashboard's ``esphome-schema.ts`` types — kept as a
 * ``Partial<>``-flavoured set because the bundle has long-tail
 * fields we don't consume here.
 */
export interface SchemaConfigVarBase {
  key?: string;
  is_list?: boolean;
  docs?: string;
  templatable?: boolean;
}

export interface SchemaConfigVarTrigger extends SchemaConfigVarBase {
  type: "trigger";
  schema?: SchemaSchema;
  has_required_var?: boolean;
}

export interface SchemaConfigVarSchema extends SchemaConfigVarBase {
  type: "schema";
  schema: SchemaSchema;
}

export interface SchemaConfigVarRegistry extends SchemaConfigVarBase {
  type: "registry";
  registry: string;
  filter?: string[];
}

export interface SchemaConfigVarOther extends SchemaConfigVarBase {
  type:
    | "enum"
    | "typed"
    | "pin"
    | "boolean"
    | "string"
    | "integer"
    | "use_id";
  schema?: SchemaSchema;
}

export type SchemaConfigVar =
  | SchemaConfigVarTrigger
  | SchemaConfigVarSchema
  | SchemaConfigVarRegistry
  | SchemaConfigVarOther;

export interface SchemaSchema {
  config_vars: Record<string, SchemaConfigVar | undefined>;
  extends?: string[];
}

export interface SchemaComponent {
  schemas?: Record<string, SchemaConfigVar | undefined> & {
    CONFIG_SCHEMA?: SchemaConfigVarSchema;
  };
  components?: Record<string, { docs?: string; dependencies?: string[] } | undefined>;
  action?: Record<string, SchemaConfigVar | undefined>;
  condition?: Record<string, SchemaConfigVar | undefined>;
  filter?: Record<string, SchemaConfigVar | undefined>;
  effects?: Record<string, SchemaConfigVar | undefined>;
}

export interface SchemaCore extends SchemaComponent {
  platforms?: Record<string, { docs?: string } | undefined>;
  components?: Record<
    string,
    { docs?: string; dependencies?: string[] } | undefined
  >;
}

export interface SchemaBundle {
  core?: SchemaCore;
  // Component-keyed entries: ``esphome``, ``wifi``, ``logger``, …
  // and per-platform sub-keys like ``sensor.dht``.
  [name: string]: SchemaComponent | SchemaCore | undefined;
}

/** Module-level bundle cache. Keyed by ``<version>/<name>`` so a
 *  multi-tenant session that switches devices (different
 *  ``esphome_version``) can't reuse cached bundles from the wrong
 *  version. Each entry is the resolved ``Promise`` so in-flight
 *  fetches are deduplicated and second callers wait on the same
 *  network round-trip. ``null`` is a successful sentinel for
 *  "fetch failed; degrade gracefully" — distinct from an absent
 *  key which means "haven't tried yet". */
const cache = new Map<string, Promise<SchemaBundle | null>>();

/** In-flight version-resolution promise. Stored as a promise so
 *  concurrent callers wait on the same answer; cleared on
 *  failure so the next caller retries (Copilot-flagged: marking
 *  versionResolved=true on failure made version negotiation
 *  non-retriable for the page lifetime — inconsistent with the
 *  bundle cache's transient-eviction behaviour). */
let versionPromise: Promise<string> | null = null;

/**
 * Reset the in-memory cache. Test-only entry point — production
 * callers should never need to invalidate; the schema host serves
 * the same bundle for the lifetime of an ESPHome version.
 */
export function _resetSchemaCacheForTests() {
  cache.clear();
  versionPromise = null;
}

/**
 * Resolve the schema version to ask schema.esphome.io for. Mirrors
 * the legacy ``setSchemaVersion`` behaviour: the dashboard's
 * reported ``esphome_version`` is the authoritative answer, but if
 * that build hasn't published a schema yet we fall back to ``dev``
 * (the rolling latest). Probes the host with a HEAD on
 * ``esphome.json`` to confirm.
 *
 * On any failure (offline / CSP / DNS), the promise is *evicted*
 * so the next caller retries — no permanent stuck-on-``dev``
 * state when conditions change.
 */
async function resolveVersion(api: ESPHomeAPI): Promise<string> {
  if (versionPromise) return versionPromise;
  const promise = (async () => {
    const { esphome_version } = await api.getVersion();
    if (esphome_version.endsWith("dev")) return "dev";
    const probe = await fetch(
      `${SCHEMA_HOST}/${esphome_version}/esphome.json`,
      { method: "HEAD" },
    );
    return probe.ok ? esphome_version : "dev";
  })();
  versionPromise = promise;
  // Evict on failure so subsequent calls retry. A successful
  // resolution stays cached for the session — the dashboard's
  // ``esphome_version`` doesn't change without a page reload.
  promise.catch(() => {
    if (versionPromise === promise) versionPromise = null;
  });
  return promise;
}

/**
 * Fetch one schema bundle (e.g. ``esphome``, ``sensor``,
 * ``binary_sensor``). Resolves to the parsed JSON on success or
 * ``null`` on any failure — callers gracefully skip the
 * schema-driven extras when ``null``.
 */
export function fetchBundle(
  api: ESPHomeAPI,
  name: string,
): Promise<SchemaBundle | null> {
  // First-line dedupe: concurrent callers asking for the same
  // bundle name (before we know the version) share one promise.
  // Once the version resolves, the entry gets re-keyed under
  // ``<version>/<name>`` so a later session-swap with a
  // different ``esphome_version`` can't reuse the wrong cache.
  const inflight = cache.get(name);
  if (inflight) return inflight;
  // ``transient`` flips to false when we get a definitive
  // "this bundle doesn't exist" answer (404). Transient failures
  // (thrown — CSP / DNS / offline — or 5xx) stay evictable so the
  // next caller can retry when conditions change; permanent
  // failures stay cached so we don't retry-storm against a URL
  // that's never going to resolve (e.g. a component name the
  // schema host doesn't carry).
  let transient = true;
  let cacheKey: string | null = null;
  const promise = (async () => {
    try {
      const version = await resolveVersion(api);
      cacheKey = `${version}/${name}`;
      // After resolving the version, an earlier caller may have
      // already cached this bundle under the version-keyed key
      // — return that result directly.
      const versioned = cache.get(cacheKey);
      if (versioned && versioned !== promise) return versioned;
      const res = await fetch(`${SCHEMA_HOST}/${version}/${name}.json`);
      if (res.status === 404) {
        transient = false;
        return null;
      }
      if (!res.ok) return null;
      const data = (await res.json()) as SchemaBundle;
      return data;
    } catch (err) {
      console.debug(`[esphome-schema] failed to fetch ${name}.json:`, err);
      return null;
    }
  })();
  // Register under the bare name so concurrent callers dedupe
  // before the version resolves. Once it does, swap to the
  // version-keyed entry (or evict on a transient failure).
  cache.set(name, promise);
  promise.then((value) => {
    if (cache.get(name) === promise) cache.delete(name);
    if (cacheKey) {
      const evict = value === null && transient;
      if (!evict) {
        cache.set(cacheKey, promise);
      }
    }
  });
  return promise;
}

/**
 * Read the trigger keys (``on_boot``, ``on_press``, …) for a
 * component. Walks the schema's ``extends`` chain so triggers
 * inherited from a shared parent schema (e.g.
 * ``binary_sensor._BINARY_SENSOR_SCHEMA``, where the GPIO/template/
 * etc. binary_sensor implementations all pick up ``on_press`` /
 * ``on_release`` / etc. from) are surfaced too.
 *
 * Returns an empty array if every fetch fails or no triggers are
 * found.
 */
export async function getTriggerKeys(
  api: ESPHomeAPI,
  bundleName: string,
  componentKey: string,
): Promise<{ key: string; docs?: string }[]> {
  const out: { key: string; docs?: string }[] = [];
  const seen = new Set<string>();
  await collectTriggers(
    api,
    bundleName,
    componentKey,
    "CONFIG_SCHEMA",
    out,
    seen,
    new Set(),
  );
  return out;
}

/**
 * Recursive trigger collector. ``visited`` short-circuits cycles
 * (mutual ``extends``) and shared parents reached more than once.
 * ``seenKeys`` dedupes triggers by name across the whole walk so
 * a child that overrides a parent's ``on_state`` doesn't yield it
 * twice.
 */
async function collectTriggers(
  api: ESPHomeAPI,
  bundleName: string,
  componentKey: string,
  schemaName: string,
  out: { key: string; docs?: string }[],
  seenKeys: Set<string>,
  visited: Set<string>,
): Promise<void> {
  const visitKey = `${bundleName}|${componentKey}|${schemaName}`;
  if (visited.has(visitKey)) return;
  visited.add(visitKey);

  const bundle = await fetchBundle(api, bundleName);
  if (!bundle) return;
  const component = bundle[componentKey];
  if (!component) return;
  const cv = (component as SchemaComponent).schemas?.[schemaName];
  if (!cv || typeof cv !== "object") return;
  const schema = (cv as SchemaConfigVarSchema).schema;
  if (!schema) return;

  for (const [key, varDecl] of Object.entries(schema.config_vars ?? {})) {
    if (varDecl?.type === "trigger" && !seenKeys.has(key)) {
      seenKeys.add(key);
      out.push({ key, docs: varDecl.docs });
    }
  }

  // ``extends`` references take two shapes:
  //   ``<bundle>.<schemaName>``   — e.g. ``binary_sensor._BINARY_SENSOR_SCHEMA``
  //   ``<bundle>.<comp>.<schemaName>`` — e.g.
  //                                ``gpio.binary_sensor.SOMETHING``
  // The legacy ``getExtendedConfigVar`` parses them by part-count.
  for (const ext of schema.extends ?? []) {
    const parts = ext.split(".");
    if (parts.length === 2) {
      await collectTriggers(api, parts[0], parts[0], parts[1], out, seenKeys, visited);
    } else if (parts.length === 3) {
      await collectTriggers(
        api,
        parts[0],
        `${parts[0]}.${parts[1]}`,
        parts[2],
        out,
        seenKeys,
        visited,
      );
    }
  }
}

export interface SchemaAction {
  /** Dotted key as the user types it: ``logger.log``, ``light.turn_on``,
   *  or just ``delay`` / ``if`` / ``lambda`` for core actions. */
  key: string;
  docs?: string;
}

/**
 * Aggregate the action-registry entries reachable from a specific
 * set of components. Mirrors the legacy dashboard's
 * ``getRegistry("action", doc)`` behaviour: only suggest actions
 * contributed by components the user is editing, so a config that
 * touches ``logger:`` and ``light:`` gets ``logger.log`` and
 * ``light.turn_on`` but not ``sensor.*`` actions if no sensor block
 * is configured.
 *
 * *componentKeys* is the precise set of component-name entries to
 * pull actions from inside each bundle (e.g. ``["binary_sensor",
 * "binary_sensor.gpio", "core"]``). Restricting by key is what
 * keeps the action list scoped to the user's doc — without it we'd
 * yield every component's actions inside any bundle that happened
 * to be fetched (e.g. ``binary_sensor.json`` carries ALL the
 * platform-specific schemas; we only want the ones the user is
 * actually using).
 *
 * The legacy yields each action under ``<reversedDomain>.<name>``
 * for non-``core`` registries — e.g. an action named ``turn_on``
 * registered on the ``light`` component becomes ``light.turn_on``.
 * Core actions (``delay``, ``if``, ``while``, ``lambda``,
 * ``script.execute``, …) keep their plain key. Returns ``[]`` if
 * every bundle fails to load (graceful degradation).
 */
export async function getActions(
  api: ESPHomeAPI,
  bundleNames: string[],
  componentKeys: string[],
): Promise<SchemaAction[]> {
  const bundles = await Promise.all(
    bundleNames.map((name) => fetchBundle(api, name)),
  );
  const wantedKeys = new Set(componentKeys);
  const out: SchemaAction[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < bundles.length; i++) {
    const bundle = bundles[i];
    if (!bundle) continue;
    for (const [componentName, component] of Object.entries(bundle)) {
      if (!wantedKeys.has(componentName)) continue;
      const actions = (component as SchemaComponent | undefined)?.action;
      if (!actions) continue;
      for (const [actionName, cv] of Object.entries(actions)) {
        const key =
          componentName === "core"
            ? actionName
            : `${componentName.split(".").reverse().join(".")}.${actionName}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ key, docs: cv?.docs });
      }
    }
  }
  return out;
}
