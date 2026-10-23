/**
 * @vitest-environment happy-dom
 *
 * Package-page dirty state must reflect user edits, not merely loading the
 * package into CodeMirror. These tests exercise the page and the real YAML
 * editor together so a programmatic initial value sync cannot masquerade as
 * a user edit.
 */
import { EditorSelection } from "@codemirror/state";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@home-assistant/webawesome/dist/components/icon/icon.js", () => ({}));

import { flushMicrotasks } from "../_dom.js";
import { ESPHomePagePackage } from "../../src/pages/package.js";
import { runLeaveGuard } from "../../src/util/navigation.js";

const YAML = "substitutions:\n  name: test\nesphome:\n  name: ${name}\n";

function makeApi(overrides: Record<string, unknown> = {}) {
  return {
    getPackage: vi.fn(async () => YAML),
    listPackageDevices: vi.fn(async () => ["device-a", "device-b"]),
    savePackage: vi.fn(async (_path: string, _content: string) => ({
      path: "packages/shared.yaml",
      results: [
        { configuration: "device-a", valid: true, errors: [] },
        { configuration: "device-b", valid: false, errors: ["invalid"] },
      ],
    })),
    ...overrides,
  };
}

async function mount(api = makeApi()) {
  const page = new ESPHomePagePackage();
  // The page normally receives these through Lit context from app-shell.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (page as any)._api = api;
  page.path = "packages/shared.yaml";
  document.body.append(page);
  await page.updateComplete;
  await flushMicrotasks(12);
  await page.updateComplete;
  return { page, api };
}

function saveButton(page: ESPHomePagePackage): HTMLButtonElement {
  return page.shadowRoot!.querySelector("header button:last-child")!;
}

afterEach(() => {
  document.body.replaceChildren();
  window.history.replaceState({}, "", "/");
  vi.restoreAllMocks();
});

