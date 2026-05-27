/**
 * Shared fixtures for ``config-entry-*`` renderer tests.
 *
 * Each renderer takes a ``ConfigEntry``, a path, and a
 * ``RenderCtx`` and returns a Lit ``TemplateResult``. The ctx
 * shape is wide and most tests only care about a handful of
 * fields (``getAt`` for the value at the field's path, ``board``
 * for pin-typed renderers, ``localize`` to turn keys into text);
 * the rest are stubbed with no-op functions so a test can opt in
 * to whatever it needs without rebuilding the dozen-field object
 * from scratch every time.
 *
 * Co-located with renderer tests rather than in ``test/util/``
 * because the shape is renderer-specific (RenderCtx is private
 * to ``components/device``).
 */
import { vi } from "vitest";
import type { BoardCatalogEntry, BoardPin, ConfigEntry } from "../../../src/api/types.js";
import { ConfigEntryType } from "../../../src/api/types.js";
import type { RenderCtx } from "../../../src/components/device/config-entry-renderers-shared.js";
import {
  extractAttributeBindings,
  findTemplatesByAnchor,
} from "../../_lit-template-walker.js";

/** Build a minimal ``BoardPin``. Defaults to a generic
 *  input+output GPIO with ``available=true`` so the pin-renderer's
 *  feature filter and disabled-pin filter both see it as eligible.
 */
export function makeBoardPin(gpio: number, overrides: Partial<BoardPin> = {}): BoardPin {
  return {
    gpio,
    label: `GPIO${gpio}`,
    features: ["input", "output"],
    available: true,
    occupied_by: null,
    notes: null,
    ...overrides,
  };
}

/** Build a minimal ESP32-shaped ``BoardCatalogEntry`` for renderer
 *  tests that need a board context (PIN renderer is the obvious
 *  one). The defaults are deliberately light — pass ``pins`` to
 *  override the default 3-pin set, or pass ``overrides`` to swap
 *  any other field. */
export function makeTestBoard(
  options: { pins?: BoardPin[]; overrides?: Partial<BoardCatalogEntry> } = {}
): BoardCatalogEntry {
  const pins = options.pins ?? [makeBoardPin(0), makeBoardPin(2), makeBoardPin(33)];
  return {
    id: "esp32-test",
    name: "ESP32 Test",
    description: "",
    manufacturer: "Espressif",
    esphome: { platform: "esp32", board: "esp32dev" } as never,
    hardware: { connectivity: ["wifi"] } as never,
    tags: [],
    pins,
    ...(options.overrides ?? {}),
  } as never;
}

/** Build a ``RenderCtx`` rooted at *values*. ``getAt`` walks the
 *  path against *values* (with ``undefined`` on misses); every
 *  side-effect callback (``emitChange``, ``toggleNested``, …)
 *  is a ``vi.fn()`` so tests that want to assert on emitted
 *  changes can pull the mock and inspect calls. ``board``
 *  defaults to a generic ESP32 stub (override via *board*).
 *  Other ctx fields fall through to safe defaults; pass
 *  *overrides* to swap any specific field. */
export function makeRenderCtx(
  values: unknown,
  options: {
    board?: BoardCatalogEntry | null;
    overrides?: Partial<RenderCtx>;
  } = {}
): RenderCtx {
  return {
    localize: ((k: string) => k) as never,
    disabled: false,
    yaml: "",
    fromLine: 0,
    board: options.board ?? makeTestBoard(),
    requiredOnly: false,
    nestedOpenSections: new Set<string>(),
    getAt: (path: string[]) => {
      let cur: unknown = values;
      for (const key of path) {
        if (cur && typeof cur === "object") {
          cur = (cur as Record<string, unknown>)[key];
        } else {
          return undefined;
        }
      }
      return cur;
    },
    errorAt: () => null,
    emitChange: vi.fn(),
    toggleNested: vi.fn(),
    requestAddComponent: vi.fn(),
    scopeValues: () => ({}),
    filterRenderable: (entries) => entries,
    renderEntry: vi.fn(),
    getPendingUnit: () => undefined,
    setPendingUnit: vi.fn(),
    getPendingNumeric: () => undefined,
    setPendingNumeric: vi.fn(),
    // Stable per-fixture stash owner — tests that exercise the
    // templatable stash WeakMap (literal/lambda recovery) need a
    // single object identity across calls into the renderer. A
    // fresh ``{}`` per ``makeRenderCtx`` invocation matches the
    // production form's "one stashOwner per host element" contract.
    stashOwner: {},
    ...(options.overrides ?? {}),
  } as never;
}

/** Build a minimal ``ConfigEntry`` of *type* with sensible
 *  defaults. Tests pass *overrides* to set ``label``,
 *  ``required``, ``pin_features``, etc. */
export function makeEntry(
  type: ConfigEntryType,
  overrides: Partial<ConfigEntry> = {}
): ConfigEntry {
  return {
    key: "field",
    type,
    label: "Field",
    required: false,
    ...overrides,
  } as never;
}

/**
 * Find every template that emits *tag* and return the attribute /
 * property / boolean-attribute / event bindings on it as a name →
 * value map.
 *
 * Generic over any element — tests pin the *tag* they care about
 * (``"wa-option"``, ``"wa-select"``, ``"wa-input"``, …) and read
 * bindings by name without depending on the order the renderer
 * declared them. A renderer that swaps ``value=`` and ``?selected=``
 * around still produces the same lookup keys, so reorder-only
 * refactors don't break tests.
 *
 * Each returned map has Lit-prefixed keys to disambiguate binding
 * kinds: ``"value"`` (string attr), ``".label"`` (property),
 * ``"?selected"`` (boolean attr), ``"@change"`` (event handler).
 * See ``extractAttributeBindings`` for the full table.
 */
export function findElementBindings(
  template: unknown,
  tag: string
): Record<string, unknown>[] {
  return findTemplatesByAnchor(template, `<${tag}`).map(extractAttributeBindings);
}
