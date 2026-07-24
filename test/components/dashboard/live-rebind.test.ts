import { describe, expect, it } from "vitest";

import { relinkLive } from "../../../src/components/dashboard/live-rebind.js";
import { makeConfiguredDevice } from "../../_make-configured-device.js";

describe("relinkLive", () => {
  const stale = makeConfiguredDevice({ configuration: "kitchen.yaml" });

  it("returns the live object sharing the snapshot's configuration", () => {
    const live = makeConfiguredDevice({ configuration: "kitchen.yaml" });
    expect(relinkLive([live], stale)).toBe(live);
  });

  it("returns null when the device left the list", () => {
    const other = makeConfiguredDevice({ configuration: "garage.yaml" });
    expect(relinkLive([other], stale)).toBeNull();
  });

  it("returns null on an empty list", () => {
    expect(relinkLive([], stale)).toBeNull();
  });
});
