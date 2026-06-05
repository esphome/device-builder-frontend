/**
 * @vitest-environment happy-dom
 *
 * Tests for the shared label-chip rendering helpers in
 * ``src/util/label-chip-template.ts`` — the single source of truth
 * every surface (card, table cell, drawer, filter popover, editor)
 * uses so the pill shape and overflow behaviour stay in lockstep.
 *
 * Three load-bearing contracts:
 *
 *  - ``resolveLabelIds`` — resolves a device's label-id list against
 *    the catalog, **in the device's source order**, silently dropping
 *    ids the catalog doesn't know (the in-flight / just-deleted race).
 *  - ``renderLabelChip`` — one pill; ``suppressTitle`` opts out of the
 *    chip's native tooltip when the parent owns a row-level ``title``.
 *  - ``renderLabelChips`` — a (possibly truncated) row; ``max`` caps
 *    the visible chips and collapses the rest into a "+N" overflow
 *    chip whose tooltip lists the hidden labels. Empty list renders
 *    ``nothing`` so the caller doesn't have to gate.
 *
 * The render helpers emit Lit ``TemplateResult``s; we mount them into
 * a happy-dom container with Lit's ``render`` (the repo idiom — see
 * ``render-facets.test.ts``) and assert on the produced DOM rather
 * than on lit-html internals.
 */
import { nothing, render } from "lit";
import { afterEach, describe, expect, it } from "vitest";

import type { Label } from "../../src/api/types/devices.js";
import {
  renderLabelChip,
  renderLabelChips,
  resolveLabelIds,
} from "../../src/util/label-chip-template.js";

function label(id: string, name: string, color: string | null = null): Label {
  return { id, name, color };
}

function renderInto(value: unknown): HTMLElement {
  const container = document.createElement("div");
  render(value, container);
  return container;
}

function chipTexts(container: HTMLElement): string[] {
  return [...container.querySelectorAll(".label-chip")].map((el) =>
    (el.textContent ?? "").trim()
  );
}

describe("resolveLabelIds", () => {
  const catalog = [label("a", "Alpha"), label("b", "Beta"), label("c", "Gamma")];

  it("returns an empty array for null / undefined / empty id lists", () => {
    expect(resolveLabelIds(null, catalog)).toEqual([]);
    expect(resolveLabelIds(undefined, catalog)).toEqual([]);
    expect(resolveLabelIds([], catalog)).toEqual([]);
  });

  it("resolves ids to labels in the device's source order, not catalog order", () => {
    // Device carries c, a — catalog stores a, b, c. Source order wins.
    const resolved = resolveLabelIds(["c", "a"], catalog);
    expect(resolved.map((l) => l.id)).toEqual(["c", "a"]);
    expect(resolved.map((l) => l.name)).toEqual(["Gamma", "Alpha"]);
  });

  it("silently drops ids the catalog doesn't know, keeping the known ones in order", () => {
    expect(resolveLabelIds(["a", "missing", "c"], catalog).map((l) => l.id)).toEqual([
      "a",
      "c",
    ]);
  });

  it("returns an empty array when no id resolves", () => {
    expect(resolveLabelIds(["x", "y"], catalog)).toEqual([]);
  });

  it("preserves a repeated id as a repeated label (no de-dup)", () => {
    // Each occurrence in the source list maps independently — the
    // helper does not collapse duplicates.
    expect(resolveLabelIds(["a", "a"], catalog).map((l) => l.id)).toEqual(["a", "a"]);
  });

  it("returns catalog label objects by reference, not copies", () => {
    expect(resolveLabelIds(["b"], catalog)[0]).toBe(catalog[1]);
  });

  it("resolves against an empty catalog by dropping everything", () => {
    expect(resolveLabelIds(["a", "b"], [])).toEqual([]);
  });
});

describe("renderLabelChip", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("renders the label name as the chip text", () => {
    const container = renderInto(renderLabelChip(label("a", "Kitchen")));
    expect(chipTexts(container)).toEqual(["Kitchen"]);
  });

  it("sets the chip's title to the label name by default", () => {
    const container = renderInto(renderLabelChip(label("a", "Kitchen")));
    expect(container.querySelector(".label-chip")?.getAttribute("title")).toBe("Kitchen");
  });

  it("suppresses the chip's native tooltip when suppressTitle is set", () => {
    const container = renderInto(
      renderLabelChip(label("a", "Kitchen"), { suppressTitle: true })
    );
    // The parent owns the row-level title; the chip must not also
    // carry one, or two tooltips fight for the same row.
    expect(container.querySelector(".label-chip")?.hasAttribute("title")).toBe(false);
  });

  it("applies an inline style derived from the label color", () => {
    const container = renderInto(renderLabelChip(label("a", "Kitchen", "#dc2626")));
    const style = container.querySelector(".label-chip")?.getAttribute("style") ?? "";
    // Pin the actual contract: the provided hex is the chip background,
    // not a neutral fallback. A bare `toContain("background")` would
    // also pass for the neutral palette (or an empty value).
    expect(style).toMatch(/(^|;)background:\s*#dc2626/);
    // Foreground `color:` segment specifically — a bare
    // `toContain("color")` is satisfied by `border-color` and wouldn't
    // catch the foreground color being dropped.
    expect(style).toMatch(/(^|;)color:/);
    // Border is derived from the same hue, so it carries the hex too.
    expect(style).toMatch(/border-color:[^;]*#dc2626/);
  });
});

describe("renderLabelChips", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  const labels = [
    label("a", "Alpha"),
    label("b", "Beta"),
    label("c", "Gamma"),
    label("d", "Delta"),
  ];

  it("returns the Lit `nothing` sentinel for an empty list", () => {
    // Documented contract: the caller doesn't have to gate on empty.
    expect(renderLabelChips([])).toBe(nothing);
  });

  it("renders no chips for an empty list", () => {
    expect(chipTexts(renderInto(renderLabelChips([])))).toEqual([]);
  });

  it("renders every chip when max is omitted", () => {
    expect(chipTexts(renderInto(renderLabelChips(labels)))).toEqual([
      "Alpha",
      "Beta",
      "Gamma",
      "Delta",
    ]);
  });

  it("renders every chip when max is explicitly null", () => {
    expect(chipTexts(renderInto(renderLabelChips(labels, { max: null })))).toEqual([
      "Alpha",
      "Beta",
      "Gamma",
      "Delta",
    ]);
  });

  it("renders every chip (no overflow) when the count equals max", () => {
    const container = renderInto(renderLabelChips(labels, { max: 4 }));
    expect(chipTexts(container)).toEqual(["Alpha", "Beta", "Gamma", "Delta"]);
    expect(container.querySelector(".label-chip--overflow")).toBeNull();
  });

  it("collapses the tail into a +N overflow chip when count exceeds max", () => {
    const container = renderInto(renderLabelChips(labels, { max: 2 }));
    // Two visible labels, then the "+2" overflow chip.
    expect(chipTexts(container)).toEqual(["Alpha", "Beta", "+2"]);
    expect(container.querySelector(".label-chip--overflow")).not.toBeNull();
  });

  it("lists the hidden label names in the overflow chip's tooltip", () => {
    const container = renderInto(renderLabelChips(labels, { max: 2 }));
    expect(container.querySelector(".label-chip--overflow")?.getAttribute("title")).toBe(
      "Gamma, Delta"
    );
  });
});
