/**
 * @vitest-environment happy-dom
 *
 * Pins the value-gated dependency banner following the chosen type.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import "../../_mock-webawesome.js";

vi.mock("../../../src/components/device/config-entry-form.js", () => ({}));

import type { ESPHomeAddComponentForm } from "../../../src/components/device/add-component-form.js";
import { _clearComponentCache } from "../../../src/util/component-name-cache.js";
import { _clearProvidesCache } from "../../../src/util/provides-cache.js";
import { makeEthernetEntry } from "../../util/_make-ethernet-entry.js";
import {
  depsBanner,
  mountAddComponentForm,
  submitButton,
} from "./_add-component-form-host.js";
import { makeTestBoard } from "./_renderer-fixtures.js";

function mountEthernet(typeDefault: string) {
  return mountAddComponentForm({
    component: makeEthernetEntry(typeDefault),
    board: makeTestBoard(),
    yaml: "esp32:\n",
  });
}

function setType(el: ESPHomeAddComponentForm, value: string) {
  el.shadowRoot!.querySelector("esphome-config-entry-form")!.dispatchEvent(
    new CustomEvent("value-change", { detail: { path: ["type"], value } })
  );
  return el.updateComplete;
}

describe("add-component-form value-gated dependency", () => {
  afterEach(() => {
    _clearComponentCache();
    _clearProvidesCache();
  });

  it("follows the type: W5500 asks for spi, IP101 clears it", async () => {
    const el = await mountEthernet("IP101");
    expect(depsBanner(el)).toBeNull();
    expect(submitButton(el).disabled).toBe(false);

    await setType(el, "W5500");
    expect(depsBanner(el)).not.toBeNull();
    expect(submitButton(el).disabled).toBe(true);

    await setType(el, "IP101");
    expect(depsBanner(el)).toBeNull();
    expect(submitButton(el).disabled).toBe(false);
  });

  it("drops a bus verdict on a dep the type hides", async () => {
    const el = await mountEthernet("IP101");
    const inst = el as unknown as {
      _busBlockedDep: string | null;
      requestUpdate: () => void;
    };
    inst._busBlockedDep = "spi";
    inst.requestUpdate();
    await el.updateComplete;
    expect(depsBanner(el)).toBeNull();

    await setType(el, "W5500");
    expect(depsBanner(el)).not.toBeNull();
  });

  it("still asks for spi when the type shows the reference", async () => {
    const el = await mountEthernet("W5500");
    expect(depsBanner(el)).not.toBeNull();
    expect(submitButton(el).disabled).toBe(true);
  });
});
