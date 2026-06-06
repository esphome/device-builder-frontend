/**
 * @vitest-environment happy-dom
 *
 * Pins that the host applies the api-encryption notice's generated key into the
 * unsaved draft: `applyEncryptionKey` sets `api.encryption.key` and flushes a
 * `yaml-draft` so the reference lands in the editor buffer.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("sonner-js", () => ({
  default: { error: vi.fn(), info: vi.fn(), success: vi.fn() },
}));

import { ESPHomeDeviceSectionConfig } from "../../../src/components/device/device-section-config.js";
import { applyEncryptionKey } from "../../../src/components/device/device-section-config/draft-and-delete.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
describe("applyEncryptionKey", () => {
  it("sets api.encryption.key and dispatches yaml-draft", () => {
    const c = new ESPHomeDeviceSectionConfig();
    const inner = c as any;
    inner.yaml = "api:\n  id: api_server\n";
    inner.sectionKey = "api";
    inner.fromLine = 1;
    inner._config = { entries: [] };
    inner._presentComponents = new Set<string>();
    inner._values = { id: "api_server" };

    const drafts: string[] = [];
    c.addEventListener("yaml-draft", (e) =>
      drafts.push((e as CustomEvent).detail.yaml as string)
    );

    applyEncryptionKey(c, "kitchen__encryption_key");

    expect(inner._values.encryption.key).toBe("!secret kitchen__encryption_key");
    expect(drafts[0]).toContain("encryption:");
    expect(drafts[0]).toContain("!secret kitchen__encryption_key");
  });
});
