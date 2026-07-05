/**
 * Fetch + config-var/trigger key resolution for the ESPHome schema
 * bundle hosted at ``https://schema.esphome.io/<version>/<name>.json``.
 *
 * This is the lower layer of the schema reader: the bundle/version
 * cache, the network fetch (``resolveVersion`` / ``fetchBundle``),
 * the schema type union, and the recursive collectors that walk a
 * component's ``extends`` chain to surface its config-var keys
 * (``getConfigVarKeys``) and triggers (``getTriggerKeys``). The
 * specialised lookups that build on these — nested-path docs, enum
 * values, and the action/registry tables — live in
 * ``esphome-schema.ts``, which imports from here. The dependency is
 * strictly one-directional (core ← schema) so there is no import
 * cycle, and each file stays under the repo's line cap.
 *
 * Graceful degradation: every entry point returns ``null`` / ``[]``
 * on any failure (CSP block, network error, non-2xx response,
 * malformed JSON) so callers fall back to whatever they had before.
 */
import type { ESPHomeAPI } from "../api/esphome-api.js";
import { KeyedPromiseCache } from "./keyed-promise-cache.js";

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
  type: "pin" | "boolean" | "string" | "integer" | "use_id";
  schema?: SchemaSchema;
}

/** ``type: "enum"`` — a fixed set of allowed values. The schema
 *  serialises *values* as a map keyed by the value string with
 *  optional per-value metadata (``docs``). Pulled out of
 *  ``SchemaConfigVarOther`` so the discriminated union actually
 *  models what the bundle declares; ``getConfigVarValueOptions``
 *  consumes the ``values`` field. */
export interface SchemaConfigVarEnum extends SchemaConfigVarBase {
  type: "enum";
  values?: Record<string, { docs?: string } | undefined>;
}

/** ``cv.typed_schema`` — discriminated union keyed by ``typed_key``.
 *  ``types`` maps each discriminator value to a ``SchemaSchema``
 *  (its own ``config_vars`` + ``extends``). ``uptime.sensor`` uses
 *  this with ``typed_key: "type"`` and ``types: { seconds: …,
 *  timestamp: … }``. We expose the union of all variants' keys for
 *  completion since the discriminator isn't necessarily set yet
 *  while the user is typing. */
export interface SchemaConfigVarTyped extends SchemaConfigVarBase {
  type: "typed";
  typed_key?: string;
  types?: Record<string, SchemaSchema | undefined>;
}

export type SchemaConfigVar =
  | SchemaConfigVarTrigger
  | SchemaConfigVarSchema
  | SchemaConfigVarRegistry
  | SchemaConfigVarTyped
  | SchemaConfigVarEnum
  | SchemaConfigVarOther;

export interface SchemaSchema {
  config_vars: Record<string, SchemaConfigVar | undefined>;
  extends?: string[];
}

/** Top-level registry slots a ``SchemaComponent`` can carry. The
 *  legacy dashboard's ``getRegistry(name, doc)`` switches on
 *  these names; pinning the union keeps callsites that index by
 *  registry name (``getRegistryEntries``) honest about which
 *  slots are valid. */
export const SCHEMA_REGISTRY_KEYS = ["action", "condition", "filter", "effects"] as const;
export type SchemaRegistryKey = (typeof SCHEMA_REGISTRY_KEYS)[number];

const REGISTRY_KEY_SET = new Set<string>(SCHEMA_REGISTRY_KEYS);

/** Type guard for the registry-key union — the legacy
 *  ``SchemaComponent`` only carries these four slots. */
export function isRegistryKey(name: string): name is SchemaRegistryKey {
  return REGISTRY_KEY_SET.has(name);
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
  components?: Record<string, { docs?: string; dependencies?: string[] } | undefined>;
}

export interface SchemaBundle {
  core?: SchemaCore;
  // Component-keyed entries: ``esphome``, ``wifi``, ``logger``, …
  // and per-platform sub-keys like ``sensor.dht``.
  [name: string]: SchemaComponent | SchemaCore | undefined;
}

