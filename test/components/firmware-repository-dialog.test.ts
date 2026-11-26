/** @vitest-environment happy-dom */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@home-assistant/webawesome/dist/components/dialog/dialog.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/icon/icon.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/spinner/spinner.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/button/button.js", () => ({}));
vi.mock(
  "@home-assistant/webawesome/dist/components/button-group/button-group.js",
  () => ({})
);
vi.mock("@home-assistant/webawesome/dist/components/dropdown/dropdown.js", () => ({}));
vi.mock(
  "@home-assistant/webawesome/dist/components/dropdown-item/dropdown-item.js",
  () => ({})
);
vi.mock("../../src/util/notify.js", () => ({
  notifyError: vi.fn(),
  notifySuccess: vi.fn(),
}));
vi.mock("../../src/util/copy-to-clipboard.js", () => ({
  copyToClipboard: vi.fn().mockResolvedValue(true),
}));
vi.mock("../../src/util/download-text.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/util/download-text.js")>();
  return { ...actual, downloadBlob: vi.fn() };
});

import { identityLocalize } from "../_dom.js";
import type { ESPHomeAPI } from "../../src/api/index.js";
import type { FirmwareRepositoryRecord } from "../../src/api/types/firmware-repository.js";
import { ESPHomeFirmwareRepositoryDialog } from "../../src/components/firmware-repository/esphome-firmware-repository-dialog.js";
import { copyToClipboard } from "../../src/util/copy-to-clipboard.js";
import { downloadBlob } from "../../src/util/download-text.js";

afterEach(() => {
  document.body.replaceChildren();
  vi.clearAllMocks();
});

const saved: FirmwareRepositoryRecord = {
  device: "kitchen",
  version: "1.0.0",
  compiled_at: "2026-01-15T12:00:00Z",
  esphome_version: "2026.11.0",
  status: "saved",
  yaml: "kitchen/1.0.0.yaml",
  bin: "kitchen/1.0.0.bin",
  md5: "0123456789abcdef0123456789abcdef",
  saved_at: "2026-11-08T00:00:00Z",
};

async function settle(el: ESPHomeFirmwareRepositoryDialog): Promise<void> {
  await Promise.resolve();
  await el.updateComplete;
  await Promise.resolve();
  await el.updateComplete;
}

function selectArtifactMenu(
  el: ESPHomeFirmwareRepositoryDialog,
  dropdownIndex: number,
  value: string
): void {
  const dropdown = el.shadowRoot!.querySelectorAll("wa-dropdown")[dropdownIndex];
  const item = dropdown.querySelector(`wa-dropdown-item[value="${value}"]`)!;
  dropdown.dispatchEvent(
    new CustomEvent("wa-select", { bubbles: true, composed: true, detail: { item } })
  );
}

