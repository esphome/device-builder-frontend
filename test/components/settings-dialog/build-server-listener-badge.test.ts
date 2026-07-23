/**
 * @vitest-environment happy-dom
 *
 * The build-server card's listener badge is three-state: a disabled listener
 * is intentional and reads neutral with an inline turn-on action, so the red
 * "Listener offline" only ever means an enabled listener that failed to bind.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@home-assistant/webawesome/dist/components/icon/icon.js", () => ({}));
// wa-dialog registers form-associated internals happy-dom can't run.
vi.mock("@home-assistant/webawesome/dist/components/dialog/dialog.js", () => ({}));
vi.mock("../../../src/util/notify.js", () => ({
  notify: {
    success: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
  },
}));

import { ESPHomeSettingsBuildServer } from "../../../src/components/settings-dialog/build-server-section.js";
import type { IdentityView } from "../../../src/api/types/remote-build.js";
import { notify } from "../../../src/util/notify.js";

const IDENTITY: IdentityView = {
  dashboard_id: "dash-1234",
  pin_sha256: "ab".repeat(32),
  server_version: "1.6.9",
  esphome_version: "2026.7.1",
  listener_bound: false,
  listener_host: null,
  listener_addresses: [],
  listener_port: null,
};

async function mount(
  enabled: boolean,
  listenerBound: boolean
): Promise<ESPHomeSettingsBuildServer> {
  const el = new ESPHomeSettingsBuildServer();
  /* eslint-disable @typescript-eslint/no-explicit-any */
  (el as any)._remoteBuildEnabled = enabled;
  (el as any)._api = {
    getRemoteBuildIdentity: async () => ({
      ...IDENTITY,
      listener_bound: listenerBound,
    }),
  };
  /* eslint-enable @typescript-eslint/no-explicit-any */
  document.body.appendChild(el);
  await el.updateComplete;
  // The identity controller loads async; flush it and the re-render.
  await Promise.resolve();
  await Promise.resolve();
  await el.updateComplete;
  return el;
}

const badge = (el: ESPHomeSettingsBuildServer) =>
  el.shadowRoot!.querySelector<HTMLSpanElement>(".build-server-listener-badge");
const turnOn = (el: ESPHomeSettingsBuildServer) =>
  el.shadowRoot!.querySelector<HTMLButtonElement>(
    ".build-server-listener-badge .link-button"
  );

describe("build-server listener badge", () => {
  it("shows the active badge when enabled and bound", async () => {
    const el = await mount(true, true);
    expect(badge(el)!.classList.contains("build-server-listener-up")).toBe(true);
    expect(badge(el)!.textContent).toContain("settings.remote_build_listener_up");
    expect(turnOn(el)).toBeNull();
  });

  it("shows the offline badge when enabled but not bound", async () => {
    const el = await mount(true, false);
    expect(badge(el)!.classList.contains("build-server-listener-down")).toBe(true);
    expect(badge(el)!.textContent).toContain("settings.remote_build_listener_down");
    expect(turnOn(el)).toBeNull();
  });

  it("shows a neutral disabled badge with a turn-on action when disabled", async () => {
    const el = await mount(false, false);
    expect(badge(el)!.classList.contains("build-server-listener-disabled")).toBe(true);
    expect(badge(el)!.textContent).toContain("settings.remote_build_listener_disabled");
    expect(badge(el)!.textContent).not.toContain("settings.remote_build_listener_down");
    expect(turnOn(el)).not.toBeNull();
    // The turn-on action must sit outside the live region.
    const status = badge(el)!.querySelector('[role="status"]')!;
    expect(status).not.toBeNull();
    expect(status.querySelector("button")).toBeNull();
  });

  it("fires set-remote-build-enabled(true) from the turn-on action", async () => {
    const el = await mount(false, false);
    const listener = vi.fn();
    el.addEventListener("set-remote-build-enabled", listener as EventListener);

    turnOn(el)!.click();

    expect(listener).toHaveBeenCalledTimes(1);
    expect((listener.mock.calls[0][0] as CustomEvent<boolean>).detail).toBe(true);
  });

  it("rotate while disabled reports success, not a listener-down warning", async () => {
    const el = await mount(false, false);
    /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
    (el as any)._api.rotateRemoteBuildIdentity = async () => ({
      ...IDENTITY,
      listener_bound: false,
    });
    vi.mocked(notify.success).mockClear();
    vi.mocked(notify.warning).mockClear();

    /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
    await (el as any)._onRotateConfirm();

    expect(notify.success).toHaveBeenCalledTimes(1);
    expect(notify.warning).not.toHaveBeenCalled();
  });

  it("rotate while enabled but unbound still warns", async () => {
    const el = await mount(true, false);
    /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
    (el as any)._api.rotateRemoteBuildIdentity = async () => ({
      ...IDENTITY,
      listener_bound: false,
    });
    vi.mocked(notify.success).mockClear();
    vi.mocked(notify.warning).mockClear();

    /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
    await (el as any)._onRotateConfirm();

    expect(notify.warning).toHaveBeenCalledTimes(1);
    expect(notify.success).not.toHaveBeenCalled();
  });
});
