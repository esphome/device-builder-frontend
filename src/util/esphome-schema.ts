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
export const SCHEMA_REGISTRY_KEYS = [
  "action",
  "condition",
  "filter",
  "effects",
] as const;
export type SchemaRegistryKey = (typeof SCHEMA_REGISTRY_KEYS)[number];

const REGISTRY_KEY_SET = new Set<string>(SCHEMA_REGISTRY_KEYS);

/** Type guard for the registry-key union — the legacy
 *  ``SchemaComponent`` only carries these four slots. */
function isRegistryKey(name: string): name is SchemaRegistryKey {
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
  configVarKeysCache.clear();
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
    throw new Error(
      `schema-host probe returned ${probe.status} for ${esphome_version}`,
    );
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
  const cv = await loadSchemaCv(
    api,
    bundleName,
    componentKey,
    schemaName,
    visited,
  );
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
      visited,
    );
  }
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
/** Memoise resolved config-var key lists by ``<bundle>|<componentKey>``.
 *  The result is a Promise so concurrent callers dedupe on the same
 *  network round-trip. Cleared by ``_resetSchemaCacheForTests``. */
const configVarKeysCache = new Map<string, Promise<SchemaConfigVarKey[]>>();

export async function getConfigVarKeys(
  api: ESPHomeAPI,
  bundleName: string,
  componentKey: string,
): Promise<SchemaConfigVarKey[]> {
  const cacheKey = `${bundleName}|${componentKey}`;
  const cached = configVarKeysCache.get(cacheKey);
  if (cached) return cached;
  const promise = (async () => {
    const out: SchemaConfigVarKey[] = [];
    const seen = new Set<string>();
    await collectConfigVars(
      api,
      bundleName,
      componentKey,
      "CONFIG_SCHEMA",
      out,
      seen,
      new Set(),
    );
    return out;
  })();
  configVarKeysCache.set(cacheKey, promise);
  return promise;
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
  visited: Set<string>,
): Promise<void> {
  const cv = await loadSchemaCv(
    api,
    bundleName,
    componentKey,
    schemaName,
    visited,
  );
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
      await walkConfigVarExtends(
        api,
        variant.extends,
        out,
        seenKeys,
        visited,
      );
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
 *  to keep collecting config-var keys. */
async function walkConfigVarExtends(
  api: ESPHomeAPI,
  extendsList: string[] | undefined,
  out: SchemaConfigVarKey[],
  seenKeys: Set<string>,
  visited: Set<string>,
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
      visited,
    );
  }
}

