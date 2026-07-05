/**
 * @vitest-environment happy-dom
 *
 * Pins `device-section-config`'s backend-error handling: field errors
 * merge under the live client-side errors, editing a field optimistically
 * suppresses its backend error until the next lint pass replaces the
 * prop, and an error on a hidden advanced field reveals the disclosure.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("sonner-js", () => ({
  default: { error: vi.fn(), info: vi.fn(), success: vi.fn() },
}));

import { ConfigEntryType } from "../../../src/api/types/config-entries.js";
import { ESPHomeDeviceSectionConfig } from "../../../src/components/device/device-section-config.js";
import { onValueChange } from "../../../src/components/device/device-section-config/draft-and-delete.js";
import {
  backendErrorsForInstance,
  type InstanceBackendErrors,
} from "../../../src/util/backend-field-errors.js";
import { makeEntry } from "./_renderer-fixtures.js";

const SECTION = "sensor.dht";

/** Build the prop the page would derive, through the production selector. */
function instanceErrors(fields: Record<string, string>): InstanceBackendErrors {
  return backendErrorsForInstance(
    Object.entries(fields).map(([relPath, message]) => ({
      sectionKey: SECTION,
      fromLine: 1,
      relPath,
      message,
    })),
    SECTION,
    1
  );
}

function makeHost(backendErrors: InstanceBackendErrors) {
  const c = new ESPHomeDeviceSectionConfig();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const inner = c as any;
  inner.sectionKey = SECTION;
  inner._config = {
    entries: [
      makeEntry(ConfigEntryType.STRING, { key: "update_interval" }),
      makeEntry(ConfigEntryType.STRING, { key: "pin", advanced: true }),
    ],
  };
  inner.backendErrors = backendErrors;
  inner._scheduleDraftFlush = vi.fn();
  return inner;
}

const backendErrorsChanged = () => new Map([["backendErrors", undefined]]);

describe("device-section-config — backend field errors", () => {
  it("merges backend errors into the form's error map", () => {
    const inner = makeHost(instanceErrors({ update_interval: "bad interval" }));
    const merged = inner._mergeErrors(
      inner.backendErrors.fields,
      inner._clearedBackendPaths,
      inner._fieldErrors
    );
    expect(merged.get("update_interval")).toBe(
      inner.backendErrors.fields.get("update_interval")
    );
  });

  it("lets a live client-side error win on a path collision", () => {
    const inner = makeHost(instanceErrors({ update_interval: "backend msg" }));
    inner._fieldErrors = new Map([
      ["update_interval", { key: "update_interval", code: "validation.required" }],
    ]);
    const merged = inner._mergeErrors(
      inner.backendErrors.fields,
      inner._clearedBackendPaths,
      inner._fieldErrors
    );
    expect(merged.get("update_interval")?.code).toBe("validation.required");
  });

  it("suppresses the backend error on the edited path until the next lint pass", () => {
    const inner = makeHost(instanceErrors({ update_interval: "bad interval" }));
    onValueChange(
      inner,
      new CustomEvent("value-change", {
        detail: { path: ["update_interval"], value: "60s" },
      })
    );
    expect(inner._clearedBackendPaths.has("update_interval")).toBe(true);
    const merged = inner._mergeErrors(
      inner.backendErrors.fields,
      inner._clearedBackendPaths,
      inner._fieldErrors
    );
    expect(merged.has("update_interval")).toBe(false);

    // A fresh lint pass replaces the prop; willUpdate drops the
    // suppression so a still-broken value regains its error.
    inner.willUpdate(backendErrorsChanged());
    expect(inner._clearedBackendPaths.size).toBe(0);
  });

  it("reveals hidden advanced settings when a backend error lands there", () => {
    const inner = makeHost(instanceErrors({ pin: "pin broken" }));
    expect(inner._showAdvanced).toBe(false);
    inner._revealAdvancedForErrors(backendErrorsChanged());
    expect(inner._showAdvanced).toBe(true);
  });

  it("reveals advanced settings across nested list indices in the error path", () => {
    const inner = makeHost(instanceErrors({ "pin.0.id": "bad id" }));
    // Schema nests an item's fields directly under the list entry, so the
    // numeric segment must not break the advanced walk.
    inner._config = {
      entries: [
        makeEntry(ConfigEntryType.NESTED, {
          key: "pin",
          advanced: true,
          config_entries: [makeEntry(ConfigEntryType.STRING, { key: "id" })],
        }),
      ],
    };
    inner._revealAdvancedForErrors(backendErrorsChanged());
    expect(inner._showAdvanced).toBe(true);
  });

  it("does not reveal advanced settings for a plain-field error", () => {
    const inner = makeHost(instanceErrors({ update_interval: "x" }));
    inner._revealAdvancedForErrors(backendErrorsChanged());
    expect(inner._showAdvanced).toBe(false);
  });

  it("does not reopen advanced settings after a deliberate collapse", () => {
    const inner = makeHost(instanceErrors({ pin: "pin broken" }));
    inner._revealAdvancedForErrors(backendErrorsChanged());
    expect(inner._showAdvanced).toBe(true);
    inner._setShowAdvanced(false);
    inner._revealAdvancedForErrors(backendErrorsChanged());
    expect(inner._showAdvanced).toBe(false);
  });
});
