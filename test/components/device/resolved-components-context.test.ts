/**
 * @vitest-environment happy-dom
 *
 * Pins the resolvedComponentsContext wiring: a provider's value reaches
 * the core add dialog's nested catalog across the shadow boundaries, and
 * a provider update propagates to a connected subtree.
 */
import { describe, expect, it, vi } from "vitest";

import "../../_mock-webawesome.js";

vi.mock("@home-assistant/webawesome/dist/components/badge/badge.js", () => ({}));
vi.mock("sonner-js", () => ({ default: { success: vi.fn(), error: vi.fn() } }));

import { provide } from "@lit/context";
import { html, LitElement } from "lit";
import { customElement, state } from "lit/decorators.js";
import "../../../src/components/device/add-config-dialog.js";
import type { ESPHomeComponentCatalog } from "../../../src/components/device/component-catalog.js";
import {
  resolvedComponentsContext,
  resolvedPlatformsContext,
} from "../../../src/context/index.js";

@customElement("test-resolved-components-provider")
class TestResolvedComponentsProvider extends LitElement {
  @provide({ context: resolvedComponentsContext })
  @state()
  resolved: readonly string[] = [];

  @provide({ context: resolvedPlatformsContext })
  @state()
  resolvedPlatforms: readonly string[] = [];

  protected render() {
    return html`<esphome-add-config-dialog></esphome-add-config-dialog>`;
  }
}

async function mountChain(
  resolved: readonly string[],
  platforms: readonly string[] = []
) {
  const provider = new TestResolvedComponentsProvider();
  provider.resolved = resolved;
  provider.resolvedPlatforms = platforms;
  document.body.appendChild(provider);
  await provider.updateComplete;
  const configDialog = provider.shadowRoot!.querySelector("esphome-add-config-dialog")!;
  await (configDialog as LitElement).updateComplete;
  const addDialog = configDialog.shadowRoot!.querySelector(
    "esphome-add-component-dialog"
  )!;
  await (addDialog as LitElement).updateComplete;
  const catalog = addDialog.shadowRoot!.querySelector<ESPHomeComponentCatalog>(
    "esphome-component-catalog"
  )!;
  await catalog.updateComplete;
  return { provider, addDialog: addDialog as LitElement, catalog };
}

describe("resolvedComponentsContext wiring", () => {
  it("delivers the provided value to the nested catalog", async () => {
    const { provider, catalog } = await mountChain(["api", "esp32"]);
    expect(catalog.resolvedComponents).toEqual(["api", "esp32"]);
    provider.remove();
  });

  it("propagates a provider update to a connected subtree", async () => {
    const { provider, addDialog, catalog } = await mountChain(["api"]);
    provider.resolved = ["api", "esp32", "wifi"];
    await provider.updateComplete;
    await addDialog.updateComplete;
    await catalog.updateComplete;
    expect(catalog.resolvedComponents).toEqual(["api", "esp32", "wifi"]);
    provider.remove();
  });

  it("delivers the provided platform pairs to the nested add dialog", async () => {
    const { provider, addDialog } = await mountChain(["api"], ["ota.esphome"]);
    const internals = addDialog as unknown as { _resolvedPlatforms: readonly string[] };
    expect(internals._resolvedPlatforms).toEqual(["ota.esphome"]);

    provider.resolvedPlatforms = ["ota.esphome", "time.sntp"];
    await provider.updateComplete;
    await addDialog.updateComplete;
    expect(internals._resolvedPlatforms).toEqual(["ota.esphome", "time.sntp"]);
    provider.remove();
  });
});
