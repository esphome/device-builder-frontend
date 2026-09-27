import { describe, expect, it } from "vitest";
import { makeConfiguredDevice } from "../_make-configured-device.js";
import { DeviceState } from "../../src/api/types/devices.js";
import { anchorOffline, offlineSeconds } from "../../src/util/device-status.js";

const NOW_MS = 1_800_000_000_000;
const SINCE = NOW_MS / 1000 - 7200;

describe("offlineSeconds", () => {
  it("measures from the offline stamp", () => {
    expect(offlineSeconds(DeviceState.OFFLINE, false, SINCE, NOW_MS)).toBe(7200);
  });

  it("is null without a stamp", () => {
    expect(offlineSeconds(DeviceState.OFFLINE, false, null, NOW_MS)).toBeNull();
  });

  it.each([DeviceState.ONLINE, DeviceState.UNKNOWN])("is null while %s", (state) => {
    expect(offlineSeconds(state, false, SINCE, NOW_MS)).toBeNull();
  });

  it("is null while the offline verdict is untracked", () => {
    expect(offlineSeconds(DeviceState.OFFLINE, true, SINCE, NOW_MS)).toBeNull();
  });
});

describe("anchorOffline", () => {
  it("stamps the age against the browser clock", () => {
    const device = makeConfiguredDevice({ runtime_state: { offline_seconds: 7200 } });
    expect(anchorOffline(device, NOW_MS).runtime_state.offline_since).toBe(SINCE);
  });

  it("leaves no stamp without an age", () => {
    const device = makeConfiguredDevice();
    expect(anchorOffline(device, NOW_MS).runtime_state.offline_since).toBeNull();
  });
});
