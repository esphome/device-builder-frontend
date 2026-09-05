/**
 * @vitest-environment happy-dom
 *
 * Pins the value-gated dependency banner: a bus dep the catalog flattens off
 * a type-gated reference (ethernet's spi_id) is asked for only while the
 * chosen type shows that reference, and follows the type as it changes.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@home-assistant/webawesome/dist/components/icon/icon.js", () => ({}));

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

  it("does not ask for spi while the type hides the spi reference", async () => {
    const el = await mountEthernet("IP101");
    expect(depsBanner(el)).toBeNull();
    expect(submitButton(el).disabled).toBe(false);
  });

  it("follows the type: W5500 asks for spi, IP101 clears it", async () => {
    const el = await mountEthernet("IP101");
    await setType(el, "W5500");
    expect(depsBanner(el)).not.toBeNull();
    expect(submitButton(el).disabled).toBe(true);

    await setType(el, "IP101");
    expect(depsBanner(el)).toBeNull();
    expect(submitButton(el).disabled).toBe(false);
  });

  it("still asks for spi when the type shows the reference", async () => {
    const el = await mountEthernet("W5500");
    expect(depsBanner(el)).not.toBeNull();
    expect(submitButton(el).disabled).toBe(true);
  });
});
