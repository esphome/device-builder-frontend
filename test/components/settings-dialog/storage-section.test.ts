/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it, vi } from "vitest";

import "../../_mock-webawesome.js";

import { argsLocalize, mount } from "../../_dom.js";
import type { ConfiguredDevice } from "../../../src/api/types/devices.js";
import type { DiskUsage } from "../../../src/api/types/system.js";
import type { LocalizeFunc } from "../../../src/common/localize.js";
import { ESPHomeSettingsStorage } from "../../../src/components/settings-dialog/storage-section.js";

const GB = 1024 ** 3;

function usage(over: Partial<DiskUsage> = {}): DiskUsage {
  return {
    total_bytes: 100 * GB,
    free_bytes: 40 * GB,
    builds_bytes: 2 * GB,
    remote_builds_bytes: 0,
    toolchains_bytes: 4 * GB,
    cache_bytes: 1 * GB,
    config_bytes: 3 * 1024 ** 2,
    measured_at: 1,
    ...over,
  };
}

function device(name: string, build_size_bytes: number): ConfiguredDevice {
  return { name, friendly_name: "", build_size_bytes } as ConfiguredDevice;
}

interface Internals {
  _localize: LocalizeFunc;
  _usage: DiskUsage | null;
  _devices: ConfiguredDevice[];
}

async function render(state: Partial<Internals>): Promise<ShadowRoot> {
  const el = new ESPHomeSettingsStorage();
  Object.assign(el as unknown as Internals, {
    _localize: argsLocalize as LocalizeFunc,
    ...state,
  });
  await mount(el);
  return el.shadowRoot!;
}

const text = (root: ShadowRoot) => root.textContent ?? "";

describe("esphome-settings-storage", () => {
  it("shows a measuring status until the first measurement lands", async () => {
    const root = await render({ _usage: null });
    expect(root.querySelector('[role="status"]')?.textContent).toContain(
      "settings.storage_measuring"
    );
    expect(root.querySelector(".bar")).toBeNull();
  });

  it("renders free space, the bar and each category", async () => {
    const root = await render({ _usage: usage() });
    expect(text(root)).toContain("settings.storage_free | 40.0 GB");
    expect(text(root)).toContain("settings.storage_total | 100.0 GB");
    // Toolchains and caches are reported together: both go on a reset.
    expect(text(root)).toContain("5.0 GB");
    expect(root.querySelectorAll(".bar > span")).toHaveLength(4);
    expect(root.querySelector(".alert")).toBeNull();
  });

  it("hides the build-server row until this dashboard builds for others", async () => {
    expect(text(await render({ _usage: usage() }))).not.toContain(
      "settings.storage_remote_builds_desc"
    );
    expect(text(await render({ _usage: usage({ remote_builds_bytes: GB }) }))).toContain(
      "settings.storage_remote_builds_desc"
    );
  });

  it("warns when free space is low", async () => {
    const root = await render({ _usage: usage({ free_bytes: 3 * GB }) });
    const alert = root.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain("settings.storage_low | 3.0 GB");
  });

  it("lists the five largest builds, biggest first, skipping unbuilt devices", async () => {
    const devices = [
      device("a", 1),
      device("b", 600),
      device("c", 0),
      device("d", 300),
      device("e", 500),
      device("f", 400),
      device("g", 200),
    ];
    const root = await render({ _usage: usage(), _devices: devices });
    const names = [...root.querySelectorAll(".builds li span:first-child")].map((n) =>
      n.textContent?.trim()
    );
    expect(names).toEqual(["b", "e", "f", "d", "g"]);
    expect(text(root)).toContain("settings.storage_builds_desc | 6");
  });

  it("asks app-shell to open the reset confirm", async () => {
    const root = await render({ _usage: usage() });
    const seen = vi.fn();
    root.host.addEventListener("open-reset-build-env", seen);
    root.querySelector<HTMLButtonElement>(".reset-btn")!.click();
    expect(seen).toHaveBeenCalledTimes(1);
  });
});
