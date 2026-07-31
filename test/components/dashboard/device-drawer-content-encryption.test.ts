/**
 * @vitest-environment happy-dom
 *
 * The drawer's plaintext badge is a button deep-linking to the api section's
 * Enable-encryption affordance; the other states render passive spans.
 */
import { render } from "lit";
import { describe, expect, it } from "vitest";

import { identityLocalize } from "../../_dom.js";
import { makeConfiguredDevice } from "../../_make-configured-device.js";
import type { ESPHomeDeviceDrawerContent } from "../../../src/components/dashboard/device-drawer-content.js";
import { renderEncryptionBadge } from "../../../src/components/dashboard/device-drawer-content/render-sections.js";

function hostEl(): HTMLElement {
  const el = document.createElement("div");
  (el as unknown as { _localize: (k: string) => string })._localize = identityLocalize;
  document.body.appendChild(el);
  return el;
}

describe("drawer encryption badge deep-link", () => {
  it("plaintext renders a button that emits open-encryption-settings with the device", () => {
    const host = hostEl();
    const device = makeConfiguredDevice({ name: "kitchen" });
    render(
      renderEncryptionBadge(
        host as unknown as ESPHomeDeviceDrawerContent,
        device,
        "plaintext"
      ),
      host
    );
    const btn = host.querySelector<HTMLButtonElement>("button.status-badge");
    expect(btn).not.toBeNull();
    // The warning notice stays as the tooltip even though it's now a button.
    expect(btn!.title).toBe("dashboard.table_status_unencrypted_tooltip");
    let detail: unknown;
    host.addEventListener("open-encryption-settings", (e) => {
      detail = (e as CustomEvent).detail;
    });
    btn!.click();
    expect(detail).toBe(device);
  });

  it("active state stays a passive span", () => {
    const host = hostEl();
    render(
      renderEncryptionBadge(
        host as unknown as ESPHomeDeviceDrawerContent,
        makeConfiguredDevice({ name: "kitchen" }),
        "active"
      ),
      host
    );
    expect(host.querySelector("button.status-badge")).toBeNull();
    expect(host.querySelector("span.status-badge")).not.toBeNull();
  });
});
