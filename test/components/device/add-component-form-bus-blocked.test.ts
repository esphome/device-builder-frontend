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
import { ESPHomeAddComponentForm } from "../../../src/components/device/add-component-form.js";
import { _clearComponentCache } from "../../../src/util/component-name-cache.js";
import { _clearProvidesCache } from "../../../src/util/provides-cache.js";
import { _clearCatalogCache } from "../../../src/util/yaml-completion-catalog.js";
import { _clearYamlSectionsMemo } from "../../../src/util/yaml-sections-core.js";
import { flushMicrotasks } from "../../_dom.js";
import { makeComponentEntry } from "../../util/_make-component-entry.js";
import { makeConfigEntry } from "../../util/_make-config-entry.js";

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

async function mountForm(yaml: string): Promise<ESPHomeAddComponentForm> {
  const el = new ESPHomeAddComponentForm();
  el.component = a01nyub;
  el.yaml = yaml;
  Object.assign(el as unknown as Record<string, unknown>, { _api: makeApi() });
  document.body.appendChild(el);
  await el.updateComplete;
  await flushMicrotasks(10);
  await el.updateComplete;
  return el;
}

function banner(el: ESPHomeAddComponentForm): Element | null {
  return el.shadowRoot!.querySelector(".deps-warning");
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
    const warn = banner(el)!;
    expect(warn.textContent).toContain("device.bus_dependency_in_use_body");
    expect(warn.textContent).not.toContain("device.missing_dependencies_body");
    const submit = el.shadowRoot!.querySelector<HTMLButtonElement>(".btn-primary")!;
    expect(submit.disabled).toBe(true);
  });

  it("seeds uart_id with the sole compatible bus", async () => {
    const el = await mountForm(
      "uart:\n  - baud_rate: 9600\n    rx_pin: 44\n    id: uart_1\n"
    );
    expect(banner(el)).toBeNull();
    expect(el.currentValues.uart_id).toBe("uart_1");
  });

  it("seeds uart_id with the free bus when the other is claimed", async () => {
    const el = await mountForm(
      "uart:\n  - baud_rate: 9600\n    rx_pin: 44\n    id: uart_1\n" +
        "  - baud_rate: 9600\n    rx_pin: 6\n    id: uart_2\n" +
        "sensor:\n  - platform: a02yyuw\n    name: Level\n    uart_id: uart_1\n"
    );
    expect(banner(el)).toBeNull();
    expect(el.currentValues.uart_id).toBe("uart_2");
  });

  it("forces the uart_id picker when several buses qualify", async () => {
    const el = await mountForm(
      "uart:\n  - baud_rate: 9600\n    rx_pin: 44\n    id: uart_1\n" +
        "  - baud_rate: 9600\n    rx_pin: 6\n    id: uart_2\n"
    );
    expect(banner(el)).toBeNull();
    expect(el.currentValues.uart_id).toBeUndefined();
    const entries = (el as unknown as { _entries: ConfigEntry[] })._entries;
    expect(entries.find((e) => e.key === "uart_id")?.required).toBe(true);
  });

  it("fails open when a configured provider can host the component", async () => {
    const el = await mountForm("usb_uart:\n  id: hub\n" + CLAIMED_BUS);
    expect(banner(el)).toBeNull();
  });
});
