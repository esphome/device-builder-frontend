/**
 * Pins the navigator error badge: a row whose section instance carries
 * backend errors renders a labeled count pill, and a collapsed domain
 * subgroup surfaces the sum on its header so errored rows stay findable.
 */
import { describe, expect, it } from "vitest";
import type { NavRow } from "../../../src/components/device/navigator-labels.js";
import {
  renderNavSection,
  type NavSectionView,
} from "../../../src/components/device/navigator-render.js";
import type { YamlSection } from "../../../src/util/yaml-sections.js";
import {
  extractAttributeBindings,
  findTemplatesByAnchor,
} from "../../_lit-template-walker.js";

function section(key: string, fromLine: number): YamlSection {
  return { key, fromLine, toLine: fromLine + 2 };
}

const row = (item: YamlSection): NavRow => ({ item, labels: { primary: item.key } });

function makeView(overrides: Partial<NavSectionView>): NavSectionView {
  return {
    label: "Components",
    icon: "chip",
    desc: "",
    actions: [],
    rows: [],
    open: true,
    filtering: false,
    selectedLine: null,
    hoveredLine: null,
    errorLabel: (count) => `${count} validation errors`,
    onToggle: () => {},
    onItemEnter: () => {},
    onItemLeave: () => {},
    onItemClick: () => {},
    ...overrides,
  };
}

function badges(view: NavSectionView) {
  return findTemplatesByAnchor(renderNavSection(view), "nav-item-error-badge").map(
    (t) => ({
      bindings: extractAttributeBindings(t),
      count: t.values[t.values.length - 1],
    })
  );
}

describe("navigator error badge", () => {
  it("renders a labeled count pill on an errored row", () => {
    const errored = section("sensor", 9);
    const clean = section("wifi", 4);
    const view = makeView({
      rows: [row(errored), row(clean)],
      errorCount: (item) => (item.fromLine === 9 ? 2 : 0),
    });
    const found = badges(view);
    expect(found).toHaveLength(1);
    expect(found[0].count).toBe(2);
    expect(found[0].bindings["aria-label"]).toBe("2 validation errors");
  });

  it("renders no badge without an errorCount callback", () => {
    const view = makeView({ rows: [row(section("wifi", 4))] });
    expect(badges(view)).toHaveLength(0);
  });

  it("sums the rows onto a collapsed subgroup header", () => {
    const a = section("sensor", 9);
    const b = section("sensor", 12);
    const view = makeView({
      rows: [row(a), row(b)],
      groups: [{ key: "sensor", rows: [row(a), row(b)] }],
      collapsedGroups: new Set(["sensor"]),
      errorCount: () => 1,
    });
    const found = badges(view);
    expect(found).toHaveLength(1);
    expect(found[0].count).toBe(2);
  });

  it("leaves an expanded subgroup header unbadged; rows carry their own", () => {
    const a = section("sensor", 9);
    const view = makeView({
      rows: [row(a)],
      groups: [{ key: "sensor", rows: [row(a), row(section("sensor", 12))] }],
      collapsedGroups: new Set(),
      errorCount: (item) => (item.fromLine === 9 ? 1 : 0),
    });
    const found = badges(view);
    expect(found).toHaveLength(1);
    expect(found[0].count).toBe(1);
  });
});
