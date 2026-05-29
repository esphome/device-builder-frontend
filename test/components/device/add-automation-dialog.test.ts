/**
 * @vitest-environment happy-dom
 *
 * Behavioral guard for the add-automation dialog's render gate. Pins
 * the memory-leak fix: every ``open()`` sets ``_loading=true``, and the
 * old render swapped the whole form (its ``wa-select`` dropdowns
 * included) out for a spinner and rebuilt it, leaking the discarded
 * selects. The spinner must only show before the first load; once data
 * has landed the form must stay mounted across reopens, so the same
 * ``wa-select`` element survives instead of being recreated.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@home-assistant/webawesome/dist/components/dialog/dialog.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/icon/icon.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/option/option.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/select/select.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/spinner/spinner.js", () => ({}));
vi.mock("sonner-js", () => ({ default: { error: vi.fn() } }));

import type { ESPHomeAPI } from "../../../src/api/index.js";
import type { AvailableAutomations } from "../../../src/api/types.js";
import { ESPHomeAddAutomationDialog } from "../../../src/components/device/add-automation-dialog.js";

async function flushPending(times = 5): Promise<void> {
  for (let i = 0; i < times; i++) await Promise.resolve();
}

function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void } {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

const slimAvailable = (): AvailableAutomations =>
  ({
    triggers: [{ id: "on_boot", name: "On boot", config_entries: [] }],
    actions: [],
    conditions: [],
    scripts: [],
    devices: [{ id: "relay", name: "Relay", component_id: "switch" }],
  }) as unknown as AvailableAutomations;

/** Mount a dialog with a stubbed api + localize, settle its lifecycle. */
async function mountDialog(api: ESPHomeAPI): Promise<ESPHomeAddAutomationDialog> {
  const dialog = new ESPHomeAddAutomationDialog();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (dialog as any)._api = api;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (dialog as any)._localize = (key: string) => key; // no context provider in the test tree
  dialog.configuration = "device.yaml";
  document.body.appendChild(dialog);
  await dialog.updateComplete;
  await flushPending();
  return dialog;
}

const kindSelect = (d: ESPHomeAddAutomationDialog) =>
  d.shadowRoot?.querySelector('wa-select[aria-labelledby="kind-label"]') ?? null;

describe("add-automation-dialog render gate (behavioral)", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("shows only the spinner before the first load, then the form", async () => {
    const first = deferred<AvailableAutomations>();
    const getAvailableAutomations = vi.fn(() => first.promise);
    const api = { getAvailableAutomations } as unknown as ESPHomeAPI;

    const dialog = await mountDialog(api);
    dialog.open();
    await dialog.updateComplete;
    await flushPending();

    // First load in flight: spinner up, form (and its selects) absent.
    expect(dialog.shadowRoot?.querySelector("wa-spinner")).not.toBeNull();
    expect(kindSelect(dialog)).toBeNull();

    first.resolve(slimAvailable());
    await dialog.updateComplete;
    await flushPending();

    // Data landed: form rendered, spinner gone.
    expect(dialog.shadowRoot?.querySelector("wa-spinner")).toBeNull();
    expect(kindSelect(dialog)).not.toBeNull();
  });

  it("keeps the same wa-select mounted across a reopen (no teardown, no leak)", async () => {
    const first = deferred<AvailableAutomations>();
    const second = deferred<AvailableAutomations>();
    const getAvailableAutomations = vi
      .fn()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);
    const api = { getAvailableAutomations } as unknown as ESPHomeAPI;

    const dialog = await mountDialog(api);
    dialog.open();
    await dialog.updateComplete;
    await flushPending();
    first.resolve(slimAvailable());
    await dialog.updateComplete;
    await flushPending();

    const selectBeforeReopen = kindSelect(dialog);
    expect(selectBeforeReopen).not.toBeNull();

    // Reopen: open() sets _loading=true again. The form must NOT be
    // swapped out for the spinner (that is the leak), so the existing
    // wa-select element must survive rather than be recreated.
    dialog.open();
    await dialog.updateComplete;
    await flushPending();

    expect(dialog.shadowRoot?.querySelector("wa-spinner")).toBeNull();
    expect(kindSelect(dialog)).toBe(selectBeforeReopen);

    second.resolve(slimAvailable());
    await flushPending();
  });
});
