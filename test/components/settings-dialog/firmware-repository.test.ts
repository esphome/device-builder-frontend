/** @vitest-environment happy-dom */
import { describe, expect, it, vi } from "vitest";

import { identityLocalize } from "../../_dom.js";
import { ESPHomeSettingsFirmwareRepository } from "../../../src/components/settings-dialog/firmware-repository-section.js";

async function mount(
  accessEnabled: boolean,
  authenticatePublic = true,
  api = { firmwareRepositoryAccessTokens: vi.fn().mockResolvedValue([]) }
): Promise<ESPHomeSettingsFirmwareRepository> {
  const el = new ESPHomeSettingsFirmwareRepository();
  Object.assign(el as unknown as Record<string, unknown>, {
    _localize: identityLocalize,
    _api: api,
    _accessEnabled: accessEnabled,
    _authenticatePublic: authenticatePublic,
  });
  document.body.appendChild(el);
  await el.updateComplete;
  await Promise.resolve();
  await el.updateComplete;
  return el;
}

function accessToggle(el: ESPHomeSettingsFirmwareRepository): HTMLButtonElement {
  return el.shadowRoot!.querySelector<HTMLButtonElement>(
    'button.toggle[aria-labelledby="firmware-repository-access-title"]'
  )!;
}

function authenticateToggle(el: ESPHomeSettingsFirmwareRepository): HTMLButtonElement {
  return el.shadowRoot!.querySelector<HTMLButtonElement>(
    'button.toggle[aria-labelledby="firmware-repository-authenticate-title"]'
  )!;
}

describe("firmware repository Settings section", () => {
  it("reflects both public access preferences", async () => {
    const el = await mount(true, false);
    expect(accessToggle(el).getAttribute("aria-checked")).toBe("true");
    expect(authenticateToggle(el).getAttribute("aria-checked")).toBe("false");
  });

  it("fires the next repository-access preference value", async () => {
    const el = await mount(false);
    const listener = vi.fn();
    el.addEventListener("set-firmware-repository-access-enabled", listener);

    accessToggle(el).click();

    expect(listener).toHaveBeenCalledOnce();
    const event = listener.mock.calls[0][0] as CustomEvent<boolean>;
    expect(event.detail).toBe(true);
    expect(event.bubbles).toBe(true);
    expect(event.composed).toBe(true);
  });

  it("fires the next public-authentication preference value", async () => {
    const el = await mount(true);
    const listener = vi.fn();
    el.addEventListener("set-firmware-repository-authenticate-public", listener);

    authenticateToggle(el).click();

    expect(listener).toHaveBeenCalledOnce();
    const event = listener.mock.calls[0][0] as CustomEvent<boolean>;
    expect(event.detail).toBe(false);
    expect(event.bubbles).toBe(true);
    expect(event.composed).toBe(true);
  });

  it("creates a token and shows its secret only in the creation result", async () => {
    const listed = [
      {
        id: "existing-id",
        name: "Existing client",
        last_four: "1234",
        created_at: "2026-11-08T12:00:00Z",
      },
    ];
    const created = {
      id: "new-id",
      name: "Phone",
      last_four: "abcd",
      created_at: "2026-11-09T12:00:00Z",
      token: "one-time-secret",
    };
    const api = {
      firmwareRepositoryAccessTokens: vi.fn().mockResolvedValue(listed),
      firmwareRepositoryAddAccessToken: vi.fn().mockResolvedValue(created),
      firmwareRepositoryDeleteAccessToken: vi.fn().mockResolvedValue(undefined),
    };
    const el = await mount(true, false, api);
    const input = el.shadowRoot!.querySelector<HTMLInputElement>(
      "#firmware-repository-token-name"
    )!;
    input.value = "  Phone  ";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    el.shadowRoot!.querySelector(".token-form")!.dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true })
    );
    await Promise.resolve();
    await el.updateComplete;

    expect(api.firmwareRepositoryAddAccessToken).toHaveBeenCalledWith("Phone");
    expect(el.shadowRoot!.querySelector(".token-secret code")?.textContent).toBe(
      "one-time-secret"
    );
    expect(el.shadowRoot!.querySelector(".token-list")?.textContent).not.toContain(
      "one-time-secret"
    );
    el.shadowRoot!.querySelector<HTMLButtonElement>(
      ".token-secret-actions button:last-child"
    )!.click();
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector(".token-secret")).toBeNull();
  });

  it("revokes a token by its id", async () => {
    const token = {
      id: "token-id",
      name: "Kitchen",
      last_four: "a1b2",
      created_at: "2026-11-09T12:00:00Z",
    };
    const api = {
      firmwareRepositoryAccessTokens: vi.fn().mockResolvedValue([token]),
      firmwareRepositoryAddAccessToken: vi.fn(),
      firmwareRepositoryDeleteAccessToken: vi.fn().mockResolvedValue(undefined),
    };
    const el = await mount(true, false, api);
    el.shadowRoot!.querySelector<HTMLButtonElement>(".token-button--danger")!.click();
    await Promise.resolve();
    await el.updateComplete;

    expect(api.firmwareRepositoryDeleteAccessToken).toHaveBeenCalledWith("token-id");
    expect(el.shadowRoot!.querySelector(".token-list")).toBeNull();
  });
});
