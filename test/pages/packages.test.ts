// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("sonner-js", () => ({
  default: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));
vi.mock("../../src/util/navigation.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/util/navigation.js")>()),
  navigate: vi.fn().mockResolvedValue(true),
}));

import toast from "sonner-js";

import "../_mock-webawesome.js";
import { flushMicrotasks, identityLocalize } from "../_dom.js";
import { APIError } from "../../src/api/api-error.js";
import type { ESPHomeAPI } from "../../src/api/index.js";
import { ESPHomePagePackages } from "../../src/pages/packages.js";
import { navigate } from "../../src/util/navigation.js";

vi.mock("@home-assistant/webawesome/dist/components/button/button.js", () => ({}));
vi.mock("../../src/components/confirm-dialog.js", () => ({}));
vi.mock("../../src/components/packages/file-list-dialog.js", () => ({}));

type Api = Partial<Record<keyof ESPHomeAPI, ReturnType<typeof vi.fn>>>;

async function mountWith(api: Api): Promise<ESPHomePagePackages> {
  const page = new ESPHomePagePackages();
  Object.assign(page, { _api: api, _localize: identityLocalize });
  document.body.appendChild(page);
  await flushMicrotasks(8);
  await page.updateComplete;
  return page;
}

const root = (page: ESPHomePagePackages) => page.shadowRoot!;

async function typePath(page: ESPHomePagePackages, value: string) {
  const input = root(page).querySelector<HTMLInputElement>(".create input")!;
  input.value = value;
  input.dispatchEvent(new Event("input"));
  await page.updateComplete;
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => {
  document.body.innerHTML = "";
});

describe("esphome-page-packages list", () => {
  test("groups packages by folder", async () => {
    const page = await mountWith({
      listPackages: vi
        .fn()
        .mockResolvedValue([
          { path: "common/base.yaml" },
          { path: "common/wifi.yaml" },
          { path: "common/sub/sensors.yaml" },
        ]),
    });

    const folders = [...root(page).querySelectorAll(".folder h2")].map(
      (h) => h.textContent
    );
    const files = [...root(page).querySelectorAll(".file-name")].map((b) =>
      b.textContent!.trim()
    );
    expect(folders).toEqual(["common/", "common/sub/"]);
    expect(files).toEqual(["base.yaml", "wifi.yaml", "sensors.yaml"]);
  });

  test("opens the editor with literal slashes", async () => {
    const page = await mountWith({
      listPackages: vi.fn().mockResolvedValue([{ path: "common/sub/sensors.yaml" }]),
    });

    root(page).querySelector<HTMLButtonElement>(".file-name")!.click();

    expect(navigate).toHaveBeenCalledWith("/file/common/sub/sensors.yaml");
  });

  test("shows the empty state", async () => {
    const page = await mountWith({ listPackages: vi.fn().mockResolvedValue([]) });
    expect(root(page).querySelector(".empty")?.textContent).toContain("packages.empty");
  });

  test("a failed listing shows the error", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const listPackages = vi.fn().mockRejectedValue(new Error("down"));
    const page = await mountWith({ listPackages });

    expect(root(page).textContent).toContain("packages.load_failed");
  });
});

describe("esphome-page-packages create", () => {
  test("flags a top-level path and keeps New disabled", async () => {
    const page = await mountWith({ listPackages: vi.fn().mockResolvedValue([]) });

    await typePath(page, "kitchen.yaml");

    expect(root(page).querySelector(".problem")?.textContent).toBe(
      "packages.path_needs_folder"
    );
    expect(
      root(page).querySelector<HTMLButtonElement>(".create .primary")!.disabled
    ).toBe(true);
  });

  test("creates the file from the template and opens it", async () => {
    const createFile = vi.fn().mockResolvedValue({ path: "common/wifi.yaml" });
    const page = await mountWith({
      listPackages: vi.fn().mockResolvedValue([]),
      createFile,
    });

    await typePath(page, " common/wifi.yaml ");
    root(page)
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { cancelable: true }));
    await flushMicrotasks(4);

    expect(createFile).toHaveBeenCalledWith(
      "common/wifi.yaml",
      "packages.new_file_template"
    );
    expect(navigate).toHaveBeenCalledWith("/file/common/wifi.yaml");
  });

  test("an existing path toasts and stays on the page", async () => {
    const createFile = vi.fn().mockRejectedValue(new APIError("already_exists", "taken"));
    const page = await mountWith({
      listPackages: vi.fn().mockResolvedValue([]),
      createFile,
    });

    await typePath(page, "common/wifi.yaml");
    root(page)
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { cancelable: true }));
    await flushMicrotasks(4);

    expect(vi.mocked(toast.error).mock.lastCall?.[0]).toBe(
      "packages.already_exists: taken"
    );
    expect(navigate).not.toHaveBeenCalled();
  });
});

describe("esphome-page-packages delete", () => {
  test("asks with the users listed, then deletes and reloads", async () => {
    const listPackages = vi.fn().mockResolvedValue([{ path: "common/base.yaml" }]);
    const deleteFile = vi.fn().mockResolvedValue(undefined);
    const getFileUsage = vi
      .fn()
      .mockResolvedValue({ used_by: ["kitchen.yaml"], unknown: [] });
    const page = await mountWith({ listPackages, deleteFile, getFileUsage });
    const open = vi.fn();
    Object.defineProperty(page, "_deleteDialog", { value: { open, close: vi.fn() } });

    root(page)
      .querySelector<HTMLButtonElement>('[aria-label="packages.delete_named"]')!
      .click();
    await flushMicrotasks(4);
    await page.updateComplete;

    expect(getFileUsage).toHaveBeenCalledWith("common/base.yaml");
    expect(open).toHaveBeenCalledOnce();
    expect(root(page).querySelector('[slot="body"]')?.textContent).toContain(
      "packages.delete_used_message"
    );

    root(page)
      .querySelector("esphome-confirm-dialog")!
      .dispatchEvent(new CustomEvent("confirm"));
    await flushMicrotasks(4);

    expect(deleteFile).toHaveBeenCalledWith("common/base.yaml");
    expect(listPackages).toHaveBeenCalledTimes(2);
  });
});
