import memoizeOne from "memoize-one";
import { afterEach, describe, expect, it } from "vitest";
import { deriveNavigatorBuckets } from "../../../src/components/device/navigator-buckets.js";
import {
  _clearRenamedKeys,
  recordRenamedKeys,
  renamedKeysGeneration,
} from "../../../src/util/renamed-keys.js";
import { _clearYamlSectionsMemo } from "../../../src/util/yaml-sections-core.js";

afterEach(() => {
  _clearYamlSectionsMemo();
  _clearRenamedKeys();
});

describe("deriveNavigatorBuckets", () => {
  it("re-derives through the memo when the renamed-keys generation advances", () => {
    const derive = memoizeOne(deriveNavigatorBuckets);
    const yaml = [
      "api:",
      "  services:",
      "    - service: start_va",
      "      then:",
      "        - logger.log: go",
      "",
    ].join("\n");
    const before = derive(yaml, renamedKeysGeneration());
    expect(before.automations.map((s) => s.key)).toEqual([]);
    recordRenamedKeys("api", { services: "actions", service: "action" });
    const after = derive(yaml, renamedKeysGeneration());
    expect(after.automations.map((s) => s.key)).toEqual([
      "automation:api_action:start_va",
    ]);
  });
});
