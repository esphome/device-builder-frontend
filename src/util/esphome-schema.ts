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

/** Module-level cache. Keyed by bundle name (``esphome``, ``sensor``,
 *  ``binary_sensor``, …); each entry is the resolved ``Promise`` so
 *  in-flight fetches are deduplicated and second callers wait on the
 *  same network round-trip. ``null`` is a *successful* sentinel for
 *  "fetch failed; degrade gracefully" — distinct from an absent key
 *  which means "haven't tried yet". */
const cache = new Map<string, Promise<SchemaBundle | null>>();

let activeVersion: string = "dev";
let versionResolved = false;

/**
 * Reset the in-memory cache. Test-only entry point — production
 * callers should never need to invalidate; the schema host serves
 * the same bundle for the lifetime of an ESPHome version.
 */
export function _resetSchemaCacheForTests() {
  cache.clear();
  activeVersion = "dev";
  versionResolved = false;
}

/**
 * Resolve the schema version to ask schema.esphome.io for. Mirrors
 * the legacy ``setSchemaVersion`` behaviour: the dashboard's
 * reported ``esphome_version`` is the authoritative answer, but if
 * that build hasn't published a schema yet we fall back to ``dev``
 * (the rolling latest). Probes the host with a HEAD on
 * ``esphome.json`` to confirm; any failure → fall back to ``dev``.
 */
async function resolveVersion(api: ESPHomeAPI): Promise<string> {
  if (versionResolved) return activeVersion;
  try {
    const { esphome_version } = await api.getVersion();
    if (esphome_version.endsWith("dev")) {
      activeVersion = "dev";
    } else {
      const probe = await fetch(
        `${SCHEMA_HOST}/${esphome_version}/esphome.json`,
        { method: "HEAD" },
      );
      activeVersion = probe.ok ? esphome_version : "dev";
    }
  } catch {
    /* HEAD probe (or getVersion) failed — likely CSP / offline /
       host down. Fall through to ``dev`` so subsequent
       ``fetchBundle`` calls still get a chance against the rolling
       schema. */
    activeVersion = "dev";
  }
  versionResolved = true;
  return activeVersion;
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
  const cached = cache.get(name);
  if (cached) return cached;
  const promise = (async () => {
    try {
      const version = await resolveVersion(api);
      const res = await fetch(`${SCHEMA_HOST}/${version}/${name}.json`);
      if (!res.ok) return null;
      const data = (await res.json()) as SchemaBundle;
      return data;
    } catch (err) {
      console.debug(`[esphome-schema] failed to fetch ${name}.json:`, err);
      return null;
    }
  })();
  cache.set(name, promise);
  // Evict failed lookups so a transient outage / CSP toggle / network
  // hiccup doesn't poison the cache for the lifetime of the page —
  // the next caller retries. Successful entries stay cached for the
  // session (the schema host serves the same bundle per version).
  promise.then((value) => {
    if (value === null && cache.get(name) === promise) {
      cache.delete(name);
    }
  });
  return promise;
}

/**
 * Read the trigger keys (``on_boot``, ``on_press``, …) declared on
 * a component's ``CONFIG_SCHEMA``. Returns an empty array if the
 * schema fails to load or the component has no trigger config-vars.
 */
export async function getTriggerKeys(
  api: ESPHomeAPI,
  bundleName: string,
  componentKey: string,
): Promise<{ key: string; docs?: string }[]> {
  const bundle = await fetchBundle(api, bundleName);
  if (!bundle) return [];
  const component = bundle[componentKey];
  if (!component) return [];
  const schema = (component as SchemaComponent).schemas?.CONFIG_SCHEMA?.schema;
  if (!schema?.config_vars) return [];
  const out: { key: string; docs?: string }[] = [];
  for (const [key, cv] of Object.entries(schema.config_vars)) {
    if (cv && cv.type === "trigger") {
      out.push({ key, docs: cv.docs });
    }
  }
  return out;
}

export interface SchemaAction {
  /** Dotted key as the user types it: ``logger.log``, ``light.turn_on``,
   *  or just ``delay`` / ``if`` / ``lambda`` for core actions. */
  key: string;
  docs?: string;
}

/**
 * Aggregate the action-registry entries reachable from the components
 * actually present in *bundleNames*. Mirrors the legacy dashboard's
 * ``getRegistry("action", doc)`` behaviour: only suggest actions
 * contributed by components the user is editing, so a config that
 * touches ``logger:`` and ``light:`` gets ``logger.log`` and
 * ``light.turn_on`` but not ``sensor.*`` actions if no sensor block
 * is configured.
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
): Promise<SchemaAction[]> {
  const bundles = await Promise.all(
    bundleNames.map((name) => fetchBundle(api, name)),
  );
  const out: SchemaAction[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < bundles.length; i++) {
    const bundle = bundles[i];
    if (!bundle) continue;
    for (const [componentName, component] of Object.entries(bundle)) {
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
