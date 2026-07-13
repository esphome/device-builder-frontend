// @vitest-environment happy-dom
//
// The platform chip disambiguates two cards that share a name within one
// category (stepper.a4988 / stepper.uln2003): it renders only when
// renderCard is told the entry is ambiguous, and carries the id's stem.

import { describe, expect, it } from "vitest";

import {
  type ComponentCatalogEntry,
  ComponentCategory,
} from "../../../../src/api/types/components.js";
import { renderCard } from "../../../../src/components/device/component-catalog/renderers.js";
import { identityLocalize as localize, renderInto } from "../../../_dom.js";

function host(category = "stepper"): unknown {
  return {
    _imageFailed: new Set<string>(),
    _overflowingDescriptions: new Set<string>(),
    _category: category,
    _onAdd: () => {},
    _onToggleExpand: () => {},
    _onImageError: () => {},
  };
}

function entry(id: string): ComponentCatalogEntry {
  return {
    id,
    name: "Stepper Component",
    description: "",
    category: ComponentCategory.STEPPER,
    docs_url: "",
    image_url: "",
    dependencies: [],
    multi_conf: true,
    supported_platforms: [],
    config_entries: [],
  };
}

describe("renderCard platform chip", () => {
  it("renders the platform stem when the entry is ambiguous", () => {
    const el = renderInto(
      renderCard(host() as never, entry("stepper.a4988"), false, false, localize, true)
    );
    const chips = [...el.querySelectorAll(".component-category-chip")].map((c) =>
      c.textContent?.trim()
    );
    expect(chips).toContain("A4988");
  });

  it("omits the platform chip when the entry is not ambiguous", () => {
    const el = renderInto(
      renderCard(host() as never, entry("stepper.a4988"), false, false, localize, false)
    );
    // Under a single-category filter the category chip is suppressed too,
    // so no chip should render at all.
    expect(el.querySelector(".component-category-chip")).toBeNull();
  });
});
