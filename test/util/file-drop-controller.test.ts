/**
 * @vitest-environment happy-dom
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { FileDropController } from "../../src/util/file-drop-controller.js";
import { dragEvent } from "../_drag-event.js";
import { FakeHost } from "../_fake-host.js";

function make(opts: { visible?: boolean } = {}) {
  const host = new FakeHost();
  const target = document.createElement("div");
  target.checkVisibility = () => opts.visible ?? true;
  document.body.appendChild(target);
  const onFile = vi.fn();
  const ctrl = new FileDropController(host as never, onFile, { target });
  ctrl.hostConnected();
  return { host, target, onFile, ctrl };
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("FileDropController", () => {
  it("accepts a dragged file: prevents default and flags dragging", () => {
    const { host, target, ctrl } = make();
    const over = dragEvent("dragover");
    target.dispatchEvent(over);
    expect(over.defaultPrevented).toBe(true);
    expect(over.dataTransfer.dropEffect).toBe("copy");
    expect(ctrl.dragging).toBe(true);
    expect(host.updates).toBe(1);
  });

  it("ignores non-file drags entirely", () => {
    const { target, ctrl } = make();
    const over = dragEvent("dragover", { types: ["text/plain"] });
    target.dispatchEvent(over);
    expect(over.defaultPrevented).toBe(false);
    expect(ctrl.dragging).toBe(false);
  });

  it("keeps dragging through child enter/leave churn, clears on real leave", () => {
    const { target, ctrl } = make();
    target.dispatchEvent(dragEvent("dragenter"));
    target.dispatchEvent(dragEvent("dragenter")); // child
    target.dispatchEvent(dragEvent("dragleave")); // child
    expect(ctrl.dragging).toBe(true);
    target.dispatchEvent(dragEvent("dragleave"));
    expect(ctrl.dragging).toBe(false);
  });

  it("clears the highlight on a dragleave with no dataTransfer", () => {
    const { target, ctrl } = make();
    target.dispatchEvent(dragEvent("dragenter"));
    expect(ctrl.dragging).toBe(true);
    target.dispatchEvent(new Event("dragleave", { bubbles: true, cancelable: true }));
    expect(ctrl.dragging).toBe(false);
  });

  it('recognizes a file drop whose types lack "Files" but whose files are populated', () => {
    const { target, onFile } = make();
    const yaml = new File(["esphome:"], "a.yaml");
    const drop = dragEvent("drop", { files: [yaml], types: [] });
    target.dispatchEvent(drop);
    expect(drop.defaultPrevented).toBe(true);
    expect(onFile).toHaveBeenCalledExactlyOnceWith(yaml);

    const winDrop = dragEvent("drop", { files: [yaml], types: [] });
    window.dispatchEvent(winDrop);
    expect(winDrop.defaultPrevented).toBe(true);
  });

  it("hands the first accepted file to onFile on drop", () => {
    const { target, onFile, ctrl } = make();
    target.dispatchEvent(dragEvent("dragenter"));
    const yaml = new File(["esphome:"], "Config.YAML");
    const drop = dragEvent("drop", { files: [new File([""], "photo.png"), yaml] });
    target.dispatchEvent(drop);
    expect(drop.defaultPrevented).toBe(true);
    expect(onFile).toHaveBeenCalledExactlyOnceWith(yaml);
    expect(ctrl.dragging).toBe(false);
  });

  it("accepts bundle archives", () => {
    const { target, onFile } = make();
    const bundle = new File([""], "device.tar.gz");
    target.dispatchEvent(dragEvent("drop", { files: [bundle] }));
    expect(onFile).toHaveBeenCalledExactlyOnceWith(bundle);
  });

  it("swallows a drop with no accepted file without importing", () => {
    const { target, onFile } = make();
    const drop = dragEvent("drop", { files: [new File([""], "photo.png")] });
    target.dispatchEvent(drop);
    expect(drop.defaultPrevented).toBe(true);
    expect(onFile).not.toHaveBeenCalled();
  });

  it("guards window file drags while the target is visible", () => {
    make();
    const over = dragEvent("dragover");
    window.dispatchEvent(over);
    expect(over.defaultPrevented).toBe(true);
    expect(over.dataTransfer.dropEffect).toBe("none");
    const drop = dragEvent("drop", { files: [new File([""], "a.yaml")] });
    window.dispatchEvent(drop);
    expect(drop.defaultPrevented).toBe(true);
  });

  it("leaves window drags alone while the target is hidden", () => {
    make({ visible: false });
    const over = dragEvent("dragover");
    window.dispatchEvent(over);
    expect(over.defaultPrevented).toBe(false);
  });

  it("leaves window text drags alone", () => {
    make();
    const over = dragEvent("dragover", { types: ["text/plain"] });
    window.dispatchEvent(over);
    expect(over.defaultPrevented).toBe(false);
  });

  it("detaches everything on hostDisconnected", () => {
    const { target, onFile, ctrl } = make();
    target.dispatchEvent(dragEvent("dragenter"));
    ctrl.hostDisconnected();
    expect(ctrl.dragging).toBe(false);
    const over = dragEvent("dragover");
    window.dispatchEvent(over);
    expect(over.defaultPrevented).toBe(false);
    target.dispatchEvent(dragEvent("drop", { files: [new File([""], "a.yaml")] }));
    expect(onFile).not.toHaveBeenCalled();
  });
});
