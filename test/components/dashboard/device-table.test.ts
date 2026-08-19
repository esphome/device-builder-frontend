/**
 * @vitest-environment happy-dom
 *
 * The "All" page size (sentinel 0): the translation feeds TanStack a
 * real row-count size (floored at 1), and the mounted table renders
 * every row on one page while a normal size paginates (discussion #3682).
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@home-assistant/webawesome/dist/components/icon/icon.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/spinner/spinner.js", () => ({}));
vi.mock("../../../src/components/dashboard/table-column-toggle.js", () => ({}));
vi.mock("../../../src/components/dashboard/table-row-menu.js", () => ({}));

import {
  type ConfiguredDeviceOverrides,
  makeConfiguredDevice,
} from "../../_make-configured-device.js";
import type { ConfiguredDevice } from "../../../src/api/types/devices.js";
import { ESPHomeDeviceTable } from "../../../src/components/dashboard/device-table.js";
import {
  ALL_PAGE_SIZE,
  effectiveTablePageSize,
} from "../../../src/components/dashboard/pagination.js";
import {
  clearTourConfiguration,
  setTourActive,
  setTourConfiguration,
} from "../../../src/components/guided-tour/tour-session.js";

afterEach(() => {
  setTourActive(false);
  clearTourConfiguration();
});

describe("effectiveTablePageSize", () => {
  it("passes a normal page size through unchanged", () => {
    expect(effectiveTablePageSize(25, 100)).toBe(25);
  });

  it("expands the All sentinel to the row count (fits every row on page 0)", () => {
    expect(effectiveTablePageSize(ALL_PAGE_SIZE, 30)).toBe(30);
  });

  it("floors at 1 so 0 never reaches TanStack on an empty dataset", () => {
    expect(effectiveTablePageSize(ALL_PAGE_SIZE, 0)).toBe(1);
  });
});

function makeDevices(n: number): ConfiguredDevice[] {
  return Array.from({ length: n }, (_, i) =>
    makeConfiguredDevice({
      name: `demo-${i}`,
      friendly_name: `Demo ${i}`,
      configuration: `demo-${i}.yaml`,
      address: `demo-${i}.local`,
    })
  );
}

async function mount(
  count: number,
  initialPageSize: number
): Promise<ESPHomeDeviceTable> {
  const el = new ESPHomeDeviceTable();
  el.devices = makeDevices(count);
  el.initialPageSize = initialPageSize;
  document.body.appendChild(el);
  await el.updateComplete;
  await el.updateComplete;
  return el;
}

const rowCount = (el: ESPHomeDeviceTable) =>
  el.shadowRoot!.querySelectorAll("tbody tr[data-configuration]").length;
const pageSizeAttr = (el: ESPHomeDeviceTable) =>
  el.shadowRoot!.querySelector("esphome-table-pagination")?.getAttribute("page-size");

describe("device-table select mode", () => {
  it("rebuilds the status cell when selectMode flips", async () => {
    const el = await mount(3, 25);
    const dot = () =>
      el.shadowRoot!.querySelector('tbody tr[data-configuration] [role="button"]');
    expect(dot()).not.toBeNull();

    el.selectMode = true;
    await el.updateComplete;
    expect(dot()).toBeNull();

    el.selectMode = false;
    await el.updateComplete;
    expect(dot()).not.toBeNull();
  });
});

describe("device-table All rendering", () => {
  it("paginates at a normal page size (25 of 30 rows)", async () => {
    const el = await mount(30, 25);
    expect(rowCount(el)).toBe(25);
    expect(pageSizeAttr(el)).toBe("25");
  });

  it("renders every row on one page when All is selected", async () => {
    const el = await mount(30, ALL_PAGE_SIZE);
    expect(rowCount(el)).toBe(30);
    expect(pageSizeAttr(el)).toBe("0");
  });

  it("moves to the page containing the quickstart target", async () => {
    const el = await mount(30, 10);
    setTourConfiguration("demo-20.yaml");
    setTourActive(true);
    el.requestUpdate();

    await el.updateComplete;
    await el.updateComplete;

    expect(
      el
        .shadowRoot!.querySelector("tbody tr[data-configuration]")
        ?.getAttribute("data-configuration")
    ).toBe("demo-20.yaml");
  });

  it("finds the quickstart target through sorting and search filters", async () => {
    const el = await mount(30, 10);
    el.initialSorting = [{ id: "name", desc: true }];
    el.search = "does-not-match";
    setTourConfiguration("demo-0.yaml");
    setTourActive(true);
    el.requestUpdate();

    await el.updateComplete;
    await el.updateComplete;

    expect(
      el.shadowRoot!.querySelector('tbody tr[data-configuration="demo-0.yaml"]')
    ).not.toBeNull();
  });
});

describe("device-table auto sort registry", () => {
  // Pins the order the slim v9 ``sortFns`` registry produces for a
  // string column resolved through ``auto`` (alphanumeric). A registry
  // miss falls back to ``basic`` silently in production builds, so this
  // is the only signal if the registry is slimmed further.
  it("sorts the platform column alphanumerically via auto resolution", async () => {
    // host10/host2 and the uppercase entry make the assertion fail under a
    // plain lexicographic (``basic``) compare, so the fallback can't pass.
    const platforms = ["esp32", "rp2040", "host10", "BK72XX", "esp32-c3", "host2"];
    const el = new ESPHomeDeviceTable();
    el.devices = platforms.map((platform, i) =>
      makeConfiguredDevice({
        name: `dev-${i}`,
        friendly_name: `Dev ${i}`,
        configuration: `dev-${i}.yaml`,
        target_platform: platform,
      })
    );
    el.initialSorting = [{ id: "platform", desc: false }];
    document.body.appendChild(el);
    await el.updateComplete;
    await el.updateComplete;

    // Skip the mobile stack label span; the value span carries the platform.
    const order = Array.from(
      el.shadowRoot!.querySelectorAll("tbody td.col-platform span:not(.cell-stack-label)")
    ).map((span) => span.textContent!.trim());
    expect(order).toEqual(["BK72XX", "esp32", "esp32-c3", "host2", "host10", "rp2040"]);
  });

  // Digit-free strings resolve through the registry's ``text`` entry.
  // ``basic`` is case-sensitive ("Bedroom" before "attic"), so this order
  // only holds while ``text`` stays registered.
  it("sorts a digit-free column case-insensitively via the text entry", async () => {
    const comments = ["kitchen", "Bedroom", "attic"];
    const el = new ESPHomeDeviceTable();
    el.devices = comments.map((comment, i) =>
      makeConfiguredDevice({
        name: `dev-${i}`,
        friendly_name: `Dev ${i}`,
        configuration: `dev-${i}.yaml`,
        comment,
      })
    );
    el.initialColumnVisibility = { comment: true };
    el.initialSorting = [{ id: "comment", desc: false }];
    document.body.appendChild(el);
    await el.updateComplete;
    await el.updateComplete;

    const order = Array.from(
      el.shadowRoot!.querySelectorAll("tbody td.col-comment span:not(.cell-stack-label)")
    ).map((span) => span.textContent!.trim());
    expect(order).toEqual(["attic", "Bedroom", "kitchen"]);
  });
});

describe("device-table Version column identity gating", () => {
  async function mountWithVersionColumn(
    device: ConfiguredDevice
  ): Promise<ESPHomeDeviceTable> {
    const el = new ESPHomeDeviceTable();
    el.devices = [device];
    el.initialColumnVisibility = { version: true };
    document.body.appendChild(el);
    await el.updateComplete;
    await el.updateComplete;
    return el;
  }

  function versionCellText(el: ESPHomeDeviceTable): string {
    const cell = el.shadowRoot!.querySelector("tbody td.col-version");
    expect(cell).not.toBeNull();
    return cell!.querySelector(".cell-mono, .cell-muted")!.textContent!.trim();
  }

  it.each<[string, ConfiguredDeviceOverrides, string]>([
    [
      "api device with mdns ownership shows the deployed version",
      {
        api_enabled: true,
        runtime_state: { active_source: "mdns", deployed_identity_live: false },
      },
      "2026.6.0",
    ],
    [
      "api device with a dark identity blanks",
      {
        api_enabled: true,
        runtime_state: { active_source: "ping", deployed_identity_live: false },
      },
      "—",
    ],
    [
      "no-api device with a live identity TXT shows the deployed version",
      { api_enabled: false, runtime_state: { deployed_identity_live: true } },
      "2026.6.0",
    ],
    [
      "no-api device with a dark identity blanks",
      { api_enabled: false, runtime_state: { deployed_identity_live: false } },
      "—",
    ],
  ])("%s", async (_name, overrides, expected) => {
    const { runtime_state, ...flat } = overrides;
    const el = await mountWithVersionColumn(
      makeConfiguredDevice({
        ...flat,
        runtime_state: { deployed_version: "2026.6.0", ...runtime_state },
      })
    );
    expect(versionCellText(el)).toBe(expected);
  });
});

describe("device-table initialPageSize seeding", () => {
  const pagination = (el: ESPHomeDeviceTable) =>
    el.shadowRoot!.querySelector("esphome-table-pagination")!;
  const firstRowConfig = (el: ESPHomeDeviceTable) =>
    el
      .shadowRoot!.querySelector("tbody tr[data-configuration]")
      ?.getAttribute("data-configuration");

  it("ignores the host echo of its own page-size change (keeps the page index)", async () => {
    const el = await mount(30, 25);

    pagination(el).dispatchEvent(new CustomEvent("page-size-change", { detail: 10 }));
    await el.updateComplete;
    pagination(el).dispatchEvent(new CustomEvent("page-change", { detail: 2 }));
    await el.updateComplete;
    expect(firstRowConfig(el)).toBe("demo-20.yaml");

    // The dashboard mirrors the change back into initialPageSize.
    el.initialPageSize = 10;
    await el.updateComplete;
    expect(firstRowConfig(el)).toBe("demo-20.yaml");
    expect(pageSizeAttr(el)).toBe("10");
  });

  it("applies a genuinely new initialPageSize and resets to the first page", async () => {
    const el = await mount(30, 25);
    pagination(el).dispatchEvent(new CustomEvent("page-change", { detail: 1 }));
    await el.updateComplete;
    expect(firstRowConfig(el)).toBe("demo-25.yaml");

    el.initialPageSize = 10;
    await el.updateComplete;
    expect(firstRowConfig(el)).toBe("demo-0.yaml");
    expect(rowCount(el)).toBe(10);
  });
});
