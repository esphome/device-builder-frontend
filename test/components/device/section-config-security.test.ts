/**
 * @vitest-environment happy-dom
 *
 * Pins that the host applies the security notice's generated secrets into the
 * unsaved draft: `applySectionValues` sets each path and flushes one
 * `yaml-draft` so the `!secret` reference(s) land in the editor buffer.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("sonner-js", () => ({
  default: { error: vi.fn(), info: vi.fn(), success: vi.fn() },
}));

import { ESPHomeDeviceSectionConfig } from "../../../src/components/device/device-section-config.js";
import { applySectionValues } from "../../../src/components/device/device-section-config/draft-and-delete.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
function host(sectionKey: string, yaml: string, fromLine: number, values: object) {
  const c = new ESPHomeDeviceSectionConfig();
  const inner = c as any;
  inner.yaml = yaml;
  inner.sectionKey = sectionKey;
  inner.fromLine = fromLine;
  inner._config = { entries: [] };
  inner._presentComponents = new Set<string>();
  inner._values = values;
  const drafts: string[] = [];
  c.addEventListener("yaml-draft", (e) =>
    drafts.push((e as CustomEvent).detail.yaml as string)
  );
  return { c, inner, drafts };
}

describe("applySectionValues", () => {
  it("api: sets encryption.key and dispatches one yaml-draft", () => {
    const { c, inner, drafts } = host("api", "api:\n  id: api_server\n", 1, {
      id: "api_server",
    });
    applySectionValues(c, [
      { path: ["encryption", "key"], value: "!secret kitchen__encryption_key" },
    ]);
    expect(inner._values.encryption.key).toBe("!secret kitchen__encryption_key");
    expect(drafts).toHaveLength(1);
    expect(drafts[0]).toContain("!secret kitchen__encryption_key");
  });

  it("ota: sets password on the list item", () => {
    const { c, inner, drafts } = host("ota.esphome", "ota:\n  - platform: esphome\n", 2, {
      platform: "esphome",
    });
    applySectionValues(c, [
      { path: ["password"], value: "!secret kitchen__ota_password" },
    ]);
    expect(inner._values.password).toBe("!secret kitchen__ota_password");
    expect(drafts[0]).toContain("password: !secret kitchen__ota_password");
  });

  it("web_server: sets inline username + secret password in one flush", () => {
    const { c, inner, drafts } = host("web_server", "web_server:\n  port: 80\n", 1, {
      port: 80,
    });
    applySectionValues(c, [
      { path: ["auth", "username"], value: "falcon" },
      { path: ["auth", "password"], value: "!secret kitchen__web_password" },
    ]);
    expect(inner._values.auth).toEqual({
      username: "falcon",
      password: "!secret kitchen__web_password",
    });
    expect(drafts).toHaveLength(1);
    expect(drafts[0]).toContain("username: falcon");
    expect(drafts[0]).toContain("!secret kitchen__web_password");
  });
});
