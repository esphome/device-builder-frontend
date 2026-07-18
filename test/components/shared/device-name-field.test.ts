import type { LocalizeFunc } from "../../../src/common/localize.js";
import { describe, expect, it } from "vitest";
import {
  deviceNameValidity,
  renderDeviceNameField,
} from "../../../src/components/shared/device-name-field.js";
import { identityLocalize } from "../../_dom.js";
import {
  extractAttributeBindings,
  findTemplatesByAnchor,
  visitTemplates,
} from "../../_lit-template-walker.js";

const localize: LocalizeFunc = identityLocalize as LocalizeFunc;

function renderedText(result: unknown): string {
  const parts: string[] = [];
  visitTemplates(result, (t) => {
    parts.push(...t.strings);
    for (const v of t.values) if (typeof v === "string") parts.push(v);
  });
  return parts.join(" ");
}

const field = (validity = deviceNameValidity("", false)) =>
  renderDeviceNameField({
    localize,
    labelKey: "dashboard.action_rename_label",
    value: "x",
    validity,
    onInput: () => {},
  });

describe("deviceNameValidity", () => {
  it("reports nothing while showsValidation is false", () => {
    expect(deviceNameValidity("Bad Name!", false)).toEqual({ err: null, warning: null });
  });

  it("a hard error wins the slot over a warning", () => {
    const { err, warning } = deviceNameValidity("Bad_Name!", true);
    expect(err?.code).toBe("validation.invalid_device_name");
    expect(warning).toBeNull();
  });

  it("warns error-free on an underscore name", () => {
    const { err, warning } = deviceNameValidity("master_tv", true);
    expect(err).toBeNull();
    expect(warning?.code).toBe("validation.device_name_underscore");
  });
});

describe("renderDeviceNameField", () => {
  it("marks the input invalid and renders the error text", () => {
    const result = field(deviceNameValidity("Bad Name!", true));
    const input = findTemplatesByAnchor(result, "<input")[0];
    expect(extractAttributeBindings(input).class).toBe("invalid");
    expect(renderedText(result)).toContain("validation.invalid_device_name");
  });

  it("renders the warning in the field-warning slot when error-free", () => {
    const result = field(deviceNameValidity("master_tv", true));
    const input = findTemplatesByAnchor(result, "<input")[0];
    expect(extractAttributeBindings(input).class).toBe("");
    expect(renderedText(result)).toContain("validation.device_name_underscore");
    expect(renderedText(result)).toContain("field-warning");
  });

  it("renders neither slot with a clean validity", () => {
    const text = renderedText(field());
    expect(text).not.toContain("validation.");
    expect(text).not.toContain("field-warning");
  });
});
