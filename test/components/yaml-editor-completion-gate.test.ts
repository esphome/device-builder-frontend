/**
 * @vitest-environment happy-dom
 *
 * Pins the editor's backend extension gate: lint needs a device
 * ``configuration``; schema completion + hover also run for a file editor
 * that opts in with ``completion``, and stay off otherwise (secrets.yaml).
 */
import { describe, expect, it } from "vitest";

import type { ESPHomeAPI } from "../../src/api/index.js";
import { ESPHomeYamlEditor } from "../../src/components/yaml-editor.js";

function extensionCount(props: { configuration?: string; completion?: boolean }): number {
  const el = new ESPHomeYamlEditor();
  Object.assign(el, props);
  (el as unknown as { _api: ESPHomeAPI })._api = {} as ESPHomeAPI;
  return (el as unknown as { _buildExtensions(): unknown[] })._buildExtensions().length;
}

describe("yaml-editor backend extension gate", () => {
  it("adds completion + hover for an opted-in file editor, without lint", () => {
    const plain = extensionCount({});
    const file = extensionCount({ completion: true });
    const device = extensionCount({ configuration: "kitchen.yaml" });

    // completion, idle-completion trigger, hover
    expect(file - plain).toBe(3);
    // the device editor also gets the linter and its gutter
    expect(device - file).toBe(2);
  });
});
