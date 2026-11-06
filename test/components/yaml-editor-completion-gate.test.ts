/**
 * @vitest-environment happy-dom
 *
 * Pins the editor's extension gates: lint needs a device ``configuration``;
 * schema completion + hover also run for a file editor that opts in with
 * ``completion``; include links need a file to resolve against. All stay off
 * for secrets.yaml.
 */
import { describe, expect, it } from "vitest";

import type { ESPHomeAPI } from "../../src/api/index.js";
import { ESPHomeYamlEditor } from "../../src/components/yaml-editor.js";

function extensionCount(props: {
  configuration?: string;
  completion?: boolean;
  filePath?: string;
}): number {
  const el = new ESPHomeYamlEditor();
  Object.assign(el, props);
  (el as unknown as { _api: ESPHomeAPI })._api = {} as ESPHomeAPI;
  return (el as unknown as { _buildExtensions(): unknown[] })._buildExtensions().length;
}

describe("yaml-editor backend extension gate", () => {
  it("adds completion + hover for an opted-in file editor, without lint", () => {
    const plain = extensionCount({});
    const file = extensionCount({ completion: true, filePath: "common/base.yaml" });
    const device = extensionCount({ configuration: "kitchen.yaml" });

    // include links, completion, idle-completion trigger, hover
    expect(file - plain).toBe(4);
    // the device editor also gets the linter and its gutter
    expect(device - file).toBe(2);
  });

  it("links includes only when the editor knows which file it holds", () => {
    // secrets.yaml: neither a configuration nor a file path
    expect(extensionCount({ filePath: "common/base.yaml" }) - extensionCount({})).toBe(1);
  });
});
