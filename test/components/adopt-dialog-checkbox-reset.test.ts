/**
 * @vitest-environment happy-dom
 *
 * Pins that the encryption checkbox tracks the reset `_encryption` state when
 * the reused dialog is reopened: a prior user uncheck must not leave the box
 * visually unchecked while `_encryption` is back to true (issue #1535).
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("../../src/components/base-dialog.js", () => ({}));

import type { AdoptableDevice } from "../../src/api/types/devices.js";
import { ESPHomeAdoptDialog } from "../../src/components/adopt-dialog.js";
import { mount } from "../_dom.js";

const DEVICE = {
  name: "foo-1234",
  friendly_name: "Foo",
  project_name: "acme.widget",
  package_import_url: "github://acme/widget/widget.yaml@main",
} as unknown as AdoptableDevice;

const checkbox = (el: ESPHomeAdoptDialog) =>
  el.shadowRoot!.querySelector<HTMLInputElement>('input[type="checkbox"]')!;

describe("adopt-dialog encryption checkbox reset", () => {
  it("re-checks the box on reopen after a prior uncheck", async () => {
    const el = await mount(new ESPHomeAdoptDialog());

    el.open(DEVICE);
    await el.updateComplete;
    const box = checkbox(el);
    box.checked = false;
    box.dispatchEvent(new Event("change"));
    await el.updateComplete;
    expect(checkbox(el).checked).toBe(false);

    el.close();
    await el.updateComplete;

    el.open(DEVICE);
    await el.updateComplete;
    expect(checkbox(el).checked).toBe(true);
  });
});
