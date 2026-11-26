import { describe, expect, it, vi } from "vitest";

vi.mock("../../src/util/navigation.js", () => ({
  navigate: vi.fn().mockResolvedValue(true),
}));

import { identityLocalize as t } from "../_dom.js";
import { makeConfiguredDevice } from "../_make-configured-device.js";
import { buildCommands } from "../../src/components/command-palette-actions.js";
import { navigate } from "../../src/util/navigation.js";

describe("buildCommands device entries", () => {
  it("opens a nested device's editor with its slashes kept and segments encoded", () => {
    const commands = buildCommands({
      t,
      devices: [
        makeConfiguredDevice({
          name: "desk",
          friendly_name: "Desk Lamp",
          configuration: "devices/lights/desk lamp.yaml",
        }),
      ],
      expertMode: false,
      setTheme: vi.fn(),
      setLanguage: vi.fn(),
      toggleExpertMode: vi.fn(),
      openUpdateAll: vi.fn(),
    });
    const entry = commands.find((c) => c.id === "device.devices/lights/desk lamp.yaml")!;

    expect(entry.label).toBe("Desk Lamp");
    entry.run();

    expect(navigate).toHaveBeenCalledWith("/device/devices/lights/desk%20lamp.yaml");
  });
});
