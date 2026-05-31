/**
 * Automation triggers/actions/conditions, registry catalogs, trees.
 *
 * Part of the src/api/types.ts barrel split.
 */
import type { ConfigEntry } from "./config-entries.js";

// ─── Automations ─────────────────────────────────────────────
//
// Automation catalog and round-trip shape. Every trigger / action /
// condition / light-effect carries its parameter schema as
// ``ConfigEntry[]`` — exactly the same shape the component form
// renderer already speaks — so the automation editor reuses the
// existing form pipeline (id pickers, pin pickers, depends-on
// cascades, advanced toggle, validation) without inventing parallel
// machinery.
//
// The backend owns YAML parse/write; the frontend exchanges
// ``AutomationTree`` blobs and applies a ``YamlDiff`` to the editor
// pane on each save.

/** A trigger that can start an automation. */
export interface AutomationTrigger {
  id: string; // "on_press", "binary_sensor.on_click", "on_boot"
  name: string; // "On Press"
  description: string;
  docs_url: string;
  /** Platform types this trigger applies to (``["binary_sensor"]``).
   *  Empty list = device-level (``on_boot``, ``on_loop``,
   *  ``on_shutdown``) — always available regardless of which
   *  components are configured. */
  applies_to: string[];
  is_device_level: boolean;
  /** True for a component trigger the wizard can stack: it stays
   *  offerable past the first handler and appends an indexed entry. */
  repeatable: boolean;
  /** Parameter schema (e.g. ``on_click`` has ``min_length`` /
   *  ``max_length`` time-period fields). */
  config_entries: ConfigEntry[];
}

/** An action that can run inside an automation. */
export interface AutomationAction {
  id: string; // "light.turn_on", "delay", "if", "lambda"
  name: string;
  description: string;
  docs_url: string;
  domain: string; // "light", "core" for built-ins
  config_entries: ConfigEntry[];
  /** True for ``if`` / ``while`` / ``repeat`` / ``wait_until`` —
   *  the action embeds nested action lists addressed by the keys in
   *  ``accepts_action_list``. */
  is_control_flow: boolean;
  has_else_branch: boolean;
  /** Names of fields whose value is itself a list of actions
   *  (``["then"]`` for ``while``, ``["then", "else"]`` for ``if``).
   *  These are stripped from ``config_entries`` server-side so the
   *  frontend renders them as recursive action lists, not as form
   *  fields. */
  accepts_action_list: string[];
}

/** A condition usable inside an automation's ``if`` / ``while`` /
 *  ``wait_until`` action, or as a trigger gate. */
export interface AutomationCondition {
  id: string; // "binary_sensor.is_on", "and", "lambda"
  name: string;
  description: string;
  docs_url: string;
  domain: string; // "binary_sensor", "core"
  config_entries: ConfigEntry[];
  /** True for ``and`` / ``or`` / ``all`` / ``any`` / ``not`` /
   *  ``xor`` — the condition embeds a recursive list of child
   *  conditions. */
  accepts_condition_list: boolean;
}

/** Scalar primitives a polymorphic registry entry can take at the
 *  key position (``- throttle: 10s``, ``- lambda: |- ...``). Union
 *  rather than plain string so a misspelled tag is a compile-time
 *  error against the renderer's dispatch table. */
export type RegistryValueType = "time_period" | "float" | "integer" | "string" | "lambda";

/** Common shape for the polymorphic-list registry catalogs
 *  (`light_effects`, `filter`, future additions). One entry per
 *  registered id; `config_entries` is the per-id parameter schema;
 *  `applies_to` scopes the entry to the parent sections it's valid
 *  on. The token shape in `applies_to` is per-registry: qualified
 *  component ids (`"light.addressable_rgb"`) for `light_effects`,
 *  bare component domains (`"sensor"`) for `filter`. */
export interface RegistryCatalogEntry {
  id: string;
  name: string;
  config_entries: ConfigEntry[];
  applies_to: string[];
  /** Set when the entry takes a single scalar at the polymorphic
   *  key position (``- throttle: 10s``, ``- delayed_on: 50ms``)
   *  rather than a nested mapping. The renderer mounts the matching
   *  inline input at the polymorphic value position instead of an
   *  empty sub-form. */
  value_type?: RegistryValueType | null;
}

/** A light effect (``pulse``, ``flicker``, ``addressable_lambda``…).
 *  Each effect is itself a registry entry with its own parameter
 *  schema. `applies_to` carries qualified component ids
 *  (``["light.addressable_rgb"]``). */
export type LightEffect = RegistryCatalogEntry;

/** A sensor / binary_sensor / text_sensor filter (``delta``,
 *  ``lambda``, ``calibrate_linear``…). `applies_to` carries bare
 *  component domains (``["sensor"]`` / ``["binary_sensor"]``).
 *  Filters with the same id across domains merge into one catalog
 *  entry whose `applies_to` spans every domain it lives in. */
export type Filter = RegistryCatalogEntry;

/** Union of every full body the ``automations/get_bodies`` batch
 *  endpoint can return. There is no per-body discriminator field;
 *  the discriminator is the ``"<type>/<id>"`` response key, so
 *  narrowing happens at the call site against the type the caller
 *  asked for, not via structural inspection. */
export type AutomationCatalogBody =
  | AutomationTrigger
  | AutomationAction
  | AutomationCondition
  | LightEffect
  | Filter;

/** Wire ``type`` field on an ``automations/get_bodies`` ref. */
export type AutomationCatalogBodyType =
  | "triggers"
  | "actions"
  | "conditions"
  | "light_effects"
  | "filters";

