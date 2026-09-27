/**
 * Shared host for suites that mount the real ``esphome-config-entry-form``:
 * the no-op mocks for its heavy children, and a controlled mount, since the
 * form only emits changes and its owner hands the new values back.
 */
import { vi } from "vitest";

vi.mock("@home-assistant/webawesome/dist/components/icon/icon.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/option/option.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/select/select.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/switch/switch.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/tooltip/tooltip.js", () => ({}));
vi.mock(
  "../../../src/components/device/config-entry-renderers/lambda-editor.js",
  () => ({})
);

import type { ConfigEntry } from "../../../src/api/types/config-entries.js";
import {
  type ConfigEntryValueChange,
  ESPHomeConfigEntryForm,
} from "../../../src/components/device/config-entry-form.js";
import { setIn } from "../../../src/util/nested-values.js";

export async function mountControlledForm(
  entries: ConfigEntry[],
  values: Record<string, unknown>
) {
  const form = new ESPHomeConfigEntryForm();
  form.entries = entries;
  form.values = values;
  const changes: ConfigEntryValueChange[] = [];
  form.addEventListener("value-change", (e) => {
    const change = (e as CustomEvent<ConfigEntryValueChange>).detail;
    changes.push(change);
    form.values = setIn(form.values, change.path, change.value);
  });
  document.body.appendChild(form);
  await form.updateComplete;
  /** Click a side of the Value / Lambda toggle, the first one under *scope*. */
  const toggle = async (
    side: "literal" | "lambda",
    scope: ParentNode = form.shadowRoot!
  ) => {
    scope
      .querySelectorAll<HTMLButtonElement>(".templatable-toggle button")
      [side === "literal" ? 0 : 1].click();
    await form.updateComplete;
  };
  return { form, changes, toggle };
}
