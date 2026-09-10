/** @vitest-environment happy-dom */
import { describe, expect, it, vi } from "vitest";

import "../_mock-webawesome.js";

const { toastSuccess } = vi.hoisted(() => ({ toastSuccess: vi.fn() }));
vi.mock("sonner-js", () => ({
  default: { success: toastSuccess, error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));
const { copyToClipboard } = vi.hoisted(() => ({
  copyToClipboard: vi.fn(async () => true),
}));
vi.mock("../../src/util/copy-to-clipboard.js", () => ({ copyToClipboard }));
vi.mock("../../src/components/base-dialog.js", () => ({}));

import { mount } from "../_dom.js";
import { ESPHomeEncryptionKeyDialog } from "../../src/components/encryption-key-dialog.js";

const KEY = "QUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUE=";

const keyText = (el: ESPHomeEncryptionKeyDialog) =>
  el.shadowRoot!.querySelector(".key-value")?.textContent ?? null;
const buttons = (el: ESPHomeEncryptionKeyDialog) => [
  ...el.shadowRoot!.querySelectorAll<HTMLButtonElement>(".key-btn"),
];

async function openWith(key: string): Promise<ESPHomeEncryptionKeyDialog> {
  const el = await mount(new ESPHomeEncryptionKeyDialog());
  el.open(key);
  await el.updateComplete;
  return el;
}

describe("encryption-key-dialog", () => {
  it("shows the not-found copy for an empty key", async () => {
    const el = await openWith("");
    expect(keyText(el)).toBeNull();
    expect(el.shadowRoot!.querySelector(".no-key")?.textContent).toContain(
      "dashboard.action_encryption_key_not_found"
    );
  });

  it("masks the key until the eye toggle reveals it", async () => {
    const el = await openWith(KEY);
    expect(keyText(el)).toBe("QUFB••••••••••••••••QUE=");
    const [toggle] = buttons(el);
    expect(toggle.getAttribute("aria-label")).toBe(
      "dashboard.action_encryption_key_show"
    );

    toggle.click();
    await el.updateComplete;
    expect(keyText(el)).toBe(KEY);
    expect(buttons(el)[0].getAttribute("aria-label")).toBe(
      "dashboard.action_encryption_key_hide"
    );
  });

  it("masks a short key entirely", async () => {
    const el = await openWith("short");
    expect(keyText(el)).toBe("••••••••••••••••");
  });

  it("copies the full key and toasts", async () => {
    const el = await openWith(KEY);
    const [, copy] = buttons(el);
    expect(copy.getAttribute("aria-label")).toBe("dashboard.action_encryption_key_copy");

    copy.click();
    await vi.waitFor(() => expect(toastSuccess).toHaveBeenCalledTimes(1));
    expect(copyToClipboard).toHaveBeenCalledWith(KEY);
  });

  it("forgets the key once the dialog has hidden", async () => {
    const el = await openWith(KEY);
    el.shadowRoot!.querySelector("esphome-base-dialog")!.dispatchEvent(
      new Event("after-hide")
    );
    await el.updateComplete;
    expect(keyText(el)).toBeNull();
  });
});
