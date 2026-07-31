/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("../../../src/util/navigation.js", () => ({ navigate: vi.fn() }));

import type { ConfiguredDevice } from "../../../src/api/types/devices.js";
import { editDeviceSection } from "../../../src/components/dashboard/actions.js";
import { navigate } from "../../../src/util/navigation.js";

describe("editDeviceSection", () => {
  it("deep-links to the editor with the section and one-shot reveal params", () => {
    editDeviceSection({ configuration: "kitchen.yaml" } as ConfiguredDevice, "api");
    expect(navigate).toHaveBeenCalledWith("/device/kitchen.yaml?section=api&reveal=1");
  });

  it("URI-encodes the configuration and the section", () => {
    editDeviceSection({ configuration: "foo (1).yaml" } as ConfiguredDevice, "api");
    expect(navigate).toHaveBeenCalledWith("/device/foo%20(1).yaml?section=api&reveal=1");
  });
});
