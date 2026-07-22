/**
 * The data contract every ConfigEntry renderer reads from. Lifted into
 * its own module so the shared helpers, the per-field renderers, and the
 * form host can all import the type without dragging in the helpers'
 * runtime dependencies (icons, markdown, the styles arrays).
 */

import type { BoardCatalogEntry } from "../../api/types/boards.js";
import type { ConfigEntry } from "../../api/types/config-entries.js";
import type { LocalizeFunc } from "../../common/localize.js";
import type { ComponentProvider } from "../../util/config-entry-yaml-scan.js";
import type { ValidationError } from "../../util/config-validation.js";

export interface RenderCtx {
  localize: LocalizeFunc;
  disabled: boolean;
  yaml: string;
  /** Parsed ``substitutions:`` for ``yaml``; built once per render so
   *  referencing fields share one parse. */
  substitutions: Map<string, string>;
  fromLine?: number;
  /** Section being edited (``light.esp32_rmt_led_strip``,
   *  ``sensor.template``, …). Empty when the form runs outside a
   *  section context. The REGISTRY_LIST renderer reads this to
   *  scope its picker against ``applies_to`` so a sensor's filter
   *  dropdown doesn't offer binary_sensor filters. */
  sectionKey: string;
  /** Backend-resolved ESPHome node name (substitutions already expanded) for
   *  the device being edited; the hostname for per-device secret keys
   *  (``<hostname>__ota_password``). Empty outside a device context (e.g. the
   *  add-component preview). */
  deviceName?: string;
  board: BoardCatalogEntry | null;
  /** ``{provider_key: [allowed_mode_flags]}`` scoping the long-form pin Mode
   *  checkboxes per external provider; absent provider / native pin → all flags. */
  pinRegistryModes?: Record<string, string[]>;
  requiredOnly: boolean;
  /** Whether the section's advanced fields are shown. Read by
   *  ``renderChildEntries({ includeAdvanced })`` so an exclusive-group's
   *  chosen member can reveal all its fields regardless of the toggle. */
  showAdvanced: boolean;
  /** Top-level component keys present in the YAML — for the
   *  ``depends_on_component`` visibility predicate when filtering directly. */
  presentComponents: Set<string>;
  /** Top-level keys whose backend constraint prose the form replaces with a
   *  reactive banner/cluster (``required_groups`` keys + inclusive-``group``
   *  members). ``_fieldDescription`` strips the baked prose only for these, so
   *  nested-scope members keep theirs. */
  reactiveConstraintKeys: Set<string>;
  /** The form's top-level config entries, for resolving a label of a key that
   *  isn't in a given cluster's members (a cardinality key that's also an
   *  ``exclusive_group`` member is dropped from the cluster), and fed to
   *  ``isEntryVisible`` as the ``siblings`` scope for the depends_on default
   *  fallback. Top-level is the *correct* sibling scope for every consumer:
   *  the cluster / exclusive-group / banner renderers only ever run at the
   *  top level (their paths are root-anchored), and nested leaves get their
   *  per-level siblings from ``filterRenderable``'s own recursion. If those
   *  renderers ever become nested-capable, rebase this alongside the paths. */
  entries: ConfigEntry[];
  nestedOpenSections: Set<string>;
  getAt: (path: string[]) => unknown;
  errorAt: (path: string[]) => ValidationError | null;
  emitChange: (path: string[], value: unknown) => void;
  toggleNested: (key: string) => void;
  /** Open *key* once as a default (e.g. a pin disclosure with long-form
   *  values), without overriding a later explicit user collapse. */
  seedNestedOpen: (key: string) => void;
  requestAddComponent: (domain: string) => void;
  /**
   * Providers of a cross-domain interface reference. Returns synchronously
   * from a per-form cache; a miss kicks an async catalog fetch and
   * re-renders. ``null`` while unsettled (no api yet, fetch in flight, or
   * the last fetch failed) — the candidate list is incomplete then, not
   * empty. ``[]`` is a settled same-domain reference.
   */
  resolveInterfaceProviders: (
    interfaceName: string
  ) => ReadonlyArray<ComponentProvider> | null;
  scopeValues: (path: string[]) => Record<string, unknown>;
  filterRenderable: (
    entries: ConfigEntry[],
    values: Record<string, unknown>
  ) => ConfigEntry[];
  renderEntry: (entry: ConfigEntry, path: string[]) => unknown;
  /**
   * FLOAT_WITH_UNIT-only: stash a unit choice that the user picked
   * before typing a numeric value. The form doesn't serialize the
   * choice as YAML (a unit-only string isn't a valid value); instead
   * the renderer reads it on next paint so the picker stays on the
   * user's selection until they enter a number.
   */
  getPendingUnit: (path: string[]) => string | undefined;
  setPendingUnit: (path: string[], unit: string) => void;
  /**
   * Transient editing buffer for numeric inputs (float-with-unit, int,
   * hex, and INTEGER list rows). Committing an intermediate typing state
   * (`"-"`, `"1e"`, `"0042"`) would round-trip through serialize and
   * reset or reformat the field mid-typing. Renderers stash the raw text
   * here and read it on the next paint so partial input survives until
   * the user types a parseable value (or blurs the field).
   */
  getEditingMagnitude: (path: string[]) => string | undefined;
  setEditingMagnitude: (path: string[], text: string) => void;
  clearEditingMagnitude: (path: string[]) => void;
  /** Drop every edit buffer at or under *path*. List-row buffers embed the
   *  row index, so removing a row must invalidate them — the indices shift
   *  and an un-blurred buffer would paint (and commit) over the wrong row. */
  clearEditingMagnitudesUnder: (path: string[]) => void;
  /**
   * Either/or constraint cluster (radio chooser) UI state, off-config like
   * the unit/magnitude stashes above. ``ClusterChoice`` is the selected
   * alternative id, needed because a freshly-picked-but-empty side has no
   * present value to infer the selection from. ``ClusterStash`` preserves the
   * deselected side's values so switching back restores them (only the
   * selected side is ever serialized). Keyed by cluster id (its first member
   * key) plus, for the stash, the member key.
   */
  getClusterChoice: (clusterId: string) => string | undefined;
  setClusterChoice: (clusterId: string, altId: string) => void;
  getClusterStash: (clusterId: string, key: string) => unknown;
  setClusterStash: (clusterId: string, key: string, value: unknown) => void;
  clearClusterStash: (clusterId: string, key: string) => void;
  /**
   * Stable per-form object identity used by renderers that keep
   * cross-render scratch state via a WeakMap (e.g. templatable
   * literal/lambda stashing — see ``templatable.ts``). The form
   * rebuilds the rest of the ctx every render so renderEntry /
   * emitChange / etc. are fresh closures and can't be used as
   * stable keys. ``stashOwner`` IS the host element itself.
   */
  stashOwner: object;
}
