/**
 * @vitest-environment happy-dom
 *
 * Pins that the adopt _submit guards re-entry, so the Enter path (which
 * bypasses the disabled button via the shared EnterController) can't
 * double-import on a held Enter. The Enter->action wiring itself mirrors
 * friendly-name-dialog and is covered there.
 */
import { describe, expect, it, vi } from "vitest";

import type { AdoptableDevice } from "../../src/api/types.js";
import { ESPHomeAdoptDialog } from "../../src/components/adopt-dialog.js";

const DEVICE = {
  name: "foo-1234",
  friendly_name: "Foo",
  project_name: "acme.widget",
  package_import_url: "github://acme/widget/widget.yaml@main",
} as unknown as AdoptableDevice;

describe("adopt-dialog re-entry guard", () => {
  it("_submit ignores re-entry while an import is in flight", async () => {
    const importDevice = vi.fn(() => new Promise<void>(() => {})); // stays in flight
    const el = new ESPHomeAdoptDialog();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const priv = el as any;
    priv._api = { importDevice };
    priv._device = DEVICE;
    priv._name = "foo-1234";

    void priv._submit();
    await priv._submit();

    expect(importDevice).toHaveBeenCalledTimes(1);
  });
});
