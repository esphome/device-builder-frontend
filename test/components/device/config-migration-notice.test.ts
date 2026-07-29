/**
 * @vitest-environment happy-dom
 *
 * Pins the config-migration nudge: backend dry-run detection once per
 * editor load, the migrate CTA event, dismissal, the debounced
 * clear-after-migrate re-check, and stale-resolve discards.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@home-assistant/webawesome/dist/components/icon/icon.js", () => ({}));

import type { YamlDiff } from "../../../src/api/types/automations.js";
import { ESPHomeConfigMigrationNotice } from "../../../src/components/device/config-migration-notice.js";

const LEGACY = "api:\n  services:\n    - service: pause\n      then: []\n";
const CANONICAL = "api:\n  actions:\n    - action: pause\n      then: []\n";

const DIFF: YamlDiff = { fromLine: 2, toLine: 3, replacement: "  actions:\n" };

function makeApi(impl?: (content: string) => Promise<{ yaml_diff: YamlDiff | null }>) {
  // Legacy-spelling stub standing in for the backend's real rule fold.
  const migrateConfig = vi.fn(
    impl ??
      ((content: string) =>
        Promise.resolve({ yaml_diff: content.includes("services:") ? DIFF : null }))
  );
  return { migrateConfig };
}

async function mount(
  yaml: string,
  api = makeApi()
): Promise<[ESPHomeConfigMigrationNotice, ReturnType<typeof makeApi>]> {
  const el = new ESPHomeConfigMigrationNotice();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (el as any)._localize = (key: string) => key;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (el as any)._api = api;
  el.configuration = "kitchen.yaml";
  el.yaml = yaml;
  document.body.appendChild(el);
  await el.updateComplete;
  await Promise.resolve();
  await el.updateComplete;
  return [el, api];
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = "";
});

describe("config-migration-notice", () => {
  it("renders when the dry-run returns a diff", async () => {
    const [el, api] = await mount(LEGACY);
    const notice = el.shadowRoot!.querySelector(".notice");
    expect(notice).not.toBeNull();
    expect(notice?.textContent).toContain("device.config_migration_notice");
    expect(api.migrateConfig).toHaveBeenCalledWith(LEGACY);
  });

  it("stays hidden when the dry-run returns null", async () => {
    const [el] = await mount(CANONICAL);
    expect(el.shadowRoot!.querySelector(".notice")).toBeNull();
  });

  it("stays hidden when detection fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const [el] = await mount(
      LEGACY,
      makeApi(() => Promise.reject(new Error("ws down")))
    );
    expect(el.shadowRoot!.querySelector(".notice")).toBeNull();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("does not detect until the api context arrives", async () => {
    const el = new ESPHomeConfigMigrationNotice();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (el as any)._localize = (key: string) => key;
    el.configuration = "kitchen.yaml";
    el.yaml = LEGACY;
    document.body.appendChild(el);
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector(".notice")).toBeNull();
    const api = makeApi();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (el as any)._api = api;
    el.requestUpdate();
    await el.updateComplete;
    await Promise.resolve();
    await el.updateComplete;
    expect(api.migrateConfig).toHaveBeenCalledTimes(1);
    expect(el.shadowRoot!.querySelector(".notice")).not.toBeNull();
  });

  it("emits request-migrate-config from the CTA", async () => {
    const [el] = await mount(LEGACY);
    const seen = vi.fn();
    el.addEventListener("request-migrate-config", seen);
    el.shadowRoot!.querySelector<HTMLButtonElement>(".cta")?.click();
    expect(seen).toHaveBeenCalledTimes(1);
  });

  it("hides after dismiss", async () => {
    const [el] = await mount(LEGACY);
    el.shadowRoot!.querySelector<HTMLButtonElement>(".notice-close")?.click();
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector(".notice")).toBeNull();
  });

  it("detects once per load — later edits wait for the next load", async () => {
    const [el, api] = await mount(CANONICAL);
    el.yaml = LEGACY;
    await el.updateComplete;
    await vi.runAllTimersAsync();
    expect(api.migrateConfig).toHaveBeenCalledTimes(1);
    expect(el.shadowRoot!.querySelector(".notice")).toBeNull();
  });

  it("re-checks (debounced) while live so a completed migration clears it", async () => {
    const [el, api] = await mount(LEGACY);
    expect(el.shadowRoot!.querySelector(".notice")).not.toBeNull();
    el.yaml = CANONICAL;
    await el.updateComplete;
    // Debounced — no immediate round-trip on every keystroke.
    expect(api.migrateConfig).toHaveBeenCalledTimes(1);
    await vi.runAllTimersAsync();
    await el.updateComplete;
    expect(api.migrateConfig).toHaveBeenCalledTimes(2);
    expect(el.shadowRoot!.querySelector(".notice")).toBeNull();
  });

  it("keeps a live nudge when a re-check fails", async () => {
    let call = 0;
    const api = makeApi(() => {
      call += 1;
      return call === 1
        ? Promise.resolve({ yaml_diff: DIFF })
        : Promise.reject(new Error("ws down"));
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const [el] = await mount(LEGACY, api);
    expect(el.shadowRoot!.querySelector(".notice")).not.toBeNull();
    el.yaml = CANONICAL;
    await el.updateComplete;
    await vi.runAllTimersAsync();
    await el.updateComplete;
    // A transient failure must not clear a nudge the buffer hasn't
    // been proven clean of.
    expect(el.shadowRoot!.querySelector(".notice")).not.toBeNull();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("re-arms when the buffer moves during the load-time round-trip", async () => {
    let resolveFirst!: (value: { yaml_diff: YamlDiff | null }) => void;
    let call = 0;
    const api = makeApi(() => {
      call += 1;
      if (call === 1) {
        return new Promise((resolve) => {
          resolveFirst = resolve;
        });
      }
      return Promise.resolve({ yaml_diff: DIFF });
    });
    const [el] = await mount(LEGACY, api);
    el.yaml = `${LEGACY}# edited\n`;
    await el.updateComplete;
    resolveFirst({ yaml_diff: DIFF });
    await Promise.resolve();
    await vi.runAllTimersAsync();
    await el.updateComplete;
    expect(api.migrateConfig).toHaveBeenCalledTimes(2);
    expect(el.shadowRoot!.querySelector(".notice")).not.toBeNull();
  });

  it("dismiss cancels a pending re-check", async () => {
    const [el, api] = await mount(LEGACY);
    el.yaml = CANONICAL;
    await el.updateComplete;
    el.shadowRoot!.querySelector<HTMLButtonElement>(".notice-close")?.click();
    await el.updateComplete;
    await vi.runAllTimersAsync();
    expect(api.migrateConfig).toHaveBeenCalledTimes(1);
  });

  it("re-detects and un-dismisses on a configuration switch", async () => {
    const [el] = await mount(CANONICAL);
    el.configuration = "other.yaml";
    el.yaml = LEGACY;
    await el.updateComplete;
    await Promise.resolve();
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector(".notice")).not.toBeNull();
  });

  it("discards a resolve from before a configuration switch", async () => {
    let resolveFirst!: (value: { yaml_diff: YamlDiff | null }) => void;
    let call = 0;
    const api = makeApi(() => {
      call += 1;
      if (call === 1) {
        return new Promise((resolve) => {
          resolveFirst = resolve;
        });
      }
      return Promise.resolve({ yaml_diff: null });
    });
    const [el] = await mount(LEGACY, api);
    el.configuration = "other.yaml";
    el.yaml = CANONICAL;
    await el.updateComplete;
    // The stale resolve for kitchen.yaml lands after the switch.
    resolveFirst({ yaml_diff: DIFF });
    await Promise.resolve();
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector(".notice")).toBeNull();
  });
});
