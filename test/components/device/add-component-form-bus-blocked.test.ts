/**
 * @vitest-environment happy-dom
 *
 * Pins the form-owned bus-hostability verdict: a claimed sole bus flags
 * the dep missing (bus banner + disabled Submit), a compatible bus seeds
 * `uart_id`, several compatible buses force the picker, and a configured
 * uart provider fails open.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@home-assistant/webawesome/dist/components/icon/icon.js", () => ({}));
// The shared inner form drags in the full WebAwesome control set, which
// happy-dom can't render; the assertions here read the host form's banner,
// submit gate, and values, so an inert unknown element suffices.
vi.mock("../../../src/components/device/config-entry-form.js", () => ({}));

import type { ESPHomeAPI } from "../../../src/api/index.js";
import type { ComponentCatalogEntry } from "../../../src/api/types/components.js";
import type { ConfigEntry } from "../../../src/api/types/config-entries.js";
import { ConfigEntryType } from "../../../src/api/types/config-entries.js";
import type { ESPHomeAddComponentForm } from "../../../src/components/device/add-component-form.js";
import { _clearComponentCache } from "../../../src/util/component-name-cache.js";
import { _clearProvidesCache } from "../../../src/util/provides-cache.js";
import { _clearCatalogCache } from "../../../src/util/yaml-completion-catalog.js";
import { _clearYamlSectionsMemo } from "../../../src/util/yaml-sections-core.js";
import { makeComponentEntry } from "../../util/_make-component-entry.js";
import { makeConfigEntry } from "../../util/_make-config-entry.js";
import {
  depsBanner,
  mountAddComponentForm,
  submitButton,
} from "./_add-component-form-host.js";

const RX_9600 = { baud_rate: 9600, require_rx: true };

const a01nyub = makeComponentEntry("sensor.a01nyub", {
  name: "A01NYUB",
  dependencies: ["uart"],
  bus_constraints: { uart: RX_9600 },
  config_entries: [
    makeConfigEntry({ key: "name", type: ConfigEntryType.STRING, required: true }),
    makeConfigEntry({
      key: "uart_id",
      type: ConfigEntryType.ID,
      references_component: "uart",
    }),
  ],
});

const CATALOG: Partial<ComponentCatalogEntry>[] = [
  { id: "sensor.a02yyuw", bus_constraints: { uart: RX_9600 } },
  { id: "sensor.a01nyub", bus_constraints: { uart: RX_9600 } },
  { id: "uart" },
];

/** Serves both the loadCatalog sweep and the uart `provides` query. */
function makeApi(): ESPHomeAPI {
  return {
    getComponents: vi.fn(async (args?: { provides?: string }) => {
      const components = args?.provides === "uart" ? [{ id: "usb_uart" }] : CATALOG;
      return {
        components,
        categories: [],
        total: components.length,
        offset: 0,
        limit: 1000,
      };
    }),
    getComponentBodies: vi.fn(async () => ({})),
  } as unknown as ESPHomeAPI;
}

const CLAIMED_BUS =
  "uart:\n  - baud_rate: 9600\n    rx_pin: 44\n    tx_pin: 43\n    id: uart_1\n" +
  "sensor:\n  - platform: a02yyuw\n    name: Level\n    uart_id: uart_1\n";

function mountForm(
  yaml: string,
  api: ESPHomeAPI = makeApi()
): Promise<ESPHomeAddComponentForm> {
  return mountAddComponentForm({ component: a01nyub, yaml, api });
}

describe("add-component-form bus hostability", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    _clearCatalogCache();
    _clearProvidesCache();
    _clearComponentCache();
    _clearYamlSectionsMemo();
  });

  it("flags the dep missing with the bus copy when the sole bus is claimed", async () => {
    const el = await mountForm(CLAIMED_BUS);
    const warn = depsBanner(el)!;
    expect(warn.textContent).toContain("device.bus_dependency_in_use_body");
    expect(warn.textContent).not.toContain("device.missing_dependencies_body");
    expect(submitButton(el).disabled).toBe(true);
  });

  it("seeds uart_id with the sole compatible bus", async () => {
    const el = await mountForm(
      "uart:\n  - baud_rate: 9600\n    rx_pin: 44\n    id: uart_1\n"
    );
    expect(depsBanner(el)).toBeNull();
    expect(el.currentValues.uart_id).toBe("uart_1");
  });

  it("seeds uart_id with the free bus when the other is claimed", async () => {
    const el = await mountForm(
      "uart:\n  - baud_rate: 9600\n    rx_pin: 44\n    id: uart_1\n" +
        "  - baud_rate: 9600\n    rx_pin: 6\n    id: uart_2\n" +
        "sensor:\n  - platform: a02yyuw\n    name: Level\n    uart_id: uart_1\n"
    );
    expect(depsBanner(el)).toBeNull();
    expect(el.currentValues.uart_id).toBe("uart_2");
  });

  it("forces the uart_id picker when several buses qualify", async () => {
    const el = await mountForm(
      "uart:\n  - baud_rate: 9600\n    rx_pin: 44\n    id: uart_1\n" +
        "  - baud_rate: 9600\n    rx_pin: 6\n    id: uart_2\n"
    );
    expect(depsBanner(el)).toBeNull();
    expect(el.currentValues.uart_id).toBeUndefined();
    const entries = (el as unknown as { _entries: ConfigEntry[] })._entries;
    expect(entries.find((e) => e.key === "uart_id")?.required).toBe(true);
  });

  it("fails open when a configured provider can host the component", async () => {
    const el = await mountForm("usb_uart:\n  id: hub\n" + CLAIMED_BUS);
    expect(depsBanner(el)).toBeNull();
  });

  it("treats an anchor-merged unclaimed bus as hostable, not pinless", async () => {
    const el = await mountForm(
      ".base: &base\n  rx_pin: 44\n" +
        "uart:\n  - <<: *base\n    baud_rate: 9600\n    id: uart_1\n"
    );
    expect(depsBanner(el)).toBeNull();
    expect(el.currentValues.uart_id).toBe("uart_1");
  });

  it("fails open entirely when the YAML pulls in external sources", async () => {
    const el = await mountForm("packages:\n  base: !include common.yaml\n" + CLAIMED_BUS);
    expect(depsBanner(el)).toBeNull();
  });

  it("issues no verdict when the catalog index is unavailable", async () => {
    const down = {
      getComponents: vi.fn(async () => {
        throw new Error("backend down");
      }),
      getComponentBodies: vi.fn(async () => ({})),
    } as unknown as ESPHomeAPI;
    const el = await mountForm(CLAIMED_BUS, down);
    expect(depsBanner(el)).toBeNull();
    expect(el.currentValues.uart_id).toBeUndefined();
  });

  it("detours instead of shipping an ambiguous reference to an un-idded bus", async () => {
    const el = await mountForm(
      "uart:\n  - baud_rate: 9600\n    rx_pin: 44\n    id: uart_1\n" +
        "  - baud_rate: 9600\n    rx_pin: 6\n" +
        "sensor:\n  - platform: a02yyuw\n    name: Level\n    uart_id: uart_1\n"
    );
    expect(depsBanner(el)).not.toBeNull();
    expect(el.currentValues.uart_id).toBeUndefined();
  });
});
