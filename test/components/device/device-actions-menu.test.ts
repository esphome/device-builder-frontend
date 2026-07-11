/**
 * @vitest-environment happy-dom
 *
 * The editor bottom-bar device-actions menu: renders Logs / Validate / Clean
 * build, emits the matching events, and gates Validate (unsaved edits) and
 * Clean build (busy) with disabled + out-of-tab-order semantics.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@home-assistant/webawesome/dist/components/icon/icon.js", () => ({}));

import { ESPHomeDeviceActionsMenu } from "../../../src/components/device/device-actions-menu.js";
import { identityLocalize } from "../../_dom.js";

afterEach(() => {
  vi.clearAllMocks();
});

async function mount(
  opts: { busy?: boolean; validateDisabled?: boolean } = {}
): Promise<ESPHomeDeviceActionsMenu> {
  const el = new ESPHomeDeviceActionsMenu();
  (el as unknown as { _localize: typeof identityLocalize })._localize = identityLocalize;
  el.busy = opts.busy ?? false;
  el.validateDisabled = opts.validateDisabled ?? false;
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}

function items(el: ESPHomeDeviceActionsMenu): HTMLElement[] {
  return Array.from(el.shadowRoot!.querySelectorAll<HTMLElement>(".menu-item"));
}

// Paint order: Logs, Validate, Clean build.
const LOGS = 0;
const VALIDATE = 1;
const CLEAN = 2;

async function openMenu(el: ESPHomeDeviceActionsMenu): Promise<HTMLElement[]> {
  el.shadowRoot!.querySelector<HTMLElement>(".menu-btn")!.click();
  await el.updateComplete;
  return items(el);
}

function pressEnter(row: HTMLElement): void {
  row.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })
  );
}

describe("esphome-device-actions-menu", () => {
  it("is closed until the kebab is clicked, then shows all three actions", async () => {
    const el = await mount();
    expect(items(el)).toHaveLength(0);
    expect(await openMenu(el)).toHaveLength(3);
  });

  it("emits open-logs when Logs is clicked", async () => {
    const el = await mount();
    const onLogs = vi.fn();
    el.addEventListener("open-logs", onLogs);
    (await openMenu(el))[LOGS].click();
    expect(onLogs).toHaveBeenCalledTimes(1);
  });

  it("emits validate when Validate is clicked", async () => {
    const el = await mount();
    const onValidate = vi.fn();
    el.addEventListener("validate", onValidate);
    (await openMenu(el))[VALIDATE].click();
    expect(onValidate).toHaveBeenCalledTimes(1);
  });

  it("emits clean-build when Clean build is clicked", async () => {
    const el = await mount();
    const onClean = vi.fn();
    el.addEventListener("clean-build", onClean);
    (await openMenu(el))[CLEAN].click();
    expect(onClean).toHaveBeenCalledTimes(1);
  });

  it("disables Validate while there are unsaved edits", async () => {
    const el = await mount({ validateDisabled: true });
    const onValidate = vi.fn();
    el.addEventListener("validate", onValidate);
    const validate = (await openMenu(el))[VALIDATE];
    expect(validate.classList.contains("menu-item--disabled")).toBe(true);
    expect(validate.getAttribute("aria-disabled")).toBe("true");
    expect(validate.getAttribute("tabindex")).toBe("-1");
    validate.click();
    pressEnter(validate);
    expect(onValidate).not.toHaveBeenCalled();
  });

  it("disables Clean build while a build is running, keeping the others live", async () => {
    const el = await mount({ busy: true });
    const onClean = vi.fn();
    el.addEventListener("clean-build", onClean);
    const rows = await openMenu(el);
    const clean = rows[CLEAN];
    expect(clean.classList.contains("menu-item--disabled")).toBe(true);
    expect(clean.getAttribute("aria-disabled")).toBe("true");
    expect(clean.getAttribute("tabindex")).toBe("-1");
    clean.click();
    pressEnter(clean);
    expect(onClean).not.toHaveBeenCalled();

    // busy gates only Clean build — Logs and Validate stay usable.
    const onLogs = vi.fn();
    el.addEventListener("open-logs", onLogs);
    rows[LOGS].click();
    expect(onLogs).toHaveBeenCalledTimes(1);
  });

  it("closes after an item is chosen", async () => {
    const el = await mount();
    (await openMenu(el))[LOGS].click();
    await el.updateComplete;
    expect(items(el)).toHaveLength(0);
  });
});