describe("package page", () => {
  it("sizes the YAML editor to the available page height", () => {
    const css = ESPHomePagePackage.styles.cssText;

    expect(css).toMatch(/\.layout\s*\{[^}]*grid-template-rows:\s*minmax\(0,\s*1fr\)/s);
    expect(css).toMatch(/\.layout\s*>\s*section\s*\{[^}]*display:\s*flex/s);
    expect(css).toMatch(/esphome-yaml-editor\s*\{[^}]*flex:\s*1 1 0/s);
    expect(css).toMatch(/\.results\s*\{[^}]*max-height:\s*35vh/s);
  });

  it("loads a package into the editor without marking it dirty", async () => {
    const { page, api } = await mount();

    expect(api.getPackage).toHaveBeenCalledWith("packages/shared.yaml");
    expect(api.listPackageDevices).toHaveBeenCalledWith("packages/shared.yaml");
    expect(saveButton(page).disabled).toBe(true);

    const editor = page.shadowRoot!.querySelector("esphome-yaml-editor")!;
    const changes = vi.fn();
    editor.addEventListener("yaml-change", changes);
    await flushMicrotasks(5);
    expect(changes).not.toHaveBeenCalled();

    const beforeUnload = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(beforeUnload);
    expect(beforeUnload.defaultPrevented).toBe(false);
    const confirm = vi.fn();
    window.confirm = confirm;
    await expect(runLeaveGuard()).resolves.toBe(true);
    expect(confirm).not.toHaveBeenCalled();

    // Opening the editor, focusing it, and moving the caret are view-only
    // actions. They must not enable Save or trigger the leave warning.
    const view = (
      editor as unknown as {
        _view: { state: unknown; dispatch: (spec: unknown) => void };
      }
    )._view;
    view.dispatch({ selection: EditorSelection.cursor(3) });
    await page.updateComplete;
    expect(saveButton(page).disabled).toBe(true);
    expect(api.savePackage).not.toHaveBeenCalled();
  });

  it("preserves a clean baseline when the server returns CRLF YAML", async () => {
    const crlfYaml = YAML.replaceAll("\n", "\r\n");
    const { page } = await mount(makeApi({ getPackage: vi.fn(async () => crlfYaml) }));

    expect(saveButton(page).disabled).toBe(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((page as any)._yaml).toBe(crlfYaml);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((page as any)._saved).toBe(crlfYaml);
  });

  it("does not mark programmatic editor synchronization as a user change", async () => {
    const { page, api } = await mount();
    const editor = page.shadowRoot!.querySelector("esphome-yaml-editor")!;

    editor.dispatchEvent(
      new CustomEvent("yaml-change", {
        detail: { value: `${YAML}# editor synchronization\n` },
        bubbles: true,
      })
    );
    await page.updateComplete;

    expect(saveButton(page).disabled).toBe(true);
    expect(api.savePackage).not.toHaveBeenCalled();
  });

  it("marks a user edit dirty and saves it, then clears dirty state", async () => {
    const { page, api } = await mount();
    const editor = page.shadowRoot!.querySelector("esphome-yaml-editor")!;
    const view = (
      editor as unknown as {
        _view: { state: { doc: { length: number } }; dispatch: (spec: unknown) => void };
      }
    )._view;

    view.dispatch({
      changes: { from: view.state.doc.length, insert: "logger:\n" },
      userEvent: "input.type",
    });
    await page.updateComplete;
    expect(saveButton(page).disabled).toBe(false);

    const beforeUnload = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(beforeUnload);
    expect(beforeUnload.defaultPrevented).toBe(true);

    saveButton(page).click();
    await flushMicrotasks(10);
    await page.updateComplete;
    expect(api.savePackage).toHaveBeenCalledWith(
      "packages/shared.yaml",
      `${YAML}logger:\n`
    );
    expect(saveButton(page).disabled).toBe(true);
    expect(page.shadowRoot!.querySelectorAll(".results p")).toHaveLength(2);
  });

  it("keeps the package dirty when saving fails", async () => {
    const api = makeApi({
      savePackage: vi.fn(async () => {
        throw new Error("save failed");
      }),
    });
    const { page } = await mount(api);
    const editor = page.shadowRoot!.querySelector("esphome-yaml-editor")!;
    const view = (
      editor as unknown as {
        _view: { state: { doc: { length: number } }; dispatch: (spec: unknown) => void };
      }
    )._view;
    view.dispatch({
      changes: { from: view.state.doc.length, insert: "logger:\n" },
      userEvent: "input.type",
    });
    await page.updateComplete;

    saveButton(page).click();
    await flushMicrotasks(10);
    await page.updateComplete;

    expect(saveButton(page).disabled).toBe(false);
  });

  it("asks before leaving with unsaved package changes", async () => {
    const { page } = await mount();
    const editor = page.shadowRoot!.querySelector("esphome-yaml-editor")!;
    const view = (
      editor as unknown as {
        _view: {
          state: { doc: { length: number } };
          dispatch: (spec: unknown) => void;
        };
      }
    )._view;
    view.dispatch({
      changes: { from: view.state.doc.length, insert: "logger:\n" },
      userEvent: "input.type",
    });
    await page.updateComplete;

    const confirm = vi.fn(() => false);
    window.confirm = confirm;
    await expect(runLeaveGuard()).resolves.toBe(false);
    expect(confirm).toHaveBeenCalledOnce();
    expect(confirm).toHaveBeenCalledWith("Discard unsaved package changes?");
  });

  it("returns to clean state if the user undoes their edit back to the loaded YAML", async () => {
    const { page, api } = await mount();
    const editor = page.shadowRoot!.querySelector("esphome-yaml-editor")!;
    const view = (
      editor as unknown as {
        _view: { state: { doc: { length: number } }; dispatch: (spec: unknown) => void };
      }
    )._view;
    const originalLength = view.state.doc.length;

    view.dispatch({
      changes: { from: originalLength, insert: "logger:\n" },
      userEvent: "input.type",
    });
    await page.updateComplete;
    expect(saveButton(page).disabled).toBe(false);

    view.dispatch({
      changes: { from: originalLength, to: originalLength + "logger:\n".length },
      userEvent: "delete.undo",
    });
    await page.updateComplete;
    expect(saveButton(page).disabled).toBe(true);
    expect(api.savePackage).not.toHaveBeenCalled();
  });
});
