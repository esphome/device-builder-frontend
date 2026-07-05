// @vitest-environment happy-dom
import { describe, expect, test, vi } from "vitest";

// happy-dom can't host webawesome's form-associated internals; the
// attributes under test are readable on the unknown elements.
vi.mock("@home-assistant/webawesome/dist/components/button/button.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/dialog/dialog.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/option/option.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/select/select.js", () => ({}));

import { JobType } from "../../src/api/types/firmware-jobs.js";
import { defaultLocalize } from "../../src/common/localize.js";
import { ESPHomeRemoteBuildJobDialog } from "../../src/components/remote-build-job-dialog.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
async function mountInputStep() {
  const el = new ESPHomeRemoteBuildJobDialog();
  (el as any)._localize = defaultLocalize;
  (el as any)._open = true;
  (el as any)._step = "input";
  (el as any)._pinSha256 = "ab".repeat(32);
  (el as any)._devices = [
    { configuration: "kitchen.yaml", name: "Kitchen" },
    { configuration: "porch.yaml", name: "Porch" },
  ];
  (el as any)._configuration = "kitchen.yaml";
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

describe("remote-build-job-dialog submit form selects", () => {
  test("configuration and target pickers are labelled wa-selects with values", async () => {
    const el = await mountInputStep();
    const config = el.shadowRoot!.querySelector("wa-select#rb-config");
    const target = el.shadowRoot!.querySelector("wa-select#rb-target");
    expect(config).not.toBeNull();
    expect(target).not.toBeNull();
    expect(config!.getAttribute("value")).toBe("kitchen.yaml");
    expect(target!.getAttribute("value")).toBe(JobType.COMPILE);
    expect(config!.getAttribute("aria-labelledby")).toBe("rb-config-label");
    expect(target!.getAttribute("aria-labelledby")).toBe("rb-target-label");
    expect(el.shadowRoot!.querySelector("#rb-config-label")).not.toBeNull();
    expect(el.shadowRoot!.querySelector("#rb-target-label")).not.toBeNull();
  });

  test("the wa-select value drives the selection, one option per device", async () => {
    const el = await mountInputStep();
    const config = el.shadowRoot!.querySelector("wa-select#rb-config");
    // value= is the canonical selection source (no per-option ?selected).
    expect(config!.getAttribute("value")).toBe("kitchen.yaml");
    expect(config!.querySelectorAll("wa-option").length).toBe(2);
  });
});
