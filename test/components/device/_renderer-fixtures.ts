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
import type {
  BoardCatalogEntry,
  BoardPin,
  ConfigEntry,
} from "../../../src/api/types.js";
import { ConfigEntryType } from "../../../src/api/types.js";
import type { RenderCtx } from "../../../src/components/device/config-entry-renderers-shared.js";
import { findTemplatesByAnchor } from "../../_lit-template-walker.js";
import type { TemplateResult } from "lit";

/** Build a minimal ``BoardPin``. Defaults to a generic
 *  input+output GPIO with ``available=true`` so the pin-renderer's
 *  feature filter and disabled-pin filter both see it as eligible.
 */
export function makeBoardPin(
  gpio: number,
  overrides: Partial<BoardPin> = {},
): BoardPin {
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
  options: { pins?: BoardPin[]; overrides?: Partial<BoardCatalogEntry> } = {},
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
  } = {},
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
    ...(options.overrides ?? {}),
  } as never;
}

/** Build a minimal ``ConfigEntry`` of *type* with sensible
 *  defaults. Tests pass *overrides* to set ``label``,
 *  ``required``, ``pin_features``, etc. */
export function makeEntry(
  type: ConfigEntryType,
  overrides: Partial<ConfigEntry> = {},
): ConfigEntry {
  return {
    key: "field",
    type,
    label: "Field",
    required: false,
    ...overrides,
  } as never;
}

/* ------------------------------------------------------------------ */
/* Per-tag binding extractors                                         */
/*                                                                    */
/* The pin renderer (and any future renderer that emits a            */
/* ``wa-option``) lays its template literal out as:                  */
/*   <wa-option                                                      */
/*     class=${...}      slot 0                                      */
/*     value=${...}      slot 1                                      */
/*     .label=${...}     slot 2                                      */
/*     ?selected=${...}  slot 3                                      */
/*     ?disabled=${...}  slot 4                                      */
/*     title=${...}      slot 5                                      */
/*   >…</wa-option>                                                  */
/* The slot numbers are baked in by the html literal's expression    */
/* order — they're contractual with the renderer source. If the     */
/* renderer reorders attributes, this helper has to follow.         */
/* ------------------------------------------------------------------ */

/** Bindings extracted from a single ``<wa-option>`` template. */
export interface WaOptionBindings {
  className: string;
  value: string;
  label: string;
  selected: boolean;
  disabled: boolean;
  title: string;
}

/** Extract every ``<wa-option>`` binding set from *template*.
 *  Recurses through nested templates so a ``visible.map(pin =>
 *  html\`<wa-option …>\`)`` produces one entry per pin.
 */
export function extractWaOptionBindings(
  template: TemplateResult,
): WaOptionBindings[] {
  return findTemplatesByAnchor(template, "<wa-option").map((t) => ({
    className: String(t.values[0] ?? ""),
    value: String(t.values[1] ?? ""),
    label: String(t.values[2] ?? ""),
    selected: Boolean(t.values[3]),
    disabled: Boolean(t.values[4]),
    title: String(t.values[5] ?? ""),
  }));
}
