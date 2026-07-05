/**
 * @vitest-environment happy-dom
 *
 * Pins the shared settings row helpers: live toggle markup + a11y wiring, the
 * `null` loading variant, the `expert-row` class pass-through, and the status /
 * alert role.
 */
import { describe, expect, it, vi } from "vitest";

import {
  renderStatusRow,
  renderToggleRow,
} from "../../../src/components/settings-dialog/settings-rows.js";
import { identityLocalize as localize, renderInto } from "../../_dom.js";

describe("renderToggleRow", () => {
  it("renders the live toggle with a11y wiring and fires onToggle", () => {
    const onToggle = vi.fn();
    const el = renderInto(
      renderToggleRow(localize, {
        titleId: "my-title",
        titleKey: "settings.my_title",
        descKey: "settings.my_desc",
        checked: true,
        onToggle,
      })
    );

    const title = el.querySelector(".row-title")!;
    expect(title.id).toBe("my-title");
    expect(title.textContent?.trim()).toBe("settings.my_title");
    expect(el.querySelector(".row-desc")?.textContent?.trim()).toBe("settings.my_desc");

    const btn = el.querySelector<HTMLButtonElement>('button.toggle[role="switch"]')!;
    expect(btn.getAttribute("aria-labelledby")).toBe("my-title");
    expect(btn.getAttribute("aria-checked")).toBe("true");

    btn.click();
    expect(onToggle).toHaveBeenCalledOnce();
  });

  it("applies an extra row class", () => {
    const el = renderInto(
      renderToggleRow(localize, {
        titleId: "x",
        titleKey: "k",
        descKey: "d",
        checked: false,
        onToggle: () => {},
        rowClass: "expert-row",
      })
    );
    const row = el.querySelector(".row")!;
    expect(row.classList.contains("expert-row")).toBe(true);
  });

  it("renders the loading variant (no button) when checked is null", () => {
    const el = renderInto(
      renderToggleRow(localize, {
        titleId: "x",
        titleKey: "settings.loading_title",
        descKey: "settings.loaded_desc",
        loadingDescKey: "settings.loading_desc",
        checked: null,
        onToggle: () => {},
      })
    );
    expect(el.querySelector("button.toggle")).toBeNull();
    expect(el.querySelector('.row[role="status"]')).not.toBeNull();
    expect(el.querySelector(".row-title")?.textContent?.trim()).toBe(
      "settings.loading_title"
    );
    expect(el.querySelector(".row-desc")?.textContent?.trim()).toBe(
      "settings.loading_desc"
    );
  });
});

describe("renderStatusRow", () => {
  it("defaults to role=status with the localized key", () => {
    const el = renderInto(renderStatusRow(localize, "settings.empty"));
    const row = el.querySelector(".row")!;
    expect(row.getAttribute("role")).toBe("status");
    expect(el.querySelector(".row-desc")?.textContent?.trim()).toBe("settings.empty");
    expect(el.querySelector("button")).toBeNull();
  });

  it("supports role=alert", () => {
    const el = renderInto(renderStatusRow(localize, "settings.failed", "alert"));
    expect(el.querySelector(".row")!.getAttribute("role")).toBe("alert");
  });
});
