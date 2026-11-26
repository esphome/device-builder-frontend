/** @vitest-environment happy-dom */
import { describe, expect, it, vi } from "vitest";

vi.mock("../../src/util/navigation.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/util/navigation.js")>()),
  navigate: vi.fn().mockResolvedValue(true),
}));

import { identityLocalize as t } from "../_dom.js";
import { buildCommands } from "../../src/components/command-palette-actions.js";
import { navigate } from "../../src/util/navigation.js";
import { renderOpenHeaderMenu } from "./_esphome-header-actions-helpers.js";

describe("Packages entry points", () => {
  it("header menu item opens /packages", async () => {
    const el = await renderOpenHeaderMenu();
    const icon = el.shadowRoot!.querySelector('wa-icon[name="package-variant-closed"]');
    expect(icon).not.toBeNull();

    (icon!.closest(".menu-item") as HTMLElement).click();
    expect(navigate).toHaveBeenCalledWith("/packages");
  });

  it("command palette has a Packages navigation entry", () => {
    const commands = buildCommands({
      t,
      devices: [],
      setTheme: vi.fn(),
      setLanguage: vi.fn(),
      toggleExpertMode: vi.fn(),
      openUpdateAll: vi.fn(),
      expertMode: false,
    });
    const entry = commands.find((c) => c.id === "nav.packages");
    expect(entry?.label).toBe("layout.packages");

    entry!.run();
    expect(navigate).toHaveBeenCalledWith("/packages");
  });
});