/** Tagged-union locator for an automation inside a device YAML.
 *  Mirrors the backend's ``AutomationLocation`` Python dataclass.
 *  ``parse`` returns these and ``upsert`` / ``delete`` consume them
 *  so the writer knows exactly which YAML range to splice. */
export type AutomationLocation =
  | { kind: "script"; id: string }
  | { kind: "interval"; index: number }
  | { kind: "component_on"; component_id: string; trigger: string; index?: number }
  | { kind: "device_on"; trigger: string }
  | { kind: "light_effect"; component_id: string; index: number }
  | { kind: "api_action"; action_name: string };

/** A single action inside an automation tree. ``children`` carries
 *  nested action lists for control-flow actions, keyed by the
 *  action's ``accepts_action_list`` entries (e.g.
 *  ``{ then: [...], else: [...] }`` for ``if``). ``conditions`` is
 *  populated only for ``if`` (the boolean gate) — other control-flow
 *  actions have their gate elsewhere. */
export interface ActionNode {
  action_id: string;
  params: Record<string, unknown>;
  children?: Record<string, ActionNode[]>;
  conditions?: ConditionNode[];
}

/** A single condition inside an ``if`` / ``while`` / ``wait_until``.
 *  ``children`` is populated only when the condition's ``accepts_-
 *  condition_list`` is true (``and`` / ``or`` / ``not`` / ...). */
export interface ConditionNode {
  condition_id: string;
  params: Record<string, unknown>;
  children?: ConditionNode[];
}

/** The full structured form of one automation. ``trigger_id`` is
 *  ``null`` for top-level ``script:`` / ``interval:`` blocks (which
 *  carry no trigger key in YAML — the block kind is implied by the
 *  ``AutomationLocation``).
 *
 *  Note: ESPHome triggers don't carry a top-level boolean gate.
 *  Conditional execution is expressed inline as an ``if`` action
 *  (or ``while`` / ``wait_until``) inside ``actions`` — those nodes
 *  carry their own ``conditions`` field. There is intentionally no
 *  ``conditions`` field at this level. */
export interface AutomationTree {
  trigger_id: string | null;
  trigger_params: Record<string, unknown>;
  actions: ActionNode[];
}

/** What ``automations/parse`` returns for each existing automation
 *  detected in the device YAML. ``raw_yaml`` is retained so the
 *  editor can fall back to a read-only YAML view when an automation
 *  references a non-catalog action id. */
export interface ParsedAutomation {
  location: AutomationLocation;
  /** Display label for the navigator (e.g. ``"Living room button →
   *  on_press"`` or ``"Script: morning_alarm"``). */
  label: string;
  automation: AutomationTree;
  /** 1-indexed CodeMirror line ranges so the navigator can map a
   *  click to the right YAML window without re-parsing. */
  from_line: number;
  to_line: number;
  /** Verbatim YAML the parse came from — used for the round-trip
   *  safety check and as a read-only fallback when the structured
   *  form is unrecoverable. */
  raw_yaml: string;
  /** Set when this one automation failed to decompose (unknown
   *  action / condition id). Siblings still parse; the editor renders
   *  it read-only so its empty tree can't overwrite the real YAML. */
  error?: string | null;
}

/** Splice instruction returned by ``automations/upsert`` and
 *  ``automations/delete``. Identical shape to the diffs the existing
 *  component flow uses, so the device-editor's optimistic-update
 *  path applies them through the same machinery. */
export interface YamlDiff {
  fromLine: number;
  toLine: number;
  replacement: string;
}

/** Marker shape stored in ``params`` values to distinguish a
 *  ``!lambda |- ...`` block from a literal string. Used wherever a
 *  ``ConfigEntry`` has ``templatable: true`` and the user picked the
 *  lambda branch of the literal/lambda toggle. The backend writer
 *  emits this as a ruamel ``LiteralScalarString`` with ``|-`` style;
 *  the parser inverts. */
export interface LambdaValue {
  _lambda: string;
}

/** Type guard for ``LambdaValue``. */
export function isLambdaValue(v: unknown): v is LambdaValue {
  return (
    typeof v === "object" &&
    v !== null &&
    !Array.isArray(v) &&
    typeof (v as Record<string, unknown>)._lambda === "string"
  );
}

/** Return shape of ``automations/get_available`` — context-aware
 *  catalog scoped to a single device's YAML. ``triggers`` is
 *  filtered to component types present in the config + device-level
 *  triggers; ``actions`` / ``conditions`` are returned in full
 *  (id-pickers filter on the frontend). ``scripts`` and ``devices``
 *  feed action-parameter dropdowns: ``script.execute`` needs the
 *  declared script ids (plus their ``parameters:``), and
 *  ``switch.turn_on`` / ``light.turn_on`` / etc. need the configured
 *  component instance ids of the right domain. */
export interface AvailableAutomations {
  triggers: AutomationTrigger[];
  actions: AutomationAction[];
  conditions: AutomationCondition[];
  scripts: AvailableScript[];
  devices: AvailableComponentInstance[];
}

export interface AvailableScript {
  id: string;
  /** Declared script parameters (``parameters: pin: int``) so
   *  ``script.execute`` can render a dynamic param form for the
   *  selected script. */
  parameters: AvailableScriptParameter[];
}

export interface AvailableScriptParameter {
  name: string;
  /** ESPHome parameter type (``int``, ``float``, ``bool``,
   *  ``string``). Treated as opaque on the frontend — the action
   *  form just renders the matching primitive input. */
  type: string;
}

export interface AvailableComponentInstance {
  /** Catalog component id (``switch.gpio``, ``light.binary``). */
  component_id: string;
  /** The configured ``id:`` value from YAML. */
  id: string;
  /** The configured ``name:`` value, if any (purely for display). */
  name?: string;
}
