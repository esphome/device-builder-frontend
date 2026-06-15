// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";

// Stub the real wa-dialog: happy-dom can't run its form-associated internals.
vi.mock("@home-assistant/webawesome/dist/components/dialog/dialog.js", () => ({}));

import { buildCommands } from "../../src/components/command-palette-actions.js";
import { ESPHomeCommandPalette } from "../../src/components/command-palette.js";

const t = (key: string) => key;

describe("buildCommands Expert Mode entry", () => {
  it("labels the entry by state and wires the toggle", () => {
    const toggleExpertMode = vi.fn();
    const base = {
      t,
      devices: [],
      setTheme: vi.fn(),
      setLanguage: vi.fn(),
      toggleExpertMode,
    };

    const off = buildCommands({ ...base, expertMode: false });
    const entryOff = off.find((c) => c.id === "settings.expert_mode");
    expect(entryOff?.label).toBe("command_palette.enable_expert_mode");

    const on = buildCommands({ ...base, expertMode: true });
    const entryOn = on.find((c) => c.id === "settings.expert_mode");
    expect(entryOn?.label).toBe("command_palette.disable_expert_mode");

    entryOn?.run();
    expect(toggleExpertMode).toHaveBeenCalledOnce();
  });
});

describe("command palette YAML search gating", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  async function openWith(expertMode: boolean): Promise<ESPHomeCommandPalette> {
    const palette = new ESPHomeCommandPalette();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (palette as any)._expertMode = expertMode;
    document.body.appendChild(palette);
    await palette.updateComplete;
    palette.open();
    await palette.updateComplete;
    return palette;
  }

  it("ignores the / prefix and hides the YAML affordances when Expert Mode is off", async () => {
    const palette = await openWith(false);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (palette as any)._query = "/wifi";
    await palette.updateComplete;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((palette as any)._isYamlMode).toBe(false);
    expect(palette.shadowRoot!.querySelector(".mode-toggle")).toBeNull();
    expect(palette.shadowRoot!.querySelector(".yaml-hint")).toBeNull();
  });

  it("enters YAML mode on the / prefix and shows the affordances when Expert Mode is on", async () => {
    const palette = await openWith(true);
    expect(palette.shadowRoot!.querySelector(".mode-toggle")).not.toBeNull();
    expect(palette.shadowRoot!.querySelector(".yaml-hint")).not.toBeNull();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (palette as any)._query = "/wifi";
    await palette.updateComplete;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((palette as any)._isYamlMode).toBe(true);
  });
});
