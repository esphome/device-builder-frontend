/**
 * @vitest-environment happy-dom
 *
 * Pins the config-migration nudge: backend dry-run detection once per
 * editor load, the migrate CTA event, dismissal, the debounced
 * clear-after-migrate re-check, and stale-resolve discards.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import "../../_mock-webawesome.js";

import type { YamlDiff } from "../../../src/api/types/automations.js";
import type {
  MigrateConfigResponse,
  MigrationChange,
} from "../../../src/api/types/editor.js";
import { ESPHomeConfigMigrationNotice } from "../../../src/components/device/config-migration-notice.js";

const LEGACY = "api:\n  services:\n    - service: pause\n      then: []\n";
const CANONICAL = "api:\n  actions:\n    - action: pause\n      then: []\n";

const DIFF: YamlDiff = { fromLine: 2, toLine: 3, replacement: "  actions:\n" };

const API_CHANGE: MigrationChange = {
  kind: "field",
  scope: "api",
  old: "services",
  new: "actions",
  since: "2024.8.0",
  removed_in: null,
  required: false,
};

const MIGRATED: MigrateConfigResponse = { yaml_diff: DIFF, changes: [API_CHANGE] };
const CLEAN: MigrateConfigResponse = { yaml_diff: null, changes: [] };

function makeApi(impl?: (content: string) => Promise<MigrateConfigResponse>) {
  // Legacy-spelling stub standing in for the backend's real rule fold.
  const migrateConfig = vi.fn(
    impl ??
      ((content: string) =>
        Promise.resolve(content.includes("services:") ? MIGRATED : CLEAN))
  );
  return { migrateConfig };
}

async function mount(
  yaml: string,
  api = makeApi()
): Promise<[ESPHomeConfigMigrationNotice, ReturnType<typeof makeApi>]> {
  const el = new ESPHomeConfigMigrationNotice();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (el as any)._localize = (key: string, values?: Record<string, string | number>) =>
    `${key} ${values ? Object.values(values).join(" ") : ""}`;
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
    expect(notice?.textContent).toContain("device.config_migration_change_field");
    // Config spellings are set in code.
    expect([...notice!.querySelectorAll("li code")].map((c) => c.textContent)).toEqual([
      "services",
      "actions",
      "api",
    ]);
    expect(api.migrateConfig).toHaveBeenCalledWith(LEGACY);
  });

  it("lists the first changes and collapses the rest", async () => {
    const changes = Array.from({ length: 12 }, (_, i) => ({
      ...API_CHANGE,
      scope: `s${i}`,
    }));
    const [el] = await mount(
      LEGACY,
      makeApi(() => Promise.resolve({ yaml_diff: DIFF, changes }))
    );
    const items = el.shadowRoot!.querySelectorAll(".notice li");
    expect(items).toHaveLength(11);
    expect(items[10].textContent).toContain("device.editor_invalid_more");
    expect(el.shadowRoot!.querySelector(".required")).toBeNull();
  });

  it("falls back to the generic sentence when no change is named", async () => {
    const [el] = await mount(
      LEGACY,
      makeApi(() => Promise.resolve({ yaml_diff: DIFF, changes: [] }))
    );
    expect(el.shadowRoot!.querySelector(".notice")?.textContent).toContain(
      "device.config_migration_notice_generic"
    );
  });

  it("lists a required change first so it never collapses into the overflow", async () => {
    const changes = Array.from({ length: 12 }, (_, i) => ({
      ...API_CHANGE,
      scope: `s${i}`,
    }));
    changes.push({ ...API_CHANGE, scope: "last", required: true });
    const [el] = await mount(
      LEGACY,
      makeApi(() => Promise.resolve({ yaml_diff: DIFF, changes }))
    );
    const first = el.shadowRoot!.querySelector(".notice li");
    expect(first?.textContent).toContain("device.config_migration_change_required");
    expect(first?.textContent).toContain("last");
  });

  it("holds the preview while a re-check is pending", async () => {
    const [el] = await mount(LEGACY);
    expect(el.shadowRoot!.querySelector(".cta--secondary")).not.toBeNull();
    el.yaml = `${LEGACY}# edited\n`;
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector(".cta--secondary")).toBeNull();
    await vi.runAllTimersAsync();
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector(".cta--secondary")).not.toBeNull();
  });

  it("flags a change the installed ESPHome already rejects", async () => {
    const [el] = await mount(
      LEGACY,
      makeApi(() =>
        Promise.resolve({ yaml_diff: DIFF, changes: [{ ...API_CHANGE, required: true }] })
      )
    );
    expect(el.shadowRoot!.querySelector(".required .notice")).not.toBeNull();
  });

  it("opens the preview with the detected draft and its migrated text", async () => {
    const [el] = await mount(LEGACY);
    const dialog = el.shadowRoot!.querySelector(
      "esphome-config-migration-preview-dialog"
    )!;
    expect(dialog.shadowRoot!.querySelector("esphome-yaml-diff")).toBeNull();
    el.shadowRoot!.querySelector<HTMLButtonElement>(".cta--secondary")?.click();
    await el.updateComplete;
    await dialog.updateComplete;
    expect(dialog.shadowRoot!.querySelector("esphome-base-dialog")?.open).toBe(true);
    expect(dialog.shadowRoot!.querySelector("esphome-yaml-diff")).not.toBeNull();
    expect(dialog.configuration).toBe("kitchen.yaml");
    expect(dialog.oldValue).toBe(LEGACY);
    expect(dialog.newValue).toBe("api:\n  actions:\n      then: []\n");
    const seen = vi.fn();
    el.addEventListener("request-migrate-config", seen);
    dialog.shadowRoot!.querySelector<HTMLButtonElement>(".btn--primary")?.click();
    expect(seen).toHaveBeenCalledTimes(1);
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
        ? Promise.resolve(MIGRATED)
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
    let resolveFirst!: (value: MigrateConfigResponse) => void;
    let call = 0;
    const api = makeApi(() => {
      call += 1;
      if (call === 1) {
        return new Promise((resolve) => {
          resolveFirst = resolve;
        });
      }
      return Promise.resolve(MIGRATED);
    });
    const [el] = await mount(LEGACY, api);
    el.yaml = `${LEGACY}# edited\n`;
    await el.updateComplete;
    resolveFirst(MIGRATED);
    await Promise.resolve();
    await vi.runAllTimersAsync();
    await el.updateComplete;
    expect(api.migrateConfig).toHaveBeenCalledTimes(2);
    expect(el.shadowRoot!.querySelector(".notice")).not.toBeNull();
  });

  it("typing defers a pending load-path re-arm instead of firing per debounce", async () => {
    let resolveFirst!: (value: MigrateConfigResponse) => void;
    let call = 0;
    const api = makeApi(() => {
      call += 1;
      if (call === 1) {
        return new Promise((resolve) => {
          resolveFirst = resolve;
        });
      }
      return Promise.resolve(MIGRATED);
    });
    const [el] = await mount(LEGACY, api);
    el.yaml = `${LEGACY}# one\n`;
    await el.updateComplete;
    resolveFirst(MIGRATED);
    await Promise.resolve();
    // Keystrokes inside the debounce window keep deferring the re-arm.
    await vi.advanceTimersByTimeAsync(400);
    el.yaml = `${LEGACY}# two\n`;
    await el.updateComplete;
    await vi.advanceTimersByTimeAsync(400);
    expect(api.migrateConfig).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(400);
    await el.updateComplete;
    expect(api.migrateConfig).toHaveBeenCalledTimes(2);
    expect(el.shadowRoot!.querySelector(".notice")).not.toBeNull();
  });

  it("a resolve after disconnect arms nothing", async () => {
    let resolveFirst!: (value: MigrateConfigResponse) => void;
    const api = makeApi(
      () =>
        new Promise((resolve) => {
          resolveFirst = resolve;
        })
    );
    const [el] = await mount(LEGACY, api);
    el.yaml = `${LEGACY}# edited\n`;
    await el.updateComplete;
    el.remove();
    resolveFirst(MIGRATED);
    await Promise.resolve();
    await vi.runAllTimersAsync();
    expect(api.migrateConfig).toHaveBeenCalledTimes(1);
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
    let resolveFirst!: (value: MigrateConfigResponse) => void;
    let call = 0;
    const api = makeApi(() => {
      call += 1;
      if (call === 1) {
        return new Promise((resolve) => {
          resolveFirst = resolve;
        });
      }
      return Promise.resolve(CLEAN);
    });
    const [el] = await mount(LEGACY, api);
    el.configuration = "other.yaml";
    el.yaml = CANONICAL;
    await el.updateComplete;
    // The stale resolve for kitchen.yaml lands after the switch.
    resolveFirst(MIGRATED);
    await Promise.resolve();
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector(".notice")).toBeNull();
  });
});
