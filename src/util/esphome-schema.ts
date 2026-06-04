/**
 * Specialised lookups over the ESPHome schema bundle: nested-path
 * config-var docs (hover), enum value options (value completion),
 * and the action / registry-entry tables that drive completion
 * inside automation bodies (``then:`` → ``- ...``).
 *
 * These build on the fetch + config-var/trigger key collectors in
 * ``esphome-schema-core.ts`` (imported below) and this module
 * re-exports that lower layer's public surface — ``fetchBundle``,
 * ``getComponentDocs``, ``getTriggerKeys``, ``getConfigVarKeys`` and
 * the schema types — so existing import sites keep pointing at
 * ``esphome-schema.js`` unchanged.
 *
 * Graceful degradation: every entry point returns ``null`` / ``[]``
 * on any failure (CSP block, network error, non-2xx response,
 * malformed JSON). Callers fall back to whatever they had before —
 * the editor's existing component-catalog completion stays the
 * floor, the schema-driven extras stack on top when reachable.
 */
import type { ESPHomeAPI } from "../api/esphome-api.js";
import {
  _resetCoreSchemaCachesForTests,
  fetchBundle,
  getConfigVarKeys,
  isRegistryKey,
  loadSchemaCv,
  parseExtendsRef,
  pushConfigVars,
  SCHEMA_REGISTRY_KEYS,
  walkConfigVarExtends,
  type SchemaComponent,
  type SchemaConfigVar,
  type SchemaConfigVarKey,
  type SchemaSchema,
} from "./esphome-schema-core.js";

export {
  fetchBundle,
  getComponentDocs,
  getConfigVarKeys,
  getTriggerKeys,
  SCHEMA_REGISTRY_KEYS,
} from "./esphome-schema-core.js";
export type {
  SchemaBundle,
  SchemaComponent,
  SchemaConfigVar,
  SchemaConfigVarBase,
  SchemaConfigVarEnum,
  SchemaConfigVarKey,
  SchemaConfigVarOther,
  SchemaConfigVarRegistry,
  SchemaConfigVarSchema,
  SchemaConfigVarTrigger,
  SchemaConfigVarTyped,
  SchemaCore,
  SchemaRegistryKey,
  SchemaSchema,
} from "./esphome-schema-core.js";

/** Memoise nested-path docs by ``<bundle>|<component>|<a.b.c>``. */
const configVarDocsCache = new Map<string, Promise<string | null>>();

/**
 * Reset the in-memory cache. Test-only entry point — production
 * callers should never need to invalidate; the schema host serves
 * the same bundle for the lifetime of an ESPHome version.
 */
export function _resetSchemaCacheForTests() {
  _resetCoreSchemaCachesForTests();
  configVarDocsCache.clear();
}

/**
 * Resolve the ``docs`` string for a config-var reached by descending
 * *path* relative to the component's ``CONFIG_SCHEMA`` — e.g.
 * ``["scan_parameters", "active"]`` under ``esp32_ble_tracker``.
 * Walks ``extends`` chains and ``typed`` variants at each level.
 * Returns ``null`` when the path doesn't resolve or carries no docs.
 */
export async function getConfigVarDocsAtPath(
  api: ESPHomeAPI,
  bundleName: string,
  componentKey: string,
  path: string[]
): Promise<string | null> {
  if (path.length === 0) return null;
  const cacheKey = `${bundleName}|${componentKey}|${path.join(".")}`;
  const cached = configVarDocsCache.get(cacheKey);
  if (cached) return cached;
  const promise = (async () => {
    let cv = await loadSchemaCv(
      api,
      bundleName,
      componentKey,
      "CONFIG_SCHEMA",
      new Set()
    );
    for (let i = 0; i < path.length; i++) {
      if (!cv) return null;
      const found = await findCvInCv(
        api,
        bundleName,
        componentKey,
        cv,
        path[i],
        new Set()
      );
      if (!found) return null;
      if (i === path.length - 1) {
        // A typed discriminator's own docs name the variants only as a
        // ``Supported … are:`` lead-in; append the variant list so the
        // hover isn't cut off mid-sentence.
        if (found.type === "typed" && found.typed_key === path[i] && found.types) {
          const list = Object.keys(found.types)
            .map((n) => `\`${n}\``)
            .join(", ");
          return list
            ? `${found.docs ? `${found.docs} ` : ""}${list}`
            : (found.docs ?? null);
        }
        return found.docs ?? null;
      }
      cv = found;
    }
    return null;
  })();
  // Don't memoize a transient failure — evict on rejection so the next
  // hover retries instead of replaying a rejected promise forever.
  promise.catch(() => {
    if (configVarDocsCache.get(cacheKey) === promise) configVarDocsCache.delete(cacheKey);
  });
  configVarDocsCache.set(cacheKey, promise);
  return promise;
}

/** Find the config-var named *key* reachable from *cv* — descending a
 *  ``typed`` union's variants or a ``schema``'s config_vars/extends. */
async function findCvInCv(
  api: ESPHomeAPI,
  bundleName: string,
  componentKey: string,
  cv: SchemaConfigVar,
  key: string,
  visited: Set<string>
): Promise<SchemaConfigVar | null> {
  if (cv.type === "typed") {
    // The discriminator key itself (``type:`` on a typed schema, e.g.
    // ethernet) carries its docs on the typed cv, not in any variant.
    if (cv.typed_key === key) return cv;
    for (const variant of Object.values(cv.types ?? {})) {
      if (!variant) continue;
      const found = await findCvInSchema(
        api,
        bundleName,
        componentKey,
        variant,
        key,
        visited
      );
      if (found) return found;
    }
    return null;
  }
  const schema = "schema" in cv ? cv.schema : undefined;
  if (!schema) return null;
  return findCvInSchema(api, bundleName, componentKey, schema, key, visited);
}

/** Look up *key* in a ``SchemaSchema``: its own ``config_vars`` first,
 *  then each ``extends`` reference (recursively). */
async function findCvInSchema(
  api: ESPHomeAPI,
  bundleName: string,
  componentKey: string,
  schema: SchemaSchema,
  key: string,
  visited: Set<string>
): Promise<SchemaConfigVar | null> {
  const direct = schema.config_vars?.[key];
  if (direct) return direct;
  for (const ext of schema.extends ?? []) {
    const ref = parseExtendsRef(ext);
    if (!ref) continue;
    const cv = await loadSchemaCv(
      api,
      ref.bundle,
      ref.componentKey,
      ref.schemaName,
      visited
    );
    if (!cv) continue;
    const found = await findCvInCv(api, ref.bundle, ref.componentKey, cv, key, visited);
    if (found) return found;
  }
  return null;
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
  varKey: string
): Promise<SchemaEnumValue[]> {
  const out: SchemaEnumValue[] = [];
  await collectEnumValues(
    api,
    bundleName,
    componentKey,
    "CONFIG_SCHEMA",
    varKey,
    out,
    new Set()
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
  visited: Set<string>
): Promise<void> {
  if (out.length > 0) return; // first hit wins
  const cv = await loadSchemaCv(api, bundleName, componentKey, schemaName, visited);
  if (!cv) return;

  const tryVars = (
    vars: Record<string, SchemaConfigVar | undefined> | undefined
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
  visited: Set<string>
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
      visited
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
  entryName: string
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
  entry: SchemaConfigVar
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
      await walkConfigVarExtends(api, variant.extends, out, seen, new Set());
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
  label: string
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
  varKey: string
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
  registryRef: string
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
  componentKeys: string[]
): Promise<SchemaAction[]> {
  const bundles = await Promise.all(bundleNames.map((name) => fetchBundle(api, name)));
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
