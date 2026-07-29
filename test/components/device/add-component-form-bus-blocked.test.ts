/**
 * @vitest-environment happy-dom
 *
 * Pins the bus-blocked dependency gate: a dep whose block exists but has
 * no attachable bus (`busBlockedDeps`) shows the banner with the bus copy
 * and disables Submit, and a late-arriving `busReference` seeds the
 * still-empty reference field.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@home-assistant/webawesome/dist/components/icon/icon.js", () => ({}));

import { ConfigEntryType } from "../../../src/api/types/config-entries.js";
import { ESPHomeAddComponentForm } from "../../../src/components/device/add-component-form.js";
import { makeComponentEntry } from "../../util/_make-component-entry.js";
import { makeConfigEntry } from "../../util/_make-config-entry.js";

const ONE_BUS_YAML =
  "uart:\n  - baud_rate: 9600\n    rx_pin: 44\n    id: uart_1\n" +
  "sensor:\n  - platform: a02yyuw\n    name: Level\n";

const a01nyub = makeComponentEntry("sensor.a01nyub", {
  name: "A01NYUB",
  dependencies: ["uart"],
  config_entries: [
    makeConfigEntry({ key: "name", type: ConfigEntryType.STRING, required: true }),
    makeConfigEntry({
      key: "uart_id",
      type: ConfigEntryType.ID,
      references_component: "uart",
    }),
  ],
});

async function mountForm(
  over: Partial<ESPHomeAddComponentForm> = {}
): Promise<ESPHomeAddComponentForm> {
  const el = new ESPHomeAddComponentForm();
  el.component = a01nyub;
  el.yaml = ONE_BUS_YAML;
  Object.assign(el, over);
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}

describe("add-component-form bus-blocked dependency", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("keeps no banner when the dep is present and not blocked", async () => {
    const el = await mountForm();
    expect(el.shadowRoot!.querySelector(".deps-warning")).toBeNull();
  });

  it("shows the banner with the bus copy and disables Submit when blocked", async () => {
    const el = await mountForm({ busBlockedDeps: ["uart"] });
    const banner = el.shadowRoot!.querySelector(".deps-warning")!;
    expect(banner.textContent).toContain("device.bus_dependency_in_use_body");
    expect(banner.textContent).not.toContain("device.missing_dependencies_body");
    const submit = el.shadowRoot!.querySelector<HTMLButtonElement>(".btn-primary")!;
    expect(submit.disabled).toBe(true);
  });

  it("seeds a busReference set at mount", async () => {
    const el = await mountForm({ busReference: { domain: "uart", id: "uart_2" } });
    expect(el.currentValues.uart_id).toBe("uart_2");
  });

  it("applies a busReference arriving after mount to the empty field", async () => {
    const el = await mountForm();
    expect(el.currentValues.uart_id).toBeUndefined();
    el.busReference = { domain: "uart", id: "uart_2" };
    await el.updateComplete;
    expect(el.currentValues.uart_id).toBe("uart_2");
  });
});
