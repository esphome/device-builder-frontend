// @vitest-environment happy-dom
import { afterEach, describe, expect, test, vi } from "vitest";

// happy-dom can't host webawesome's form-associated internals; the dialog's
// own button markup is what's under test.
vi.mock("@home-assistant/webawesome/dist/components/button/button.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/dialog/dialog.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/option/option.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/select/select.js", () => ({}));

import { ESPHomeRemoteBuildJobDialog } from "../../src/components/remote-build-job-dialog.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
async function mountInputStep() {
  const el = new ESPHomeRemoteBuildJobDialog();
  (el as any)._localize = (k: string) => k;
  (el as any)._open = true;
  (el as any)._step = "input";
  (el as any)._pinSha256 = "ab".repeat(32);
  (el as any)._devices = [{ configuration: "kitchen.yaml", name: "Kitchen" }];
  (el as any)._configuration = "kitchen.yaml";
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

afterEach(() => {
  document.body.innerHTML = "";
});

describe("remote-build-job-dialog action buttons", () => {
  test("use the shared dialog-action-button classes, not the unstyled ones", async () => {
    const el = await mountInputStep();
    const buttons = [...el.shadowRoot!.querySelectorAll(".actions button")];
    const classes = buttons.map((b) => b.className);
    expect(classes).toContain("btn btn--cancel");
    expect(classes).toContain("btn btn--primary");
    // The original unstyled classes must not linger.
    expect(classes.some((c) => /\bbtn-(secondary|primary)\b/.test(c))).toBe(false);
  });
});