/** Push every key of *vars* into *out*, deduping via *seenKeys*. */
function pushConfigVars(
  vars: Record<string, SchemaConfigVar | undefined> | undefined,
  out: SchemaConfigVarKey[],
  seenKeys: Set<string>,
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

/** Parse a single ``extends`` reference into a
 *  ``(bundleName, componentKey, schemaName)`` triple. References
 *  take two shapes:
 *    ``<bundle>.<schemaName>``       — e.g. ``binary_sensor._BINARY_SENSOR_SCHEMA``
 *    ``<bundle>.<comp>.<schemaName>`` — e.g. ``gpio.binary_sensor.X``
 *  Anything else is ignored (returns ``null``).
 *  Mirrors the legacy ``getExtendedConfigVar``'s part-count
 *  dispatch.
 */
function parseExtendsRef(
  ext: string,
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
async function loadSchemaCv(
  api: ESPHomeAPI,
  bundleName: string,
  componentKey: string,
  schemaName: string,
  visited: Set<string>,
): Promise<SchemaConfigVar | null> {
  const visitKey = `${bundleName}|${componentKey}|${schemaName}`;
  if (visited.has(visitKey)) return null;
  visited.add(visitKey);
  const bundle = await fetchBundle(api, bundleName);
  if (!bundle) return null;
  const component = bundle[componentKey];
  if (!component) return null;
  const cv: SchemaConfigVar | undefined = (component as SchemaComponent)
    .schemas?.[schemaName];
  if (!cv || typeof cv !== "object") return null;
  return cv;
}

export interface SchemaEnumValue {
  value: string;
  docs?: string;
}

/**
 * Look up the enum values declared for a single config-var. Used
 * by value-position completion when the catalog has no
 * ``config_entries`` for the parent (typically platform-merged
 * ids — same gap ``getConfigVarKeys`` covers for keys).
 *
 * Walks ``cv.typed_schema`` variants and the ``extends`` chain
 * looking for a config-var of name *varKey* whose schema declares
 * ``type: "enum"`` and ``values: { ... }``. Returns ``[]`` when
 * no enum is found (or the bundle fails to load).
 */
export async function getConfigVarValueOptions(
  api: ESPHomeAPI,
  bundleName: string,
  componentKey: string,
  varKey: string,
): Promise<SchemaEnumValue[]> {
  const out: SchemaEnumValue[] = [];
  await collectEnumValues(
    api,
    bundleName,
    componentKey,
    "CONFIG_SCHEMA",
    varKey,
    out,
    new Set(),
  );
  return out;
}

async function collectEnumValues(
  api: ESPHomeAPI,
  bundleName: string,
  componentKey: string,
  schemaName: string,
  varKey: string,
  out: SchemaEnumValue[],
  visited: Set<string>,
): Promise<void> {
  if (out.length > 0) return; // first hit wins
  const cv = await loadSchemaCv(
    api,
    bundleName,
    componentKey,
    schemaName,
    visited,
  );
  if (!cv) return;

  const tryVars = (
    vars: Record<string, SchemaConfigVar | undefined> | undefined,
  ): boolean => {
    const decl = vars?.[varKey];
    // Discriminated union narrows ``decl`` to ``SchemaConfigVarEnum``
    // here, so ``decl.values`` is typed without a cast.
    if (!decl || decl.type !== "enum") return false;
    if (!decl.values) return false;
    for (const [v, meta] of Object.entries(decl.values)) {
      out.push({
        value: v,
        docs: meta?.docs ? String(meta.docs) : undefined,
      });
    }
    return true;
  };

  if (cv.type === "typed") {
    for (const variant of Object.values(cv.types ?? {})) {
      if (!variant) continue;
      if (tryVars(variant.config_vars)) return;
      await walkEnumExtends(api, variant.extends, varKey, out, visited);
      if (out.length > 0) return;
    }
    return;
  }

  const schema = "schema" in cv ? cv.schema : undefined;
  if (!schema) return;
  if (tryVars(schema.config_vars)) return;
  await walkEnumExtends(api, schema.extends, varKey, out, visited);
}

/** Walk an ``extends`` list, recursing into each referenced schema
 *  to keep searching for the target enum config-var. Stops on the
 *  first hit (``out.length > 0``). */
async function walkEnumExtends(
  api: ESPHomeAPI,
  extendsList: string[] | undefined,
  varKey: string,
  out: SchemaEnumValue[],
  visited: Set<string>,
): Promise<void> {
  for (const ext of extendsList ?? []) {
    const ref = parseExtendsRef(ext);
    if (!ref) continue;
    await collectEnumValues(
      api,
      ref.bundle,
      ref.componentKey,
      ref.schemaName,
      varKey,
      out,
      visited,
    );
    if (out.length > 0) return;
  }
}

export interface SchemaAction {
  /** Dotted key as the user types it: ``logger.log``, ``light.turn_on``,
   *  or just ``delay`` / ``if`` / ``lambda`` for core actions. */
  key: string;
  docs?: string;
}

export interface SchemaRegistryEntry {
  key: string;
  docs?: string;
}

/**
 * Look up a single registry entry's schema config-vars. Used by
 * action-argument completion — after the user picks
 * ``- globals.set:`` from the action registry, the next keystroke
 * is at the body of the action's mapping, where the entries are
 * the action's own arguments (``id`` / ``value`` for
 * ``globals.set``).
 *
 * *bundleName* is the schema-bundle file (``globals.json``,
 * ``light.json``, ``esphome.json`` for core actions). *componentName*
 * is the key inside that bundle (``globals`` / ``light`` / ``core``
 * — usually equal to ``bundleName`` except for core actions which
 * live at ``esphome.json[core]``). *entryName* is the action /
 * filter / condition name.
 *
 * Probes each registry slot (``action`` / ``condition`` /
 * ``filter`` / ``effects``) until one carries an entry with
 * *entryName*. Returns the entry's schema config-vars (with
 * extends walked so inherited fields like
 * ``light.LIGHT_ACTION_SCHEMA`` surface). Mirrors the legacy
 * dashboard's ``getActionSchema``.
 */
export async function getRegistryEntryKeys(
  api: ESPHomeAPI,
  bundleName: string,
  componentName: string,
  entryName: string,
): Promise<SchemaConfigVarKey[]> {
  const bundle = await fetchBundle(api, bundleName);
  if (!bundle) return [];
  const component = bundle[componentName] as SchemaComponent | undefined;
  if (!component) return [];
  for (const slot of SCHEMA_REGISTRY_KEYS) {
    const entry = component[slot]?.[entryName];
    if (!entry || typeof entry !== "object") continue;
    return readRegistryEntrySchema(api, entry);
  }
  return [];
}

/** Read the config-vars off a registry-entry ``ConfigVar`` —
 *  walks ``cv.typed_schema`` variants and the ``extends`` chain
 *  the same way ``collectConfigVars`` does for top-level
 *  schemas. Shared between every registry-entry path. */
async function readRegistryEntrySchema(
  api: ESPHomeAPI,
  entry: SchemaConfigVar,
): Promise<SchemaConfigVarKey[]> {
  const out: SchemaConfigVarKey[] = [];
  const seen = new Set<string>();
  if (entry.type === "typed") {
    if (entry.typed_key && !seen.has(entry.typed_key)) {
      seen.add(entry.typed_key);
      out.push({ key: entry.typed_key, required: true });
    }
    for (const variant of Object.values(entry.types ?? {})) {
      if (!variant) continue;
      pushConfigVars(variant.config_vars, out, seen);
      await walkConfigVarExtends(
        api,
        variant.extends,
        out,
        seen,
        new Set(),
      );
    }
    return out;
  }
  const schema = "schema" in entry ? entry.schema : undefined;
  if (!schema) return [];
  pushConfigVars(schema.config_vars, out, seen);
  await walkConfigVarExtends(api, schema.extends, out, seen, new Set());
  return out;
}

/** Reverse-parse a dotted action / filter / condition label into
 *  the ``(bundleName, componentName, entryName)`` triple the
 *  schema bundle keys by. ``getActions`` emits dotted labels via
 *  ``componentName.split(".").reverse().join(".") + "." + actionName``;
 *  reversing it gets us back to the bundle's storage shape:
 *
 *    ``globals.set``         → bundle ``globals``, component ``globals``,        entry ``set``
 *    ``logger.log``          → bundle ``logger``,  component ``logger``,         entry ``log``
 *    ``binary_sensor.is_on`` → bundle ``binary_sensor``, component ``binary_sensor``, entry ``is_on``
 *    ``light.turn_on``       → bundle ``light``,   component ``light``,          entry ``turn_on``
 *
 *  Core actions (``delay``, ``if``, ``lambda``, …) carry no dot
 *  and live under ``esphome.json[core].action.<name>`` —
 *  ``getRegistryEntryKeys`` is bundle-keyed, so the bundle name
 *  and the component-key inside the bundle differ here. Returning
 *  the triple lets callers pass the right pair to the fetcher.
 *  (Copilot-flagged: previous shape returned ``componentName:
 *  "core"`` which couldn't be passed to ``getRegistryEntryKeys``
 *  — the registry-args provider would have to special-case core
 *  actions just to translate ``"core" → bundle "esphome"``.)
 */
export function parseRegistryLabel(
  label: string,
): { bundleName: string; componentName: string; entryName: string } | null {
  const parts = label.split(".");
  if (parts.length === 1) {
    return {
      bundleName: "esphome",
      componentName: "core",
      entryName: parts[0],
    };
  }
  if (parts.length < 2) return null;
  // Last part is the entry; everything before reverses to the
  // dotted component name. The bundle is the *first* dotted
  // piece of the component name (e.g. component ``light`` →
  // bundle ``light``; component ``binary_sensor.gpio`` → bundle
  // ``gpio`` per the schema host's storage convention).
  const entryName = parts[parts.length - 1];
  const componentName = parts.slice(0, -1).reverse().join(".");
  const bundleName = componentName.split(".")[0];
  return { bundleName, componentName, entryName };
}

/**
 * Walk the schema for *componentKey* (typed-schema variants +
 * extends) looking for a config-var named *varKey* with
 * ``type: "registry"``. Returns the dotted registry reference
 * (e.g. ``sensor.filter``) when found. Used to discover the
 * registry that backs ``filters:`` and similar list-of-mapping
 * config-vars whose entries live in a bundle-level registry
 * map rather than as ordinary config_vars.
 */
export async function lookupRegistryRef(
  api: ESPHomeAPI,
  bundleName: string,
  componentKey: string,
  varKey: string,
): Promise<string | null> {
  // Read off the memoised key list — ``getConfigVarKeys`` walks
  // the typed/extends chain once per ``<bundle>|<componentKey>``
  // and the registry ref is recorded on the entry. Avoids
  // re-walking the schema chain on every list-item keystroke
  // when the answer is "this parent isn't a registry config-var"
  // (the common case).
  const keys = await getConfigVarKeys(api, bundleName, componentKey);
  return keys.find((k) => k.key === varKey)?.registry ?? null;
}

/**
 * Fetch the entries of a single registry (e.g. ``sensor.filter``).
 * The registry ref is a ``<bundle>.<registry>`` pair; bundle name
 * and registry-key parsing matches the legacy
 * ``getRegistry(name, doc)``. Returns ``[]`` on any failure
 * (CSP / offline / missing bundle / no such registry).
 */
export async function getRegistryEntries(
  api: ESPHomeAPI,
  registryRef: string,
): Promise<SchemaRegistryEntry[]> {
  const dot = registryRef.indexOf(".");
  if (dot < 0) return [];
  const bundleName = registryRef.slice(0, dot);
  const registryKey = registryRef.slice(dot + 1);
  const bundle = await fetchBundle(api, bundleName);
  if (!bundle) return [];
  const component = bundle[bundleName];
  if (!component) return [];
  if (!isRegistryKey(registryKey)) return [];
  const registry = (component as SchemaComponent | undefined)?.[registryKey];
  if (!registry) return [];
  const out: SchemaRegistryEntry[] = [];
  for (const [name, cv] of Object.entries(registry)) {
    out.push({ key: name, docs: cv?.docs });
  }
  return out;
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