describe("esphome-firmware-repository-dialog", () => {
  it("submits a required summary and optional release URL when saving a build", async () => {
    const savedRecord = { ...saved, summary: "First stable release" };
    const api = {
      firmwareRepositorySave: vi.fn().mockResolvedValue(savedRecord),
      firmwareRepositoryList: vi.fn().mockResolvedValue([savedRecord]),
    };
    const el = new ESPHomeFirmwareRepositoryDialog();
    Object.assign(el as unknown as Record<string, unknown>, {
      _api: api as unknown as ESPHomeAPI,
      _localize: identityLocalize,
    });
    document.body.appendChild(el);

    el.openSave("kitchen.yaml");
    await settle(el);
    const summary =
      el.shadowRoot!.querySelector<HTMLTextAreaElement>("#repository-summary")!;
    const releaseUrl = el.shadowRoot!.querySelector<HTMLInputElement>(
      "#repository-release-url"
    )!;
    summary.value = "  First stable release  ";
    summary.dispatchEvent(new Event("input", { bubbles: true }));
    expect(summary.required).toBe(true);
    releaseUrl.value = "  https://example.com/releases/1.0.0  ";
    releaseUrl.dispatchEvent(new Event("input", { bubbles: true }));
    el.shadowRoot!.querySelector<HTMLFormElement>(".save-form")!.dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true })
    );
    await settle(el);

    expect(api.firmwareRepositorySave).toHaveBeenCalledWith("kitchen.yaml", {
      summary: "First stable release",
      release_url: "https://example.com/releases/1.0.0",
    });
    expect(api.firmwareRepositoryList).toHaveBeenCalledTimes(1);
    expect(el.shadowRoot!.querySelector(".save-form")).toBeNull();
  });

  it("allows saving with a summary and an empty optional release URL", async () => {
    const api = {
      firmwareRepositorySave: vi.fn().mockResolvedValue(saved),
      firmwareRepositoryList: vi.fn().mockResolvedValue([saved]),
    };
    const el = new ESPHomeFirmwareRepositoryDialog();
    Object.assign(el as unknown as Record<string, unknown>, {
      _api: api as unknown as ESPHomeAPI,
      _localize: identityLocalize,
    });
    document.body.appendChild(el);

    el.openSave("kitchen.yaml");
    await settle(el);
    const summary =
      el.shadowRoot!.querySelector<HTMLTextAreaElement>("#repository-summary")!;
    summary.value = "Required summary";
    summary.dispatchEvent(new Event("input", { bubbles: true }));
    el.shadowRoot!.querySelector<HTMLFormElement>(".save-form")!.dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true })
    );
    await settle(el);

    expect(api.firmwareRepositorySave).toHaveBeenCalledWith("kitchen.yaml", {
      summary: "Required summary",
    });
  });

  it("rejects an empty or whitespace-only summary without saving", async () => {
    const api = { firmwareRepositorySave: vi.fn() };
    const el = new ESPHomeFirmwareRepositoryDialog();
    Object.assign(el as unknown as Record<string, unknown>, {
      _api: api as unknown as ESPHomeAPI,
      _localize: identityLocalize,
    });
    document.body.appendChild(el);

    el.openSave("kitchen.yaml");
    await settle(el);
    const summary =
      el.shadowRoot!.querySelector<HTMLTextAreaElement>("#repository-summary")!;
    summary.value = "   ";
    summary.dispatchEvent(new Event("input", { bubbles: true }));
    el.shadowRoot!.querySelector<HTMLFormElement>(".save-form")!.dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true })
    );
    await settle(el);

    expect(api.firmwareRepositorySave).not.toHaveBeenCalled();
    expect(el.shadowRoot!.querySelector('[role="alert"]')!.textContent).toContain(
      "firmware_repository.summary_required"
    );
  });

  it("uses the firmware friendly name as the dialog title", async () => {
    const api = {
      firmwareRepositoryList: vi
        .fn()
        .mockResolvedValue([{ ...saved, friendly_name: "Kitchen Lights" }]),
    };
    const localize = vi.fn(identityLocalize);
    const el = new ESPHomeFirmwareRepositoryDialog();
    Object.assign(el as unknown as Record<string, unknown>, {
      _api: api as unknown as ESPHomeAPI,
      _localize: localize,
    });
    document.body.appendChild(el);

    el.open("configs/kitchen.yaml", "Dashboard Kitchen");
    await settle(el);

    expect(
      (
        el.shadowRoot!.querySelector("esphome-base-dialog") as HTMLElement & {
          label: string;
        }
      ).label
    ).toBe("firmware_repository.dialog_title");
    expect(localize).toHaveBeenCalledWith("firmware_repository.dialog_title", {
      device: "Kitchen Lights",
    });
  });

  it("uses esphome_name when friendly_name is not available", async () => {
    const api = {
      firmwareRepositoryList: vi
        .fn()
        .mockResolvedValue([{ ...saved, esphome_name: "Kitchen ESPHome" }]),
    };
    const localize = vi.fn(identityLocalize);
    const el = new ESPHomeFirmwareRepositoryDialog();
    Object.assign(el as unknown as Record<string, unknown>, {
      _api: api as unknown as ESPHomeAPI,
      _localize: localize,
    });
    document.body.appendChild(el);

    el.open("configs/kitchen.yaml", "Dashboard Kitchen");
    await settle(el);

    expect(localize).toHaveBeenCalledWith("firmware_repository.dialog_title", {
      device: "Kitchen ESPHome",
    });
  });

  it("shows selected device versions newest first under one heading", async () => {
    const secondKitchenVersion = {
      ...saved,
      version: "2.0.0",
      compiled_at: "2026-04-15T12:00:00Z",
      esphome_version: "2.0.0",
      yaml: "kitchen/2.0.0.yaml",
      bin: "kitchen/2.0.0.bin",
    };
    const versionWithoutEsphome: FirmwareRepositoryRecord = {
      ...saved,
      version: "3.0.0",
      compiled_at: null,
      saved_at: "2026-11-08T00:00:00Z",
      esphome_version: undefined,
      yaml: "kitchen/3.0.0.yaml",
      bin: "kitchen/3.0.0.bin",
    };
    const tenthKitchenVersion: FirmwareRepositoryRecord = {
      ...saved,
      version: "10.0.0",
      compiled_at: "2026-02-15T12:00:00Z",
      esphome_version: "10.0.0",
      yaml: "kitchen/10.0.0.yaml",
      bin: "kitchen/10.0.0.bin",
    };
    const garage = {
      ...saved,
      device: "garage",
      yaml: "garage/1.0.0.yaml",
      bin: "garage/1.0.0.bin",
    };
    const api = {
      firmwareRepositoryList: vi
        .fn()
        .mockResolvedValue([
          saved,
          secondKitchenVersion,
          versionWithoutEsphome,
          garage,
          tenthKitchenVersion,
        ]),
    };
    const localize = vi.fn(identityLocalize);
    const el = new ESPHomeFirmwareRepositoryDialog();
    Object.assign(el as unknown as Record<string, unknown>, {
      _api: api as unknown as ESPHomeAPI,
      _localize: localize,
    });
    document.body.appendChild(el);

    el.open("configs/kitchen.yaml", "Dashboard Kitchen");
    await settle(el);

    expect(
      (
        el.shadowRoot!.querySelector("esphome-base-dialog") as HTMLElement & {
          label: string;
        }
      ).label
    ).toBe("firmware_repository.dialog_title");
    expect(localize).toHaveBeenCalledWith("firmware_repository.dialog_title", {
      device: "Dashboard Kitchen",
    });
    expect(
      Array.from(el.shadowRoot!.querySelectorAll(".record h3"), (version) =>
        version.textContent?.trim()
      )
    ).toEqual(["2.0.0", "10.0.0", "1.0.0", "3.0.0"]);
    const versionMenuButtons =
      el.shadowRoot!.querySelectorAll<HTMLButtonElement>(".version-menu-btn");
    expect(versionMenuButtons[0].closest(".record-heading")).not.toBeNull();
    versionMenuButtons[versionMenuButtons.length - 1].click();
    await settle(el);
    const lastMenu = el.shadowRoot!.querySelector<HTMLElement>(".version-menu")!;
    expect(lastMenu.style.top).not.toBe("");
    expect(lastMenu.style.left).not.toBe("");
    expect(el.shadowRoot!.querySelectorAll(".esphome-version")).toHaveLength(1);
    expect(el.shadowRoot!.querySelector(".record .artifact-type")!.textContent).toContain(
      "firmware_repository.artifact_legacy"
    );
    expect(el.shadowRoot!.querySelector(".esphome-version")!.textContent).toContain(
      "firmware_repository.esphome_version"
    );
    expect(
      el.shadowRoot!.querySelector('[title="firmware_repository.refresh"]')
    ).toBeNull();
  });

  it("shows available firmware types as labels between ESPHome version and status", async () => {
    const api = {
      firmwareRepositoryList: vi.fn().mockResolvedValue([
        {
          ...saved,
          ota_bin: "kitchen/1.0.0-ota.bin",
          ota_md5: "ota-md5",
          factory_bin: "kitchen/1.0.0-factory.bin",
          factory_md5: "factory-md5",
        },
      ]),
      firmwareRepositoryDownload: vi.fn(async () => ({
        blob: new Blob(["md5"]),
        filename: "kitchen-1.0.0.md5",
      })),
    };
    const el = new ESPHomeFirmwareRepositoryDialog();
    Object.assign(el as unknown as Record<string, unknown>, {
      _api: api as unknown as ESPHomeAPI,
      _localize: identityLocalize,
    });
    document.body.appendChild(el);

    el.open("configs/kitchen.yaml", "Dashboard Kitchen");
    await settle(el);

    expect(
      Array.from(el.shadowRoot!.querySelector(".record-heading")!.children)
        .filter((child) => !child.classList.contains("version-actions"))
        .map((child) => child.textContent?.trim())
    ).toEqual([
      "1.0.0",
      "firmware_repository.esphome_version",
      "firmware_repository.artifact_ota",
      "firmware_repository.artifact_factory",
      "firmware_repository.status_saved",
    ]);
    expect(el.shadowRoot!.querySelectorAll(".artifact-type")).toHaveLength(2);
    expect(el.shadowRoot!.querySelectorAll(".artifact-download-main")).toHaveLength(2);
    expect(
      el.shadowRoot!.querySelectorAll("wa-button-group.artifact-split-btn")
    ).toHaveLength(2);
    expect(el.shadowRoot!.querySelector(".artifact-label")).toBeNull();

    const artifactMenuTriggers = el.shadowRoot!.querySelectorAll(
      'wa-button[slot="trigger"][with-caret]'
    );
    expect(artifactMenuTriggers).toHaveLength(2);
    expect(
      Array.from(
        el
          .shadowRoot!.querySelectorAll("wa-dropdown")[0]
          .querySelectorAll("wa-dropdown-item"),
        (item) => item.textContent?.trim()
      )
    ).toEqual(["firmware.copy_md5", "firmware.download_md5"]);
    selectArtifactMenu(el, 0, "download-md5");
    await settle(el);
    expect(api.firmwareRepositoryDownload).toHaveBeenLastCalledWith(
      "kitchen",
      "1.0.0",
      "md5",
      "ota"
    );

    selectArtifactMenu(el, 1, "download-md5");
    await settle(el);
    expect(api.firmwareRepositoryDownload).toHaveBeenLastCalledWith(
      "kitchen",
      "1.0.0",
      "md5",
      "factory"
    );
  });
  it("keeps the single-version action menu from being clipped", async () => {
    const api = { firmwareRepositoryList: vi.fn().mockResolvedValue([saved]) };
    const el = new ESPHomeFirmwareRepositoryDialog();
    Object.assign(el as unknown as Record<string, unknown>, {
      _api: api as unknown as ESPHomeAPI,
      _localize: identityLocalize,
    });
    document.body.appendChild(el);

    el.open("configs/kitchen.yaml", "Dashboard Kitchen");
    await settle(el);
    expect(el.shadowRoot!.querySelector(".record-list--single")).not.toBeNull();

    el.shadowRoot!.querySelector<HTMLButtonElement>(".version-menu-btn")!.click();
    await settle(el);

    const menu = el.shadowRoot!.querySelector<HTMLElement>(".version-menu")!;
    expect(menu.style.top).not.toBe("");
    expect(menu.style.left).not.toBe("");
    expect(
      Array.from(
        el.shadowRoot!.querySelectorAll('.version-menu [role="menuitem"]'),
        (item) => item.textContent?.trim()
      )
    ).toEqual(["firmware_repository.publish", "firmware_repository.delete"]);
  });

  it("copies MD5 and downloads YAML, BIN, and MD5 through the repository route", async () => {
    const api = {
      firmwareRepositoryList: vi.fn().mockResolvedValue([saved]),
      firmwareRepositoryDownload: vi.fn(
        async (_device: string, _version: string, file: string) => ({
          blob: new Blob([`${file} contents`]),
          filename: file === "md5" ? "kitchen-1.0.0.bin.md5" : `kitchen-1.0.0.${file}`,
        })
      ),
    };
    const el = new ESPHomeFirmwareRepositoryDialog();
    Object.assign(el as unknown as Record<string, unknown>, {
      _api: api as unknown as ESPHomeAPI,
      _localize: identityLocalize,
    });
    document.body.appendChild(el);

    el.open("configs/kitchen.yaml", "Dashboard Kitchen");
    await settle(el);
    expect(el.shadowRoot!.querySelector(".record")!.textContent).not.toContain(
      saved.yaml
    );
    expect(el.shadowRoot!.querySelector(".record")!.textContent).not.toContain(saved.bin);
    expect(
      el.shadowRoot!.querySelector('[title="firmware_repository.download_yaml"]')
    ).not.toBeNull();
    expect(
      el.shadowRoot!.querySelector('[title="firmware_repository.download_bin"]')
    ).not.toBeNull();
    expect(el.shadowRoot!.querySelector(".checksum-row")).toBeNull();
    expect(el.shadowRoot!.querySelectorAll(".artifact-download-main")).toHaveLength(1);
    expect(
      el.shadowRoot!.querySelectorAll('wa-button[slot="trigger"][with-caret]')
    ).toHaveLength(1);
    expect(el.shadowRoot!.querySelector(".record")!.textContent).not.toContain(saved.md5);
    selectArtifactMenu(el, 0, "copy-md5");
    await settle(el);

    expect(copyToClipboard).toHaveBeenCalledWith(saved.md5);
    el.shadowRoot!.querySelector<HTMLButtonElement>(
      '[title="firmware_repository.download_yaml"]'
    )!.click();
    await settle(el);
    expect(api.firmwareRepositoryDownload).toHaveBeenLastCalledWith(
      "kitchen",
      "1.0.0",
      "yaml"
    );

    el.shadowRoot!.querySelector<HTMLButtonElement>(
      '[title="firmware_repository.download_bin"]'
    )!.click();
    await settle(el);
    expect(api.firmwareRepositoryDownload).toHaveBeenLastCalledWith(
      "kitchen",
      "1.0.0",
      "bin"
    );

    selectArtifactMenu(el, 0, "download-md5");
    await settle(el);
    expect(api.firmwareRepositoryDownload).toHaveBeenLastCalledWith(
      "kitchen",
      "1.0.0",
      "md5"
    );
    expect(downloadBlob).toHaveBeenCalledTimes(3);
  });

  it("publishes a version and refreshes the resulting statuses", async () => {
    const published = { ...saved, status: "published" as const };
    const api = {
      firmwareRepositoryList: vi
        .fn()
        .mockResolvedValueOnce([saved])
        .mockResolvedValueOnce([published]),
      firmwareRepositoryPublish: vi.fn().mockResolvedValue(published),
    };
    const el = new ESPHomeFirmwareRepositoryDialog();
    Object.assign(el as unknown as Record<string, unknown>, {
      _api: api as unknown as ESPHomeAPI,
      _localize: identityLocalize,
    });
    document.body.appendChild(el);

    el.open("configs/kitchen.yaml", "Dashboard Kitchen");
    await settle(el);
    expect(el.shadowRoot!.querySelector(".record")!.textContent).toContain(
      "firmware_repository.status_saved"
    );

    el.shadowRoot!.querySelector<HTMLButtonElement>(".version-menu-btn")!.click();
    await settle(el);
    let menuItems = el.shadowRoot!.querySelectorAll<HTMLElement>(
      '.version-menu [role="menuitem"]'
    );
    expect(Array.from(menuItems, (item) => item.textContent?.trim())).toEqual([
      "firmware_repository.publish",
      "firmware_repository.delete",
    ]);
    menuItems[0].click();
    await settle(el);

    expect(api.firmwareRepositoryPublish).toHaveBeenCalledWith("kitchen", "1.0.0");
    expect(api.firmwareRepositoryList).toHaveBeenCalledTimes(2);
    expect(el.shadowRoot!.querySelector(".record")!.textContent).toContain(
      "firmware_repository.status_published"
    );

    el.shadowRoot!.querySelector<HTMLButtonElement>(".version-menu-btn")!.click();
    await settle(el);
    menuItems = el.shadowRoot!.querySelectorAll<HTMLElement>(
      '.version-menu [role="menuitem"]'
    );
    expect(Array.from(menuItems, (item) => item.textContent?.trim())).toEqual([
      "firmware_repository.delete",
    ]);
  });
});
