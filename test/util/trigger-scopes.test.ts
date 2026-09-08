import { describe, expect, it } from "vitest";

import type { AutomationTrigger } from "../../src/api/types/automations.js";
import {
  bareTriggerKey,
  handlerScopes,
  targetScopes,
  triggerAppliesTo,
  triggerForKey,
} from "../../src/util/trigger-scopes.js";

const trigger = (
  id: string,
  applies_to: string[],
  is_device_level = false
): AutomationTrigger => ({
  id,
  name: id,
  description: "",
  docs_url: "",
  applies_to,
  is_device_level,
  supports_list: false,
  config_entries: [],
});

const domainTouch = trigger("touchscreen.on_touch", ["touchscreen"]);
const driverTouch = trigger("xpt2046.touchscreen.on_touch", ["touchscreen.xpt2046"]);
const boot = trigger("on_boot", [], true);

describe("bareTriggerKey", () => {
  it("drops the domain prefix from a catalog id", () => {
    expect(bareTriggerKey("switch.on_turn_on")).toBe("on_turn_on");
  });

  it("drops the platform and domain prefix from a platform-scoped id", () => {
    expect(bareTriggerKey("rotary_encoder.sensor.on_clockwise")).toBe("on_clockwise");
  });

  it("passes an already-bare key through", () => {
    expect(bareTriggerKey("on_boot")).toBe("on_boot");
  });
});

describe("scopes", () => {
  it("orders an instance's scopes most specific first", () => {
    expect(targetScopes("sensor.rotary_encoder")).toEqual([
      "sensor.rotary_encoder",
      "sensor",
    ]);
    expect(targetScopes("sensor")).toEqual(["sensor"]);
  });

  it("orders a handler row's scopes most specific first", () => {
    expect(handlerScopes("sensor", "rotary_encoder")).toEqual([
      "sensor.rotary_encoder",
      "sensor",
    ]);
    expect(handlerScopes("sun")).toEqual(["sun"]);
  });

  it("keeps an already namespaced platform as the qualified scope", () => {
    expect(handlerScopes("light", "light.rgb")).toEqual(["light.rgb", "light"]);
  });

  it("matches component triggers on any scope and never device-level ones", () => {
    expect(triggerAppliesTo(driverTouch, ["touchscreen.xpt2046", "touchscreen"])).toBe(
      true
    );
    expect(triggerAppliesTo(driverTouch, ["touchscreen"])).toBe(false);
    expect(triggerAppliesTo(boot, ["esphome"])).toBe(false);
  });
});

describe("triggerForKey", () => {
  const triggers = [domainTouch, driverTouch];

  it("prefers the platform-scoped trigger for a platform instance regardless of catalog order", () => {
    const scopes = ["touchscreen.xpt2046", "touchscreen"];
    expect(triggerForKey(triggers, scopes, "on_touch")).toBe(driverTouch);
    expect(triggerForKey([driverTouch, domainTouch], scopes, "on_touch")).toBe(
      driverTouch
    );
  });

  it("falls back to the domain-level trigger for a bare domain scope", () => {
    expect(triggerForKey(triggers, ["touchscreen"], "on_touch")).toBe(domainTouch);
  });

  it("returns undefined when no scope hosts the key", () => {
    expect(triggerForKey(triggers, ["touchscreen"], "on_release")).toBeUndefined();
    expect(triggerForKey(triggers, ["sensor"], "on_touch")).toBeUndefined();
  });
});
