/**
 * @vitest-environment happy-dom
 *
 * The add-component form's Add gate holds on an unmet cluster box on the
 * premise that the flat required-only paint draws the box and every visible
 * member, advanced or not. Pin that premise at the DOM level.
 */
import { describe, expect, it } from "vitest";

import "../../_mock-webawesome.js";

import { identityLocalize } from "../../_dom.js";
import { ConfigEntryType } from "../../../src/api/types/config-entries.js";
import { ESPHomeConfigEntryForm } from "../../../src/components/device/config-entry-form.js";
import { makeConfigEntry } from "../../util/_make-config-entry.js";

describe("config-entry-form flat required-only paint", () => {
  it("draws an all-advanced constraint cluster with its warning and members", async () => {
    const advanced = { type: ConfigEntryType.STRING, advanced: true };
    const form = new ESPHomeConfigEntryForm();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (form as any)._localize = identityLocalize;
    form.entries = [
      makeConfigEntry({ key: "identity", ...advanced }),
      makeConfigEntry({ key: "certificate", group: "cert_and_key", ...advanced }),
      makeConfigEntry({ key: "key", group: "cert_and_key", ...advanced }),
    ];
    form.requiredGroups = [{ kind: "at_least_one", keys: ["identity", "certificate"] }];
    form.values = {};
    form.requiredOnly = true;
    document.body.appendChild(form);
    await form.updateComplete;

    const root = form.shadowRoot ?? form;
    const header = root.querySelector(".constraint-cluster-header");
    expect(header?.className).toContain("unsatisfied");
    const painted = [...root.querySelectorAll("[data-field-key]")].map((el) =>
      el.getAttribute("data-field-key")
    );
    expect(painted).toEqual(
      expect.arrayContaining(['["identity"]', '["certificate"]', '["key"]'])
    );
  });
});
