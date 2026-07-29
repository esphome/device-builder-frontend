/**
 * @vitest-environment happy-dom
 *
 * Pins the config-migration nudge: detection once per editor load, the
 * migrate CTA event, dismissal, and the clear-after-migrate re-check.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@home-assistant/webawesome/dist/components/icon/icon.js", () => ({}));

import { ESPHomeConfigMigrationNotice } from "../../../src/components/device/config-migration-notice.js";

const LEGACY = "api:\n  services:\n    - service: pause\n      then: []\n";
const CANONICAL = "api:\n  actions:\n    - action: pause\n      then: []\n";

async function mount(yaml: string): Promise<ESPHomeConfigMigrationNotice> {
  const el = new ESPHomeConfigMigrationNotice();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (el as any)._localize = (key: string) => key;
  el.configuration = "kitchen.yaml";
  el.yaml = yaml;
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}

describe("config-migration-notice", () => {
  it("renders when the config needs migrating", async () => {
    const el = await mount(LEGACY);
    const notice = el.shadowRoot!.querySelector(".notice");
    expect(notice).not.toBeNull();
    expect(notice?.textContent).toContain("device.config_migration_notice");
  });

  it("stays hidden for an up-to-date config", async () => {
    const el = await mount(CANONICAL);
    expect(el.shadowRoot!.querySelector(".notice")).toBeNull();
  });

  it("emits request-migrate-config from the CTA", async () => {
    const el = await mount(LEGACY);
    const seen = vi.fn();
    el.addEventListener("request-migrate-config", seen);
    el.shadowRoot!.querySelector<HTMLButtonElement>(".cta")?.click();
    expect(seen).toHaveBeenCalledTimes(1);
  });

  it("hides after dismiss", async () => {
    const el = await mount(LEGACY);
    el.shadowRoot!.querySelector<HTMLButtonElement>(".notice-close")?.click();
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector(".notice")).toBeNull();
  });

  it("detects once per load — later edits wait for the next load", async () => {
    const el = await mount(CANONICAL);
    el.yaml = LEGACY;
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector(".notice")).toBeNull();
  });

  it("re-checks while live so a completed migration clears it", async () => {
    const el = await mount(LEGACY);
    expect(el.shadowRoot!.querySelector(".notice")).not.toBeNull();
    el.yaml = CANONICAL;
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector(".notice")).toBeNull();
  });

  it("re-detects and un-dismisses on a configuration switch", async () => {
    const el = await mount(CANONICAL);
    el.configuration = "other.yaml";
    el.yaml = LEGACY;
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector(".notice")).not.toBeNull();
  });
});
