/**
 * @vitest-environment happy-dom
 *
 * The editor bottom-bar device-actions menu: renders Clean build / Validate /
 * Logs, emits the matching events, gates Validate (unsaved edits) and
 * Clean build (busy) with disabled + out-of-tab-order semantics, and shows
 * Visit web UI only when the page passed a web-UI URL.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@home-assistant/webawesome/dist/components/icon/icon.js", () => ({}));

import { ESPHomeDeviceActionsMenu } from "../../../src/components/device/device-actions-menu.js";
import { identityLocalize } from "../../_dom.js";

afterEach(() => {
  vi.clearAllMocks();
});

async function mount(
  opts: { busy?: boolean; validateDisabled?: boolean; webUiUrl?: string } = {}
): Promise<ESPHomeDeviceActionsMenu> {
  const el = new ESPHomeDeviceActionsMenu();
  (el as unknown as { _localize: typeof identityLocalize })._localize = identityLocalize;
  el.busy = opts.busy ?? false;
  el.validateDisabled = opts.validateDisabled ?? false;
  el.webUiUrl = opts.webUiUrl ?? "";
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}

function items(el: ESPHomeDeviceActionsMenu): HTMLElement[] {
  return Array.from(el.shadowRoot!.querySelectorAll<HTMLElement>(".menu-item"));
}

function link(el: ESPHomeDeviceActionsMenu): HTMLAnchorElement | null {
  return el.shadowRoot!.querySelector<HTMLAnchorElement>(".menu-item--link");
}

// Paint order (menu opens upward; frequent actions sit nearest the trigger):
// Clean build, divider, Validate, Logs. A webUiUrl mount inserts Visit web UI
// after the divider; those tests select by class, not index.
const CLEAN = 0;
const VALIDATE = 1;
const LOGS = 2;

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

  it("omits Visit web UI without a URL", async () => {
    const el = await mount();
    await openMenu(el);
    expect(link(el)).toBeNull();
  });

  it("renders Visit web UI as a role'd menu anchor when a URL is set", async () => {
    const el = await mount({ webUiUrl: "http://kitchen.local/" });
    await openMenu(el);
    const a = link(el)!;
    expect(a).not.toBeNull();
    expect(a.getAttribute("href")).toBe("http://kitchen.local/");
    expect(a.getAttribute("role")).toBe("menuitem");
    expect(a.textContent).toContain("dashboard.action_visit_web_ui");
  });

  it("paints Clean build, divider, Visit web UI, Validate, Logs", async () => {
    const el = await mount({ webUiUrl: "http://kitchen.local/" });
    const labels = (await openMenu(el)).map((row) => row.textContent!.trim());
    expect(labels).toEqual([
      "dashboard.action_clean_build",
      "dashboard.action_visit_web_ui",
      "device.validate",
      "device.show_logs",
    ]);
    const divider = el.shadowRoot!.querySelector(".menu-divider")!;
    expect(divider.previousElementSibling).toBe(items(el)[CLEAN]);
  });

  it("activates Visit web UI on Space, leaving Enter to the anchor", async () => {
    const el = await mount({ webUiUrl: "http://kitchen.local/" });
    await openMenu(el);
    const a = link(el)!;
    let clicks = 0;
    a.addEventListener("click", (e) => {
      e.preventDefault();
      clicks++;
    });
    const press = (key: string) => {
      const ev = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
      a.dispatchEvent(ev);
      return ev;
    };
    expect(press(" ").defaultPrevented).toBe(true);
    expect(clicks).toBe(1);
    // Enter synthesized too would double-activate a native anchor.
    expect(press("Enter").defaultPrevented).toBe(false);
    expect(clicks).toBe(1);
  });

  it("closes the menu when the Visit web UI link is activated", async () => {
    const el = await mount({ webUiUrl: "http://kitchen.local/" });
    await openMenu(el);
    // Block the real navigation; the menu's own click handling still runs.
    el.shadowRoot!.addEventListener("click", (e) => e.preventDefault(), true);
    link(el)!.click();
    await el.updateComplete;
    expect(items(el)).toHaveLength(0);
  });
});