export interface SchemaConfigVarKey {
  key: string;
  docs?: string;
  /** ``"Required"`` / ``"Optional"`` / ``"GeneratedID"`` etc. when
   *  the schema declares it explicitly. Used to mark required
   *  fields in completion details. */
  required?: boolean;
  /** True when the schema declares ``is_list: true`` — the value
   *  is a list of mappings (``filters:`` is the canonical
   *  example). Drives the apply snippet shape: ``key:\n  - ``
   *  instead of ``key: `` so the user lands ready to type the
   *  first list item. */
  isList?: boolean;
  /** Dotted registry reference when the config-var declares
   *  ``type: "registry"`` (e.g. ``sensor.filter`` for
   *  ``filters:``). Lets ``lookupRegistryRef`` short-circuit
   *  by reading the cached key list instead of re-walking the
   *  schema chain. */
  registry?: string;
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

/** In-flight version-resolution promise — a single-entry
 *  ``KeyedPromiseCache`` under one fixed key so concurrent callers
 *  wait on the same answer; evicted on failure so the next caller
 *  retries (Copilot-flagged: marking versionResolved=true on failure
 *  made version negotiation non-retriable for the page lifetime —
 *  inconsistent with the bundle cache's transient-eviction
 *  behaviour). */
const versionCache = new KeyedPromiseCache<string>();

/** The single entry in ``versionCache`` — one schema version per
 *  session, so the cache is keyed by a fixed name rather than a
 *  magic empty string. */
const VERSION_KEY = "version";

/** Memoise resolved config-var key lists by ``<bundle>|<componentKey>``.
 *  The result is a Promise so concurrent callers dedupe on the same
 *  network round-trip. Cleared by ``_resetSchemaCacheForTests``. No
 *  eviction: the collector never rejects (``fetchBundle`` resolves
 *  ``null`` on every failure), so there is nothing to retry. */
const configVarKeysCache = new KeyedPromiseCache<SchemaConfigVarKey[]>({
  evictOnReject: false,
});

/**
 * Clear the lower-layer caches (bundle cache, in-flight version
 * promise, config-var key memo). Test-only — the public
 * ``_resetSchemaCacheForTests`` in ``esphome-schema.ts`` calls this
 * alongside clearing the higher-level memo caches it owns.
 */
export function _resetCoreSchemaCachesForTests() {
  cache.clear();
  configVarKeysCache.clear();
  versionCache.clear();
}

/**
 * Resolve the schema version to ask schema.esphome.io for. Mirrors
 * the legacy ``setSchemaVersion`` behaviour: the dashboard's
 * reported ``esphome_version`` is the authoritative answer, but if
 * that build hasn't published a schema yet we fall back to ``dev``
 * (the rolling latest). Probes the host with a GET on
 * ``esphome.json`` to confirm (GET, not HEAD — see the inline
 * note on CDN/CORS cache poisoning below).
 *
 * On any failure (offline / CSP / DNS), the promise is *evicted*
 * so the next caller retries — no permanent stuck-on-``dev``
 * state when conditions change.
 */
async function resolveVersion(api: ESPHomeAPI): Promise<string> {
  // A successful resolution stays cached for the session — the
  // dashboard's ``esphome_version`` doesn't change without a page
  // reload. A failure is evicted so subsequent calls retry.
  return versionCache.fetch(VERSION_KEY, async () => {
    const { esphome_version } = await api.getVersion();
    if (esphome_version.endsWith("dev")) return "dev";
    // Probe with GET, not HEAD: the schema CDN serves HEAD responses
    // *without* the ``access-control-allow-origin`` header and caches
    // that headerless entry under the URL, so a HEAD probe poisons the
    // cache and the browser then blocks the real GET of the same bundle
    // by CORS. A GET probe caches a CORS-clean entry the bundle fetch
    // reuses. (GET also warms ``esphome.json``, which we need anyway.)
    const probe = await fetch(`${SCHEMA_HOST}/${esphome_version}/esphome.json`);
    if (probe.ok) return esphome_version;
    // Only fall back to ``dev`` for a definitive
    // "this version isn't published" answer (404). Transient
    // failures (5xx, gateway errors) shouldn't permanently lock
    // the session onto ``dev`` — throw so the catch below evicts
    // ``versionPromise`` and the next caller retries when
    // conditions recover. (Copilot-flagged: a 5xx during the
    // probe used to silently downgrade to ``dev`` for the page
    // lifetime.)
    if (probe.status === 404) return "dev";
    throw new Error(`schema-host probe returned ${probe.status} for ${esphome_version}`);
  });
}

/**
 * Fetch one schema bundle (e.g. ``esphome``, ``sensor``,
 * ``binary_sensor``). Resolves to the parsed JSON on success or
 * ``null`` on any failure — callers gracefully skip the
 * schema-driven extras when ``null``.
 */
export function fetchBundle(api: ESPHomeAPI, name: string): Promise<SchemaBundle | null> {
  // "core" lives inside esphome.json (no core.json exists); a "core.*"
  // registry ref would otherwise 404. `bundle["core"]` still resolves.
  if (name === "core") name = "esphome";
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

/** Parse a single ``extends`` reference into a
 *  ``(bundleName, componentKey, schemaName)`` triple. References
 *  take two shapes:
 *    ``<bundle>.<schemaName>``       — e.g. ``binary_sensor._BINARY_SENSOR_SCHEMA``
 *    ``<bundle>.<comp>.<schemaName>`` — e.g. ``gpio.binary_sensor.X``
 *  Anything else is ignored (returns ``null``).
 *  Mirrors the legacy ``getExtendedConfigVar``'s part-count
 *  dispatch.
 */
export function parseExtendsRef(
  ext: string
): { bundle: string; componentKey: string; schemaName: string } | null {
  const parts = ext.split(".");
  if (parts.length === 2) {
    return { bundle: parts[0], componentKey: parts[0], schemaName: parts[1] };
  }
  if (parts.length === 3) {
    return {
      bundle: parts[0],
      componentKey: `${parts[0]}.${parts[1]}`,
      schemaName: parts[2],
    };
  }
  return null;
}

/** Mark *(bundle, component, schema)* visited and load the named
 *  ``ConfigVar`` from the bundle. Centralises the dedupe key plus
 *  the bundle → component → schema chain that every recursive
 *  collector below opens with — returns ``null`` when any link is
 *  missing or the visit-key was already seen. */
export async function loadSchemaCv(
  api: ESPHomeAPI,
  bundleName: string,
  componentKey: string,
  schemaName: string,
  visited: Set<string>
): Promise<SchemaConfigVar | null> {
  const visitKey = `${bundleName}|${componentKey}|${schemaName}`;
  if (visited.has(visitKey)) return null;
  visited.add(visitKey);
  const bundle = await fetchBundle(api, bundleName);
  if (!bundle) return null;
  const component = bundle[componentKey];
  if (!component) return null;
  const cv: SchemaConfigVar | undefined = (component as SchemaComponent).schemas?.[
    schemaName
  ];
  if (!cv || typeof cv !== "object") return null;
  return cv;
}

/**
 * Component/domain docs for a top-level key, read from
 * ``esphome.json``'s ``core.components`` / ``core.platforms`` maps —
 * the same source the legacy dashboard hovered. Covers single-instance
 * components (``esphome``, ``wifi``) *and* bare platform-group domains
 * (``binary_sensor``, ``button``) the flattened catalog doesn't carry.
 * Returns ``null`` when the bundle fails to load or the key is absent.
 */
export async function getComponentDocs(
  api: ESPHomeAPI,
  name: string
): Promise<string | null> {
  const core = (await fetchBundle(api, "esphome"))?.core;
  if (!core) return null;
  return core.components?.[name]?.docs ?? core.platforms?.[name]?.docs ?? null;
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
  componentKey: string
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
    new Set()
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
  visited: Set<string>
): Promise<void> {
  const cv = await loadSchemaCv(api, bundleName, componentKey, schemaName, visited);
  if (!cv) return;
  const schema = "schema" in cv ? cv.schema : undefined;
  if (!schema) return;

  for (const [key, varDecl] of Object.entries(schema.config_vars ?? {})) {
    if (varDecl?.type === "trigger" && !seenKeys.has(key)) {
      seenKeys.add(key);
      out.push({ key, docs: varDecl.docs });
    }
  }

  for (const ext of schema.extends ?? []) {
    const ref = parseExtendsRef(ext);
    if (!ref) continue;
    await collectTriggers(
      api,
      ref.bundle,
      ref.componentKey,
      ref.schemaName,
      out,
      seenKeys,
      visited
    );
  }
}

/**
 * Read every config-var key for a component, walking the
 * ``extends`` chain and unioning ``cv.typed_schema`` variants.
 * Used as the schema-bundle fallback when the prebuilt catalog
 * has an empty ``config_entries`` for a platform-merged id —
 * mirrors the legacy dashboard's behaviour of reading directly
 * from ``schema.esphome.io``.
 *
 * Returns ``[]`` on any failure. Variant-specific keys from a
 * ``typed_schema`` are unioned (rather than gated on the typed
 * discriminator) because the user may not have written the
 * discriminator yet — surfacing every variant's keys lets them
 * pick before committing to a type. The discriminator itself
 * (``typed_key``) is included as the first key.
 */
export async function getConfigVarKeys(
  api: ESPHomeAPI,
  bundleName: string,
  componentKey: string
): Promise<SchemaConfigVarKey[]> {
  const cacheKey = `${bundleName}|${componentKey}`;
  return configVarKeysCache.fetch(cacheKey, async () => {
    const out: SchemaConfigVarKey[] = [];
    const seen = new Set<string>();
    await collectConfigVars(
      api,
      bundleName,
      componentKey,
      "CONFIG_SCHEMA",
      out,
      seen,
      new Set()
    );
    return out;
  });
}

/** Recursively collect config-var keys from a schema, descending
 *  ``extends`` and unioning ``typed_schema`` variants. */
async function collectConfigVars(
  api: ESPHomeAPI,
  bundleName: string,
  componentKey: string,
  schemaName: string,
  out: SchemaConfigVarKey[],
  seenKeys: Set<string>,
  visited: Set<string>
): Promise<void> {
  const cv = await loadSchemaCv(api, bundleName, componentKey, schemaName, visited);
  if (!cv) return;

  // Discriminated union narrows on ``cv.type``.
  if (cv.type === "typed") {
    if (cv.typed_key && !seenKeys.has(cv.typed_key)) {
      seenKeys.add(cv.typed_key);
      out.push({ key: cv.typed_key, required: true });
    }
    for (const variant of Object.values(cv.types ?? {})) {
      if (!variant) continue;
      pushConfigVars(variant.config_vars, out, seenKeys);
      await walkConfigVarExtends(api, variant.extends, out, seenKeys, visited);
    }
    return;
  }

  // Trigger/schema/other carry an optional or required ``schema``;
  // registry has none. Read the field if it's there, otherwise
  // there's nothing to walk.
  const schema = "schema" in cv ? cv.schema : undefined;
  if (!schema) return;
  pushConfigVars(schema.config_vars, out, seenKeys);
  await walkConfigVarExtends(api, schema.extends, out, seenKeys, visited);
}

/** Walk an ``extends`` list and recurse into each referenced schema
 *  to keep collecting config-var keys. Exported so the registry
 *  reader (``esphome-schema.ts``) can reuse the same chain walk for
 *  registry-entry schemas. */
export async function walkConfigVarExtends(
  api: ESPHomeAPI,
  extendsList: string[] | undefined,
  out: SchemaConfigVarKey[],
  seenKeys: Set<string>,
  visited: Set<string>
): Promise<void> {
  for (const ext of extendsList ?? []) {
    const ref = parseExtendsRef(ext);
    if (!ref) continue;
    await collectConfigVars(
      api,
      ref.bundle,
      ref.componentKey,
      ref.schemaName,
      out,
      seenKeys,
      visited
    );
  }
}

/** Push every key of *vars* into *out*, deduping via *seenKeys*. */
export function pushConfigVars(
  vars: Record<string, SchemaConfigVar | undefined> | undefined,
  out: SchemaConfigVarKey[],
  seenKeys: Set<string>
): void {
  if (!vars) return;
  for (const [key, decl] of Object.entries(vars)) {
    if (!decl) continue;
    // Triggers are handled by ``getTriggerKeys``; skip them here
    // so the merged result doesn't double-count ``on_*`` entries.
    if (decl.type === "trigger") continue;
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);
    out.push({
      key,
      docs: decl.docs,
      required: decl.key === "Required",
      isList: decl.is_list === true,
      registry: decl.type === "registry" ? decl.registry : undefined,
    });
  }
}
