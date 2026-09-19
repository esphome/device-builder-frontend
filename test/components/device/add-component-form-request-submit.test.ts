/**
 * @vitest-environment happy-dom
 *
 * requestSubmit() (the dialog's Enter path, #2400) runs the same submit
 * path as the Add button but self-guards on an in-flight submit — the
 * button's ?disabled only protects the click path. Unlike the button,
 * Enter reaches _onSubmit even when the form is incomplete, so the
 * validation branches surface the block instead of silently ignoring
 * the key.
 */
import { describe, expect, it, vi } from "vitest";

import "../../_mock-webawesome.js";

import { identityLocalize } from "../../_dom.js";
import type { ComponentCatalogEntry } from "../../../src/api/types/components.js";
import { ConfigEntryType } from "../../../src/api/types/config-entries.js";
import { ESPHomeAddComponentForm } from "../../../src/components/device/add-component-form.js";
import { makeConfigEntry } from "../../util/_make-config-entry.js";

function makeForm(component?: ComponentCatalogEntry): {
  form: ESPHomeAddComponentForm;
  submits: Record<string, unknown>[];
} {
  const form = new ESPHomeAddComponentForm();
  const submits: Record<string, unknown>[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const internals = form as any;
  internals.component =
    component ??
    ({
      id: "button.restart",
      config_entries: [makeConfigEntry({ key: "name", type: ConfigEntryType.STRING })],
    } as unknown as ComponentCatalogEntry);
  internals.yaml = "";
  internals._localize = identityLocalize;
  form.addEventListener("form-submit", (e) => {
    submits.push((e as CustomEvent<{ fields: Record<string, unknown> }>).detail.fields);
  });
  return { form, submits };
}

describe("add-component-form requestSubmit (#2400)", () => {
  it("ignores Enter while a required group the form paints is unmet", () => {
    const spi = {
      id: "spi",
      required_groups: [{ kind: "at_least_one", keys: ["miso_pin", "mosi_pin"] }],
      config_entries: [
        makeConfigEntry({ key: "miso_pin", type: ConfigEntryType.STRING }),
        makeConfigEntry({ key: "mosi_pin", type: ConfigEntryType.STRING }),
      ],
    } as unknown as ComponentCatalogEntry;
    const { form, submits } = makeForm(spi);
    form.requestSubmit();
    expect(submits).toHaveLength(0);
    // The inner form's banner already names the group; no second message.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((form as any)._localBlockMessage).toBe("");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (form as any)._values = { miso_pin: "GPIO7" };
    form.requestSubmit();
    expect(submits).toEqual([{ miso_pin: "GPIO7" }]);
  });

  it("ignores Enter while a constraint cluster box is unmet", () => {
    const eap = {
      id: "eap",
      required_groups: [{ kind: "at_least_one", keys: ["identity", "certificate"] }],
      config_entries: [
        makeConfigEntry({ key: "identity", type: ConfigEntryType.STRING }),
        makeConfigEntry({
          key: "certificate",
          type: ConfigEntryType.STRING,
          group: "cert_and_key",
        }),
        makeConfigEntry({
          key: "key",
          type: ConfigEntryType.STRING,
          group: "cert_and_key",
        }),
      ],
    } as unknown as ComponentCatalogEntry;
    const { form, submits } = makeForm(eap);
    form.requestSubmit();
    expect(submits).toHaveLength(0);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (form as any)._values = { identity: "me" };
    form.requestSubmit();
    expect(submits).toEqual([{ identity: "me" }]);
  });

  it("submits when the unmet group has no member the form paints", () => {
    const advancedOnly = {
      id: "example",
      required_groups: [{ kind: "exactly_one", keys: ["pwm", "dac"] }],
      config_entries: [
        makeConfigEntry({ key: "pwm", type: ConfigEntryType.STRING, advanced: true }),
        makeConfigEntry({ key: "dac", type: ConfigEntryType.STRING, advanced: true }),
      ],
    } as unknown as ComponentCatalogEntry;
    const { form, submits } = makeForm(advancedOnly);
    form.requestSubmit();
    expect(submits).toHaveLength(1);
  });

  it("fires form-submit with the coerced fields on a complete form", () => {
    const { form, submits } = makeForm();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (form as any)._values = { name: "Enter Test" };
    form.requestSubmit();
    expect(submits).toEqual([{ name: "Enter Test" }]);
  });

  it("blocks an incomplete form and surfaces the errors instead", () => {
    const required = {
      id: "button.restart",
      config_entries: [
        makeConfigEntry({ key: "name", type: ConfigEntryType.STRING, required: true }),
      ],
    } as unknown as ComponentCatalogEntry;
    const { form, submits } = makeForm(required);
    form.requestSubmit();
    expect(submits).toHaveLength(0);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(((form as any)._errors as Map<string, unknown>).size).toBeGreaterThan(0);
  });

  it("blocks on a missing dependency with a visible message", () => {
    const needsBus = {
      id: "sensor.ags10",
      name: "AGS10",
      dependencies: ["i2c"],
      config_entries: [makeConfigEntry({ key: "name", type: ConfigEntryType.STRING })],
    } as unknown as ComponentCatalogEntry;
    const { form, submits } = makeForm(needsBus);
    form.requestSubmit();
    expect(submits).toHaveLength(0);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const message = (form as any)._localBlockMessage as string;
    expect(message).toContain("device.missing_dependencies_title");
    expect(message).toContain("i2c");
  });

  it("blocks on a hidden-entry validation error with the dedicated message", () => {
    // The failing entry is advanced + optional, so required-only mode
    // never renders it; the error must surface as the block message
    // instead of bailing silently.
    const hiddenBad = {
      id: "sensor.example",
      config_entries: [
        makeConfigEntry({
          key: "frequency",
          type: ConfigEntryType.INTEGER,
          advanced: true,
        }),
      ],
    } as unknown as ComponentCatalogEntry;
    const { form, submits } = makeForm(hiddenBad);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (form as any)._values = { frequency: "not-a-number" };
    form.requestSubmit();
    expect(submits).toHaveLength(0);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const message = (form as any)._localBlockMessage as string;
    expect(message).toContain("device.add_component_hidden_validation_error");
  });

  it("routes a package-revealed field's error to the inline branch (#1632)", () => {
    // The literal scan hides `port`, which would send its error to the
    // hidden-validation block message; the widened presence renders the
    // field, so the error must surface inline instead.
    const gated = {
      id: "thing",
      config_entries: [
        makeConfigEntry({
          key: "port",
          type: ConfigEntryType.INTEGER,
          required: true,
          depends_on_component: "web_server",
        }),
      ],
    } as unknown as ComponentCatalogEntry;
    const { form, submits } = makeForm(gated);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const internals = form as any;
    internals.yaml = "packages:\n  base: github://acme/base.yaml\n";
    internals.resolvedComponents = ["web_server"];
    form.requestSubmit();
    expect(submits).toHaveLength(0);
    expect((internals._errors as Map<string, unknown>).has("port")).toBe(true);
    expect(internals._localBlockMessage).toBe("");
  });

  it("ignores a request while a submit is in flight", () => {
    const { form, submits } = makeForm();
    const onSubmit = vi.fn();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (form as any)._onSubmit = onSubmit;
    form.submitting = true;
    form.requestSubmit();
    expect(onSubmit).not.toHaveBeenCalled();
    expect(submits).toHaveLength(0);
  });
});
