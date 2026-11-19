import { describe, expect, it } from "vitest";
import { makeConfiguredDevice } from "../_make-configured-device.js";
import { DeviceState } from "../../src/api/types/devices.js";
import {
  anchorOffline,
  effectiveDeviceState,
  hasNoNetwork,
  isStatusHidden,
  offlineSeconds,
} from "../../src/util/device-status.js";

const NOW_MS = 1_800_000_000_000;
const SINCE = NOW_MS / 1000 - 7200;

describe("offlineSeconds", () => {
  it("measures from the offline stamp", () => {
    expect(offlineSeconds(DeviceState.OFFLINE, false, false, SINCE, NOW_MS)).toBe(7200);
  });

  it("is null without a stamp", () => {
    expect(offlineSeconds(DeviceState.OFFLINE, false, false, null, NOW_MS)).toBeNull();
  });

  it.each([DeviceState.ONLINE, DeviceState.UNKNOWN])("is null while %s", (state) => {
    expect(offlineSeconds(state, false, false, SINCE, NOW_MS)).toBeNull();
  });

  it("is null while the offline verdict is untracked", () => {
    expect(offlineSeconds(DeviceState.OFFLINE, true, false, SINCE, NOW_MS)).toBeNull();
  });
});

describe("offlineSeconds with no network", () => {
  it("is null while the status is hidden", () => {
    expect(offlineSeconds(DeviceState.OFFLINE, false, true, SINCE, NOW_MS)).toBeNull();
  });
});

describe("hasNoNetwork", () => {
  it("proves nothing for an empty (never compiled) list", () => {
    expect(hasNoNetwork([])).toBe(false);
  });

  it.each(["wifi", "ethernet", "openthread"])("is false when %s is loaded", (s) => {
    expect(hasNoNetwork(["api", s, "logger"])).toBe(false);
  });

  it("is true for a compiled list without any network component", () => {
    expect(hasNoNetwork(["api", "logger"])).toBe(true);
  });
});

describe("isStatusHidden", () => {
  it.each([DeviceState.OFFLINE, DeviceState.UNKNOWN])(
    "hides %s without a network",
    (s) => {
      expect(isStatusHidden(s, true)).toBe(true);
    }
  );

  it("lets a real ONLINE verdict win", () => {
    expect(isStatusHidden(DeviceState.ONLINE, true)).toBe(false);
  });

  it("never hides a device with a network", () => {
    expect(isStatusHidden(DeviceState.OFFLINE, false)).toBe(false);
  });
});

describe("effectiveDeviceState", () => {
  const noNet = ["api", "logger"];

  it("is null for a no-network device that is not online", () => {
    const d = makeConfiguredDevice({
      loaded_integrations: noNet,
      runtime_state: { state: DeviceState.OFFLINE },
    });
    expect(effectiveDeviceState(d)).toBeNull();
  });

  it("takes precedence over the untracked state", () => {
    const d = makeConfiguredDevice({
      loaded_integrations: noNet,
      name_add_mac_suffix: true,
      runtime_state: { state: DeviceState.OFFLINE },
    });
    expect(effectiveDeviceState(d)).toBeNull();
  });

  it("keeps a real ONLINE verdict", () => {
    const d = makeConfiguredDevice({
      loaded_integrations: noNet,
      runtime_state: { state: DeviceState.ONLINE },
    });
    expect(effectiveDeviceState(d)).toBe(DeviceState.ONLINE);
  });

  it("still reports untracked and the raw state otherwise", () => {
    const flagged = makeConfiguredDevice({
      name_add_mac_suffix: true,
      runtime_state: { state: DeviceState.OFFLINE },
    });
    expect(effectiveDeviceState(flagged)).toBe("untracked");
    expect(
      effectiveDeviceState(
        makeConfiguredDevice({ runtime_state: { state: DeviceState.ONLINE } })
      )
    ).toBe(DeviceState.ONLINE);
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
