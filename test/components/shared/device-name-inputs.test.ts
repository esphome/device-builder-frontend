/**
 * @vitest-environment happy-dom
 *
 * Pins the shared friendly-name-first naming pair: live hostname
 * derivation with an edit latch, and the chevron disclosure over the
 * hostname field.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@home-assistant/webawesome/dist/components/icon/icon.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/tooltip/tooltip.js", () => ({}));

import { ESPHomeDeviceNameInputs } from "../../../src/components/shared/device-name-inputs.js";
import { mount } from "../../_dom.js";

async function mountInputs(
  props: Partial<ESPHomeDeviceNameInputs> = {}
): Promise<ESPHomeDeviceNameInputs> {
  return mount(new ESPHomeDeviceNameInputs(), {
    friendlyLabelKey: "label",
    friendlyPlaceholderKey: "placeholder",
    ...props,
  });
}

function friendlyInput(el: ESPHomeDeviceNameInputs): HTMLInputElement {
  return el.shadowRoot!.querySelector<HTMLInputElement>("#device-friendly-name")!;
}

async function typeFriendly(el: ESPHomeDeviceNameInputs, value: string) {
  const input = friendlyInput(el);
  input.value = value;
  input.dispatchEvent(new Event("input"));
  await el.updateComplete;
}

async function hostnameInput(el: ESPHomeDeviceNameInputs): Promise<HTMLInputElement> {
  let input = el.shadowRoot!.querySelector<HTMLInputElement>("#device-hostname");
  if (!input) {
    el.shadowRoot!.querySelector<HTMLButtonElement>(".disclosure-toggle")!.click();
    await el.updateComplete;
    input = el.shadowRoot!.querySelector<HTMLInputElement>("#device-hostname")!;
  }
  return input;
}

async function typeHostname(el: ESPHomeDeviceNameInputs, value: string) {
  const input = await hostnameInput(el);
  input.value = value;
  input.dispatchEvent(new Event("input"));
  await el.updateComplete;
}

describe("device-name-inputs derivation", () => {
  it("derives the hostname live from the friendly name", async () => {
    const el = await mountInputs();
    await typeFriendly(el, "Dining Room AC 2");
    expect(el.friendlyName).toBe("Dining Room AC 2");
    expect(el.hostname).toBe("dining-room-ac-2");
    expect(el.canSubmit).toBe(true);
  });

  it("shows the derived hostname on the collapsed disclosure row", async () => {
    const el = await mountInputs();
    // The default context-less localize is an identity stub that drops
    // params; substitute one that surfaces them so the label is assertable.
    (el as unknown as { _localize: unknown })._localize = (
      key: string,
      params?: Record<string, string | number>
    ) => `${key} ${Object.values(params ?? {}).join(" ")}`;
    await typeFriendly(el, "Bedroom Plug");
    expect(el.shadowRoot!.querySelector("#device-hostname")).toBeNull();
    expect(
      el.shadowRoot!.querySelector(".disclosure-toggle__label")!.textContent
    ).toContain("bedroom-plug");
  });

  it("stops deriving once the hostname is edited directly", async () => {
    const el = await mountInputs();
    await typeFriendly(el, "Dining Room AC");
    await typeHostname(el, "dining-ac");
    await typeFriendly(el, "Dining Room AC 2");
    expect(el.hostname).toBe("dining-ac");
    expect(el.friendlyName).toBe("Dining Room AC 2");
  });

  it("resumes deriving after the hostname is cleared", async () => {
    const el = await mountInputs();
    await typeHostname(el, "manual-name");
    await typeHostname(el, "");
    await typeFriendly(el, "Dining Room AC 2");
    expect(el.hostname).toBe("dining-room-ac-2");
  });

  it("reset() clears both fields and the latch, optionally seeding the friendly name", async () => {
    const el = await mountInputs();
    await typeHostname(el, "manual-name");
    el.reset("Fresh Start");
    await el.updateComplete;
    expect(el.friendlyName).toBe("Fresh Start");
    expect(el.hostname).toBe("fresh-start");
    await typeFriendly(el, "Fresh Start 2");
    expect(el.hostname).toBe("fresh-start-2");
  });

  it("fires device-name-changed on either input", async () => {
    const el = await mountInputs();
    const onChange = vi.fn();
    el.addEventListener("device-name-changed", onChange as EventListener);
    await typeFriendly(el, "A Plug");
    await typeHostname(el, "a-plug-2");
    expect(onChange).toHaveBeenCalledTimes(2);
  });
});

describe("device-name-inputs disclosure + validity", () => {
  it("toggles the hostname panel via the chevron", async () => {
    const el = await mountInputs();
    const toggle = el.shadowRoot!.querySelector<HTMLButtonElement>(".disclosure-toggle")!;
    expect(el.shadowRoot!.querySelector("#device-hostname")).toBeNull();
    toggle.click();
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector("#device-hostname")).not.toBeNull();
    toggle.click();
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector("#device-hostname")).toBeNull();
  });

  it("cannot submit while the hostname is empty", async () => {
    const el = await mountInputs();
    expect(el.canSubmit).toBe(false);
    await typeFriendly(el, "!!!");
    expect(el.hostname).toBe("");
    expect(el.canSubmit).toBe(false);
  });

  it("a name that slugs to nothing surfaces an error instead of a silent disable", async () => {
    const el = await mountInputs();
    await typeFriendly(el, "!!!");
    expect(el.validity.err?.code).toBe("naming.hostname_required");
    // The error force-opens the panel so the empty hostname field is visible.
    expect(el.shadowRoot!.querySelector("#device-hostname")).not.toBeNull();
    await typeFriendly(el, "Plug");
    expect(el.validity.err).toBeNull();
    expect(el.canSubmit).toBe(true);
  });

  it("a soft warning holds the panel open too", async () => {
    // Warnings render inside the panel body; a collapsed edge-hyphen or
    // underscore hostname would otherwise look fine on the toggle row.
    const el = await mountInputs();
    await typeHostname(el, "under_score");
    expect(el.validity.err).toBeNull();
    expect(el.validity.warning).not.toBeNull();
    el.shadowRoot!.querySelector<HTMLButtonElement>(".disclosure-toggle")!.click();
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector("#device-hostname")).not.toBeNull();
  });

  it("a hard validation error force-opens the panel", async () => {
    const el = await mountInputs();
    await typeHostname(el, "UPPER CASE");
    const toggle = el.shadowRoot!.querySelector<HTMLButtonElement>(".disclosure-toggle")!;
    toggle.click(); // try to collapse while invalid
    await el.updateComplete;
    expect(el.canSubmit).toBe(false);
    expect(el.shadowRoot!.querySelector("#device-hostname")).not.toBeNull();
  });

  it("offers the hostname help tooltip beside the disclosure", async () => {
    const el = await mountInputs();
    const help = el.shadowRoot!.querySelector("#hostname-help");
    expect(help).not.toBeNull();
    expect(help!.getAttribute("aria-label")).toBe("naming.hostname_help_label");
    const tooltip = el.shadowRoot!.querySelector('wa-tooltip[for="hostname-help"]');
    expect(tooltip!.textContent).toContain("naming.hostname_help");
  });

  it("a literal friendlyPlaceholder wins over the key", async () => {
    const el = await mountInputs({ friendlyPlaceholder: "e.g. Some Board" });
    expect(friendlyInput(el).getAttribute("placeholder")).toBe("e.g. Some Board");
  });

  it("caps a manual hostname override at 31 chars", async () => {
    // The backend clamps to esphome's 31-char hostname cap; a longer
    // override passing client validation would be silently rewritten.
    const el = await mountInputs();
    await typeHostname(el, "x".repeat(32));
    expect(el.validity.err?.code).toBe("validation.max_length");
    expect(el.canSubmit).toBe(false);
    await typeHostname(el, "x".repeat(31));
    expect(el.canSubmit).toBe(true);
  });

  it("blocks a taken hostname", async () => {
    const el = await mountInputs({ takenHostnames: new Set(["kitchen-plug"]) });
    await typeFriendly(el, "Kitchen Plug");
    expect(el.validity.err?.code).toBe("naming.hostname_taken");
    expect(el.canSubmit).toBe(false);
    // The error force-opens the panel so the collision is visible.
    expect(el.shadowRoot!.querySelector("#device-hostname")).not.toBeNull();
    await typeFriendly(el, "Kitchen Plug 2");
    expect(el.canSubmit).toBe(true);
  });

  it("the same-as-source error outranks the taken-hostname error", async () => {
    const el = await mountInputs({
      forbiddenHostname: "kitchen-plug",
      forbiddenErrorKey: "dashboard.action_clone_same_name",
      takenHostnames: new Set(["kitchen-plug"]),
    });
    await typeFriendly(el, "Kitchen Plug");
    expect(el.validity.err?.code).toBe("dashboard.action_clone_same_name");
  });

  it("rejects the forbidden hostname with the configured error", async () => {
    const el = await mountInputs({
      forbiddenHostname: "source",
      forbiddenErrorKey: "dashboard.action_clone_same_name",
    });
    await typeFriendly(el, "Source");
    expect(el.hostname).toBe("source");
    expect(el.canSubmit).toBe(false);
    expect(el.validity.err?.code).toBe("dashboard.action_clone_same_name");
    await typeFriendly(el, "Source 2");
    expect(el.canSubmit).toBe(true);
  });
});
